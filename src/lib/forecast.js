// src/lib/forecast.js
// ============================================================
// Demand Forecasting Engine — v4.0 (REWRITE)
// ============================================================
// PHILOSOPHY: simple, robust, auditable.
//
// We replaced Holt + 4 overlapping safeguards (recent regime,
// slow regime, TS gating, YoY cap) with a single linear pipeline:
//
//   1. Régimen intermitente   → tasa real (zeros incluidos)
//   2. Régimen new/sparse     → DSR plano capeado
//   3. Régimen continuous:
//      a) Nivel base = promedio últimos 60 días reales
//      b) Trend = solo si negativo (caída), cap -1%/día
//      c) Estacional × DAMP 0.5 sobre nivel base
//      d) Safety stock por clase ABC:
//           A → Z × σ_LT
//           B → σ_LT × 0.5
//           C / sin clasif → 0
//
// PROPIEDADES:
// - Si vendés menos en los últimos 60d, tu forecast baja.
// - Si crecés, no extrapolamos crecimiento (te lo dejamos
//   manual). Si caés, lo respetamos.
// - El estacional siempre se aplica sobre el nivel actual,
//   nunca sobre uno inflado por datos viejos.
// - Cada bundle puede ser auditado a mano: nivel × días +
//   ajustes claros.
// ============================================================

import { calcRegimeCoverage } from './regimeClassifier.js';

// ────────────────────────────────────────────────────────────
// Defaults / constants
// ────────────────────────────────────────────────────────────
export const DEFAULT_SERVICE_LEVEL_A = 97;
export const DEFAULT_SERVICE_LEVEL_OTHER = 95;
export const DEFAULT_BASE_WINDOW_DAYS = 60;
export const DEFAULT_SAFETY_DAYS = 180;       // mínimo de historia para usar σ_LT real
export const MIN_DAYS_FOR_SIGMA = 30;         // mínimo para calcular σ_LT
export const FALLBACK_CV = 0.3;               // cuando no hay datos suficientes
export const DAMP = 0.5;                      // dampening del shape estacional
export const MAX_NEGATIVE_TREND_RATIO = 0.01; // -1% por día max

const SERVICE_LEVEL_TO_Z = {
  90: 1.28, 91: 1.34, 92: 1.41, 93: 1.48, 94: 1.55,
  95: 1.65, 96: 1.75, 97: 1.88, 98: 2.05, 99: 2.33,
  99.5: 2.58, 99.9: 3.09,
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

export function getServiceLevelZ(profABC, settings) {
  const pctA = num(settings?.serviceLevelA, DEFAULT_SERVICE_LEVEL_A);
  const pctOther = num(settings?.serviceLevelOther, DEFAULT_SERVICE_LEVEL_OTHER);
  const pct = profABC === 'A' ? pctA : pctOther;
  if (SERVICE_LEVEL_TO_Z[pct] != null) return SERVICE_LEVEL_TO_Z[pct];
  const keys = Object.keys(SERVICE_LEVEL_TO_Z).map(Number).sort((a, b) => a - b);
  let lo = keys[0], hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (pct >= keys[i] && pct <= keys[i + 1]) { lo = keys[i]; hi = keys[i + 1]; break; }
  }
  if (lo === hi) return SERVICE_LEVEL_TO_Z[lo];
  const t = (pct - lo) / (hi - lo);
  return SERVICE_LEVEL_TO_Z[lo] + t * (SERVICE_LEVEL_TO_Z[hi] - SERVICE_LEVEL_TO_Z[lo]);
}

// ────────────────────────────────────────────────────────────
// CORE: nivel base = promedio últimos N días
// ────────────────────────────────────────────────────────────
// IMPORTANTE: incluye días con cero (porque ya pasamos el filtro
// del régimen intermitente — si llegamos acá, es continuous y los
// ceros son legítimos días de baja venta, no falta de data).
// ────────────────────────────────────────────────────────────
function calcBaseLevel(series, windowDays) {
  if (!series || !series.length) return 0;
  const recent = series.slice(-windowDays);
  const vals = recent.map(p => num(p.dsr));
  return mean(vals);
}

// ────────────────────────────────────────────────────────────
// CORE: trend solo si negativo
// ────────────────────────────────────────────────────────────
// Comparación simple: avg primer mitad vs segunda mitad de la
// ventana. Si la segunda mitad está MÁS BAJA, hay caída.
// Calculamos la pendiente lineal y la capeamos a -1%/día.
// Si está creciendo (segunda > primera), trend = 0 (conservador).
// ────────────────────────────────────────────────────────────
function calcNegativeTrend(series, windowDays, level) {
  if (!series || series.length < windowDays || !(level > 0)) return 0;
  const recent = series.slice(-windowDays);
  const half = Math.floor(windowDays / 2);
  const firstHalf = recent.slice(0, half).map(p => num(p.dsr));
  const secondHalf = recent.slice(half).map(p => num(p.dsr));
  const avgFirst = mean(firstHalf);
  const avgSecond = mean(secondHalf);

  // Si la segunda mitad NO está más baja, no aplicamos trend.
  if (avgSecond >= avgFirst) return 0;

  // Caída: pendiente por día = (avgSecond - avgFirst) / half
  const trend = (avgSecond - avgFirst) / half;

  // Cap: max caída 1% del level por día
  const maxNegativeTrend = -level * MAX_NEGATIVE_TREND_RATIO;
  return Math.max(trend, maxNegativeTrend);
}

// ────────────────────────────────────────────────────────────
// CORE: σ_LT (volatilidad durante lead time)
// ────────────────────────────────────────────────────────────
// Solo se calcula si hay suficiente data. Si no, usamos un
// fallback simple: level × LT × FALLBACK_CV.
// ────────────────────────────────────────────────────────────
function calcSigmaLT(series, leadTime, level) {
  const lt = num(leadTime, 30);
  if (!series || series.length < Math.max(MIN_DAYS_FOR_SIGMA, lt)) {
    return { sigmaLT: level * lt * FALLBACK_CV, fallback: true };
  }
  // Sliding windows of length lt
  const vals = series.map(p => num(p.dsr));
  const windows = [];
  for (let end = lt; end <= vals.length; end++) {
    let s = 0;
    for (let i = end - lt; i < end; i++) s += vals[i];
    windows.push(s);
  }
  if (windows.length < 2) {
    return { sigmaLT: level * lt * FALLBACK_CV, fallback: true };
  }
  return { sigmaLT: stdev(windows), fallback: false };
}

// ────────────────────────────────────────────────────────────
// CORE: safety stock por clase ABC
// ────────────────────────────────────────────────────────────
// A   → Z × σ_LT (full safety)
// B   → σ_LT × 0.5 (half safety, no Z multiplier)
// C / sin clasificar → 0
// ────────────────────────────────────────────────────────────
function calcSafetyStock(profABC, sigmaLT, Z) {
  if (profABC === 'A') return Z * sigmaLT;
  if (profABC === 'B') return sigmaLT * 0.5;
  return 0;
}

// ────────────────────────────────────────────────────────────
// CORE: aplicar shape estacional al nivel base
// ────────────────────────────────────────────────────────────
// Para cada día del horizonte, multiplicamos el nivel + trend
// damped por el shape factor del mes. Damping aplicado al
// shape (DAMP=0.5 → 1.71x se vuelve 1.36x).
// ────────────────────────────────────────────────────────────
function projectDemand(level, trend, targetDoc, seasonalProfile) {
  const td = num(targetDoc, 180);
  const today = new Date();
  const curMonth = today.getMonth();
  const curShape = seasonalProfile?.lastYearShape?.[curMonth] ?? 1.0;
  const hasSeas = !!(seasonalProfile && seasonalProfile.hasHistory);

  let fromLevel = 0, fromTrend = 0, fromSeasonal = 0, total = 0;

  for (let d = 0; d < td; d++) {
    const date = new Date(today.getTime() + d * 86400000);
    const mi = date.getMonth();

    // Trend acumulado (solo si negativo, ya filtrado upstream)
    const trendContrib = trend * d;
    const pointForecast = Math.max(0, level + trendContrib);

    // Seasonal factor relativo al mes actual
    let seasFactor = 1.0;
    if (hasSeas) {
      const shape = seasonalProfile.lastYearShape[mi] ?? 1.0;
      const rawNorm = curShape > 0 ? shape / curShape : 1.0;
      seasFactor = 1 + (rawNorm - 1) * DAMP;
    }

    const dayDemand = pointForecast * seasFactor;

    fromLevel += level;
    fromTrend += trendContrib;
    fromSeasonal += pointForecast * (seasFactor - 1);
    total += dayDemand;
  }

  return {
    fromLevel: Math.round(fromLevel),
    fromTrend: Math.round(fromTrend),
    fromSeasonal: Math.round(fromSeasonal),
    total: Math.max(0, total),
  };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
export function calcBundleForecast({
  bundleId,
  bundleDays,
  leadTime,
  targetDoc,
  profABC,
  seasonalProfile,
  settings,
  regimeInfo,
  bundleDsrFromSheet,
}) {
  const lt = num(leadTime, 30);
  const td = num(targetDoc, 180);
  const Z = getServiceLevelZ(profABC, settings);
  const baseWindow = num(settings?.baseWindowDays, DEFAULT_BASE_WINDOW_DAYS);

  // ──────────────────────────────────────────────────────────
  // Régimen no-continuous → dispatch a regimeClassifier
  // ──────────────────────────────────────────────────────────
  if (regimeInfo && regimeInfo.regime !== 'continuous') {
    const regimeResult = calcRegimeCoverage(regimeInfo, td, bundleDsrFromSheet);
    if (regimeResult) {
      return {
        level: regimeResult.effectiveDSR,
        trend: 0,
        effectiveTrend: 0,
        coverageDemand: regimeResult.coverageDemand,
        flatDemand: regimeResult.coverageDemand,
        safetyStock: regimeResult.safetyStock,
        sigmaLT: 0,
        Z,
        demandBreakdown: {
          fromLevel: Math.round(regimeResult.coverageDemand),
          fromTrend: 0,
          fromSeasonal: 0,
          total: Math.round(regimeResult.coverageDemand),
        },
        flags: {
          usedHolt: false,
          shortHistory: regimeInfo.regime === 'new_or_sparse',
          trendCapped: false,
          safetyStockFallback: true,
          outliersRemoved: 0,
          trackingSignal: 0,
          trackingSignalExceeded: false,
          trendGatedByTS: false,
          noData: false,
          recentRegimeApplied: false,
          recentRegimeInfo: null,
          slowRegimeApplied: false,
          slowRegimeInfo: null,
          regime: regimeInfo.regime,
          regimeMethod: regimeResult.method,
          regimeReason: regimeInfo.reason,
          regimeRatePerDay: regimeInfo.ratePerDay,
          regimeAvgWhenSelling: regimeInfo.avgWhenSelling,
          regimeZeroRatio: regimeInfo.zeroRatio,
          regimeTotalDays: regimeInfo.totalDays,
          regimeNonZeroDays: regimeInfo.nonZeroDays,
          // v4 specific
          baseWindowDays: 0,
          baseLevel: regimeResult.effectiveDSR,
          negativeTrendApplied: false,
          safetyMethod: 'regime_heuristic',
          safetyTier: profABC || 'unclassified',
        },
        effectiveDSR: regimeResult.effectiveDSR,
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // Régimen continuous → pipeline v4
  // ──────────────────────────────────────────────────────────
  const raw = (bundleDays || [])
    .filter(d => d && d.j === bundleId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const series = raw.slice(-365);

  if (series.length === 0) {
    return {
      level: 0, trend: 0, coverageDemand: 0, flatDemand: 0,
      safetyStock: 0, sigmaLT: 0, Z,
      demandBreakdown: { fromLevel: 0, fromTrend: 0, fromSeasonal: 0, total: 0 },
      flags: {
        usedHolt: false, shortHistory: true, trendCapped: false,
        safetyStockFallback: true, outliersRemoved: 0,
        trackingSignal: 0, trackingSignalExceeded: false,
        trendGatedByTS: false, noData: true,
        recentRegimeApplied: false, recentRegimeInfo: null,
        slowRegimeApplied: false, slowRegimeInfo: null,
        regime: regimeInfo?.regime || 'unknown',
        regimeMethod: 'no_data',
        regimeReason: regimeInfo?.reason || 'No data',
        baseWindowDays: 0,
        baseLevel: 0,
        negativeTrendApplied: false,
        safetyMethod: 'no_data',
        safetyTier: profABC || 'unclassified',
      },
      effectiveDSR: 0,
    };
  }

  // STEP 1: Nivel base (promedio últimos N días reales)
  const level = calcBaseLevel(series, baseWindow);

  // STEP 2: Trend (solo si negativo)
  const trend = calcNegativeTrend(series, baseWindow, level);
  const negativeTrendApplied = trend < 0;

  // STEP 3: Demand projection (level + trend + seasonal)
  const projection = projectDemand(level, trend, td, seasonalProfile);
  const baseCoverageDemand = projection.total;

  // STEP 4: Safety stock por clase ABC
  const sigma = calcSigmaLT(series, lt, level);
  const safetyStock = calcSafetyStock(profABC, sigma.sigmaLT, Z);

  // STEP 5: Final coverage demand
  const coverageDemand = baseCoverageDemand + safetyStock;

  // Flat demand reference (sin estacional ni safety) para diagnóstico
  const flatDemand = Math.max(0, level * td);

  // Determinar safety tier para flag
  const safetyTier = profABC === 'A' ? 'A' : profABC === 'B' ? 'B' : 'C_or_unclassified';
  const safetyMethod = safetyTier === 'A' ? 'Z_x_sigma'
                     : safetyTier === 'B' ? 'sigma_x_0.5'
                     : 'zero';

  return {
    level,
    trend,
    effectiveTrend: trend,
    coverageDemand: Math.round(coverageDemand),
    flatDemand,
    safetyStock: Math.round(safetyStock),
    sigmaLT: sigma.sigmaLT,
    Z,
    demandBreakdown: {
      fromLevel: projection.fromLevel,
      fromTrend: projection.fromTrend,
      fromSeasonal: projection.fromSeasonal,
      total: Math.round(coverageDemand),
    },
    flags: {
      // Legacy flags (kept for back-compat con UI existente)
      usedHolt: false,
      shortHistory: series.length < 30,
      trendCapped: false,
      safetyStockFallback: sigma.fallback,
      outliersRemoved: 0,
      trackingSignal: 0,
      trackingSignalExceeded: false,
      trendGatedByTS: false,
      noData: false,
      recentRegimeApplied: false,
      recentRegimeInfo: null,
      slowRegimeApplied: false,
      slowRegimeInfo: null,
      yoyCapApplied: false,
      // v4 flags
      regime: 'continuous',
      regimeMethod: 'v4_simple',
      regimeReason: regimeInfo?.reason || `Continuous: avg últimos ${baseWindow}d`,
      baseWindowDays: baseWindow,
      baseLevel: level,
      negativeTrendApplied,
      safetyMethod,
      safetyTier,
      seriesLength: series.length,
    },
    effectiveDSR: level,
  };
}

// ============================================================
// Public utility (mantengo export por si algún componente lo usa)
// ============================================================
export function calcHistoricSamePeriod(bundleDays, bundleId, horizonDays) {
  if (!Array.isArray(bundleDays) || !bundleId || !(horizonDays > 0)) return null;
  const today = new Date();
  const lyStart = new Date(today);
  lyStart.setFullYear(lyStart.getFullYear() - 1);
  const lyEnd = new Date(lyStart);
  lyEnd.setDate(lyEnd.getDate() + horizonDays);

  const lyStartStr = lyStart.toISOString().split('T')[0];
  const lyEndStr = lyEnd.toISOString().split('T')[0];

  const relevantDays = bundleDays.filter(d =>
    d && d.j === bundleId &&
    (d.date || '') >= lyStartStr &&
    (d.date || '') < lyEndStr
  );

  if (relevantDays.length < horizonDays * 0.5) return null;

  const total = relevantDays.reduce((s, d) => s + num(d.dsr), 0);
  return {
    total,
    daysCovered: relevantDays.length,
    horizonDays,
    startDate: lyStartStr,
    endDate: lyEndStr,
  };
}

// ============================================================
// Batch (mantengo signature por back-compat)
// ============================================================
export function batchBundleForecasts({
  bundles,
  bundleDays,
  vendorsByName,
  abcA,
  seasonalProfiles,
  settings,
  getTargetDoc,
  regimeMap,
}) {
  const abcMap = {};
  (abcA || []).forEach(a => { if (a.j) abcMap[a.j] = a.profABC; });
  const out = {};
  for (const b of (bundles || [])) {
    if (!b?.j) continue;
    const vendorsRaw = (b.vendors || '').trim();
    const firstVendor = vendorsRaw.split(',')[0].trim();
    const v = vendorsByName[firstVendor] || {};
    const lt = num(v.lt, 30);
    const td = getTargetDoc ? getTargetDoc(v) : 180;
    out[b.j] = calcBundleForecast({
      bundleId: b.j,
      bundleDays,
      leadTime: lt,
      targetDoc: td,
      profABC: abcMap[b.j] || null,
      seasonalProfile: seasonalProfiles?.[b.j],
      settings,
      regimeInfo: regimeMap?.[b.j],
      bundleDsrFromSheet: num(b.cd),
    });
  }
  return out;
}

// ============================================================
// Stubs para back-compat: exports que algunos componentes
// pueden estar importando. Devuelven valores no-op.
// ============================================================
export function hampelFilter(series) {
  return { clean: (series || []).map(p => ({ ...p, wasOutlier: false, dsrClean: num(p.dsr) })), outlierIndices: [] };
}

export function holtLinearForecast(series) {
  const vals = (series || []).map(p => num(p.dsrClean ?? p.dsr));
  return { level: mean(vals), trend: 0, usedHolt: false, shortHistory: false, trendCapped: false, n: vals.length };
}

export function calcTrackingSignal() {
  return { ts: 0, exceeded: false };
}

// Constants kept for back-compat
export const DEFAULT_HOLT_ALPHA = 0.2;
export const DEFAULT_HOLT_BETA = 0.1;
export const DEFAULT_HAMPEL_WINDOW = 7;
export const DEFAULT_HAMPEL_THRESHOLD = 3;
export const RECENT_REGIME_WINDOW = 30;
export const RECENT_REGIME_THRESHOLD = 0.75;
export const SLOW_REGIME_WINDOW = 90;
export const SLOW_REGIME_DROP_THRESHOLD = 0.15;
export const SLOW_REGIME_MIN_PRIOR = 30;
export const MIN_HISTORY_FOR_HOLT = 30;
export const MIN_HISTORY_FOR_SIGMA = 2;
export const TREND_DAMPING_PHI = 0.88;
export const MAX_TREND_RATIO = 0.02;
export const TS_GATE_THRESHOLD = 4;
