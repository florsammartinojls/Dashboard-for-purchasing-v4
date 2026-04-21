// src/lib/forecast.js
// ============================================================
// Demand Forecasting Engine — v3.2
// ============================================================
// NEW in v3.2:
//   [FIX-REGIME-FAST] Recent regime check threshold 0.6 → 0.75.
//                     Triggers when last 30d avg < 75% of Holt level.
//   [FIX-REGIME-SLOW] NEW slow regime check (YoY-style).
//                     Compares last 90d vs prior 90d. If drop >20%,
//                     scales Holt level down proportionally.
//                     Catches gradual multi-month declines that the
//                     fast check (30d window) misses.
//
// FIXES from v3 (unchanged):
//   [FIX-1] Damped trend integration (φ^t decay)
//   [FIX-2] Trend cap as fraction of level (2%)
//   [FIX-3] Trend gated by Tracking Signal |TS| > 4
//   [FIX-4] Holt init hardened against OOS gaps
//   [FIX-5] calcHistoricSamePeriod helper for YoY
//
// Pipeline (unchanged ordering):
//   1. Hampel filter cleans historical outliers
//   2. Holt linear method captures level + trend
//   2.5. Regime checks adjust level if model is demonstrably stale
//   3. Seasonal factor adjusts by month
//   4. σ_LT + Z safety stock
// ============================================================

export const DEFAULT_HOLT_ALPHA = 0.2;
export const DEFAULT_HOLT_BETA = 0.1;
export const DEFAULT_HAMPEL_WINDOW = 7;
export const DEFAULT_HAMPEL_THRESHOLD = 3;
export const DEFAULT_SERVICE_LEVEL_A = 97;
export const DEFAULT_SERVICE_LEVEL_OTHER = 95;

// [FIX-REGIME-FAST] Recent regime check tuning
export const RECENT_REGIME_WINDOW = 30;
export const RECENT_REGIME_THRESHOLD = 0.75; // ↑ de 0.6 a 0.75

// [FIX-REGIME-SLOW] Slow regime check tuning (YoY-style, catches gradual decline)
export const SLOW_REGIME_WINDOW = 90;       // days in each block
export const SLOW_REGIME_DROP_THRESHOLD = 0.20; // if current 90d is 20%+ less than prior 90d
export const SLOW_REGIME_MIN_PRIOR = 30;    // need 30 non-zero days in prior block for signal

export const MIN_HISTORY_FOR_HOLT = 30;
export const MIN_HISTORY_FOR_SIGMA = 2; // min lead-times worth of history
export const FALLBACK_CV = 0.3;         // used when σ_LT can't be computed
export const DAMP = 0.5;                // seasonal damping (matches seasonal.js)

// [FIX-1] Holt trend damping factor φ. With φ=0.88, the trend contribution
// at day t is trend × φ^t instead of trend (constant). Over 180 days this
// reduces a runaway positive trend by ~85% without killing genuine growth.
// Reference: Gardner & McKenzie (1985), standard in forecasting literature.
export const TREND_DAMPING_PHI = 0.88;

// [FIX-2] Max trend allowed per day as a fraction of level. Example: level=10,
// MAX_TREND_RATIO=0.02 → trend capped at ±0.20/day. A trend larger than 2%
// of the level per day is operationally absurd for SKU-level demand.
export const MAX_TREND_RATIO = 0.02;

// [FIX-3] When |TrackingSignal| > this threshold, the forecast model is
// biased enough that we don't trust the trend. We fall back to level-only.
export const TS_GATE_THRESHOLD = 4;

// Standard normal quantiles for service levels
const SERVICE_LEVEL_TO_Z = {
  90: 1.28, 91: 1.34, 92: 1.41, 93: 1.48, 94: 1.55,
  95: 1.65, 96: 1.75, 97: 1.88, 98: 2.05, 99: 2.33,
  99.5: 2.58, 99.9: 3.09,
};

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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

// ─── Service level → Z lookup ─────────────────────────────────────
export function getServiceLevelZ(profABC, settings) {
  const pctA = num(settings?.serviceLevelA, DEFAULT_SERVICE_LEVEL_A);
  const pctOther = num(settings?.serviceLevelOther, DEFAULT_SERVICE_LEVEL_OTHER);
  const pct = profABC === 'A' ? pctA : pctOther;
  if (SERVICE_LEVEL_TO_Z[pct] != null) return SERVICE_LEVEL_TO_Z[pct];
  // linear interpolation for non-standard values
  const keys = Object.keys(SERVICE_LEVEL_TO_Z).map(Number).sort((a, b) => a - b);
  let lo = keys[0], hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (pct >= keys[i] && pct <= keys[i + 1]) { lo = keys[i]; hi = keys[i + 1]; break; }
  }
  if (lo === hi) return SERVICE_LEVEL_TO_Z[lo];
  const t = (pct - lo) / (hi - lo);
  return SERVICE_LEVEL_TO_Z[lo] + t * (SERVICE_LEVEL_TO_Z[hi] - SERVICE_LEVEL_TO_Z[lo]);
}

// ─── Step 1: Hampel filter ────────────────────────────────────────
// Detects outliers using median absolute deviation (MAD).
// A point is outlier if |x - median| > k × 1.4826 × MAD.
// OOS days (dsr=0) are excluded from both the window AND the check —
// they're not outliers of demand, they're non-observable periods.
export function hampelFilter(series, options = {}) {
  const w = num(options.window, DEFAULT_HAMPEL_WINDOW);
  const k = num(options.threshold, DEFAULT_HAMPEL_THRESHOLD);
  const MULT = 1.4826; // MAD → σ-equivalent constant

  if (!Array.isArray(series) || series.length === 0) {
    return { clean: [], outlierIndices: [] };
  }

  const clean = series.map(p => ({ ...p, wasOutlier: false, dsrClean: num(p.dsr) }));
  const outlierIndices = [];

  for (let i = 0; i < clean.length; i++) {
    const current = num(clean[i].dsr);
    if (current <= 0) continue; // skip OOS days, keep dsrClean = 0
    const lo = Math.max(0, i - w);
    const hi = Math.min(clean.length - 1, i + w);
    const windowVals = [];
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue;
      const v = num(clean[j].dsr);
      if (v > 0) windowVals.push(v);
    }
    if (windowVals.length < 3) continue;
    const med = median(windowVals);
    const deviations = windowVals.map(v => Math.abs(v - med));
    const mad = median(deviations);
    const threshold = k * MULT * mad;
    if (threshold === 0) continue;
    if (Math.abs(current - med) > threshold) {
      clean[i].dsrClean = med;
      clean[i].wasOutlier = true;
      outlierIndices.push(i);
    }
  }
  return { clean, outlierIndices };
}

// ─── Step 2: Holt linear method (level + trend) ───────────────────
export function holtLinearForecast(cleanSeries, options = {}) {
  const alpha = num(options.alpha, DEFAULT_HOLT_ALPHA);
  const beta = num(options.beta, DEFAULT_HOLT_BETA);

  const vals = cleanSeries
    .map(p => num(p.dsrClean != null ? p.dsrClean : p.dsr))
    .filter(v => v > 0);

  if (vals.length < MIN_HISTORY_FOR_HOLT) {
    const m = mean(vals);
    return {
      level: m, trend: 0, usedHolt: false,
      shortHistory: true, trendCapped: false, n: vals.length,
    };
  }

  // [FIX-4] Initialization hardened. Previously we used vals.slice(0,7) and
  // vals.slice(7,14), but `vals` is already the filtered-positive series —
  // those first 14 can be from very different calendar periods if there were
  // long OOS stretches. We still use indices but now ensure we have ≥7 each.
  const init1 = mean(vals.slice(0, 7));
  const init2 = mean(vals.slice(7, 14));
  let level = init1;
  let trend = (init2 - init1) / 7;

  for (let t = 1; t < vals.length; t++) {
    const prevLevel = level;
    level = alpha * vals[t] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  // Cap runaway negative trend to avoid negative forecasts
  let trendCapped = false;
  if (trend < 0 && level > 0) {
    const maxNegativeTrend = -level / 365; // at most 100%/year decay
    if (trend < maxNegativeTrend) { trend = maxNegativeTrend; trendCapped = true; }
  }

  // [FIX-2] Cap runaway positive trend. A trend of more than 2% of level
  // per day means doubling every ~35 days — if history genuinely shows that,
  // something is wrong with the input data or the outlier filter.
  if (trend > 0 && level > 0) {
    const maxPositiveTrend = MAX_TREND_RATIO * level;
    if (trend > maxPositiveTrend) {
      trend = maxPositiveTrend;
      trendCapped = true;
    }
  }

  return { level, trend, usedHolt: true, shortHistory: false, trendCapped, n: vals.length };
}

// ─── Step 3: σ_LT — demand variability during lead time ───────────
export function calcSigmaLT(cleanSeries, leadTime) {
  const lt = num(leadTime, 30);
  const vals = cleanSeries
    .map(p => num(p.dsrClean != null ? p.dsrClean : p.dsr))
    .filter(v => v > 0);

  if (vals.length < lt * MIN_HISTORY_FOR_SIGMA) {
    const m = mean(vals);
    return { sigmaLT: m * lt * FALLBACK_CV, fallback: true, nWindows: 0 };
  }

  const windows = [];
  for (let end = lt; end <= vals.length; end++) {
    let s = 0;
    for (let i = end - lt; i < end; i++) s += vals[i];
    windows.push(s);
  }
  return { sigmaLT: stdev(windows), fallback: false, nWindows: windows.length };
}

// ─── Tracking signal ──────────────────────────────────────────────
// TS = Σ(errors) / MAD(errors). |TS| > 4 indicates biased forecast.
export function calcTrackingSignal(cleanSeries, holtResult) {
  const vals = cleanSeries
    .map(p => num(p.dsrClean != null ? p.dsrClean : p.dsr))
    .filter(v => v > 0);
  if (vals.length < 14 || !holtResult.usedHolt) return { ts: 0, exceeded: false };
  const { level } = holtResult;
  const errors = vals.slice(-14).map(v => v - level);
  const sumErr = errors.reduce((s, e) => s + e, 0);
  const mad = mean(errors.map(e => Math.abs(e)));
  if (mad === 0) return { ts: 0, exceeded: false };
  const ts = sumErr / mad;
  return { ts, exceeded: Math.abs(ts) > TS_GATE_THRESHOLD };
}

// [FIX-5] Compute total units sold in the same calendar window as the
// forecast horizon, one year prior. Used for the YoY sanity check in
// recommender.js. Returns null if history is insufficient.
//
// bundleDays: sorted asc by date, same shape as used elsewhere.
// horizonDays: how many days forward the forecast is projecting.
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

  if (relevantDays.length < horizonDays * 0.5) return null; // need ≥50% coverage

  // Sum DSR values (each day's dsr = units sold that day in our schema)
  const total = relevantDays.reduce((s, d) => s + num(d.dsr), 0);
  return {
    total,
    daysCovered: relevantDays.length,
    horizonDays,
    startDate: lyStartStr,
    endDate: lyEndStr,
  };
}

// ─── MAIN ENTRY POINT: full bundle forecast ───────────────────────
export function calcBundleForecast({
  bundleId,
  bundleDays,          // array of {date, j, dsr, ...}
  leadTime,
  targetDoc,
  profABC,             // 'A' | 'B' | 'C' | null
  seasonalProfile,     // existing DEF shape from seasonal.js
  settings,
}) {
  const lt = num(leadTime, 30);
  const td = num(targetDoc, 180);
  const Z = getServiceLevelZ(profABC, settings);

  const raw = (bundleDays || [])
    .filter(d => d && d.j === bundleId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const series = raw.slice(-365); // last 365 days to support slow regime check

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
      },
      effectiveDSR: 0,
    };
  }

  // Step 1
  const { clean, outlierIndices } = hampelFilter(series, {
    window: num(settings?.hampelWindow, DEFAULT_HAMPEL_WINDOW),
    threshold: num(settings?.hampelThreshold, DEFAULT_HAMPEL_THRESHOLD),
  });

  // Step 2
  const holt = holtLinearForecast(clean, {
    alpha: num(settings?.holtAlpha, DEFAULT_HOLT_ALPHA),
    beta: num(settings?.holtBeta, DEFAULT_HOLT_BETA),
  });

  // ───────────────────────────────────────────────────────────
  // [FIX-REGIME-FAST] Recent regime check (last 30 days)
  // ───────────────────────────────────────────────────────────
  // If the last 30 days of real sales average is much lower than the Holt
  // level, the model is lagging a sharp decline in demand. Override level
  // with recent avg and drop trend.
  const recentVals = clean.slice(-RECENT_REGIME_WINDOW)
    .map(p => num(p.dsrClean != null ? p.dsrClean : p.dsr))
    .filter(v => v > 0);

  let recentRegimeApplied = false;
  let recentRegimeInfo = null;
  if (recentVals.length >= 14 && holt.level > 0 && holt.usedHolt) {
    const recentAvg = mean(recentVals);
    const ratio = recentAvg / holt.level;
    if (ratio < RECENT_REGIME_THRESHOLD) {
      recentRegimeInfo = {
        holtLevelBefore: holt.level,
        holtTrendBefore: holt.trend,
        recentAvg,
        ratio,
        daysUsed: recentVals.length,
      };
      holt.level = recentAvg;
      holt.trend = 0;
      recentRegimeApplied = true;
    }
  }

  // ───────────────────────────────────────────────────────────
  // [FIX-REGIME-SLOW] Slow regime check (last 90d vs prior 90d)
  // ───────────────────────────────────────────────────────────
  // Catches gradual multi-month declines that the fast check misses.
  // Example: JLS-1241 sells 5/day for months, but YoY is -30%. Fast
  // check doesn't trigger (recent avg ≈ Holt level). Slow check compares
  // last 90d avg vs prior 90d avg — if the drop is >20%, scale level.
  //
  // Only runs if fast check didn't already fire (they shouldn't stack).
  let slowRegimeApplied = false;
  let slowRegimeInfo = null;
  if (!recentRegimeApplied && holt.level > 0 && holt.usedHolt) {
    // Need at least 180 non-zero days to compare two 90d blocks
    const allVals = clean
      .map(p => num(p.dsrClean != null ? p.dsrClean : p.dsr))
      .filter(v => v > 0);

    if (allVals.length >= SLOW_REGIME_WINDOW + SLOW_REGIME_MIN_PRIOR) {
      const recent90 = allVals.slice(-SLOW_REGIME_WINDOW);
      const prior90 = allVals.slice(
        Math.max(0, allVals.length - 2 * SLOW_REGIME_WINDOW),
        allVals.length - SLOW_REGIME_WINDOW
      );

      if (prior90.length >= SLOW_REGIME_MIN_PRIOR) {
        const recentAvg = mean(recent90);
        const priorAvg = mean(prior90);
        const drop = priorAvg > 0 ? (priorAvg - recentAvg) / priorAvg : 0;

        if (drop > SLOW_REGIME_DROP_THRESHOLD) {
          slowRegimeInfo = {
            holtLevelBefore: holt.level,
            holtTrendBefore: holt.trend,
            recentAvg,
            priorAvg,
            drop,
            recent90Days: recent90.length,
            prior90Days: prior90.length,
          };
          // Override level to the recent 90d average (more responsive than Holt).
          // Drop trend too — we don't trust projection direction during a decline.
          holt.level = recentAvg;
          holt.trend = 0;
          slowRegimeApplied = true;
        }
      }
    }
  }

  // [FIX-3] Tracking signal gate: if |TS| > 4, trust level only, drop trend.
  // This is the single most important fix for cases like JLS-1265 where the
  // Holt is systematically biased and compensates by inflating trend.
  const ts = calcTrackingSignal(clean, holt);
  const effectiveTrend = ts.exceeded ? 0 : holt.trend;
  const trendGatedByTS = ts.exceeded && holt.trend !== 0;

  // Step 3: integrate level + (damped trend) over targetDoc days, × seasonal factor
  const today = new Date();
  const curMonth = today.getMonth();
  const curShape = seasonalProfile?.lastYearShape?.[curMonth] ?? 1.0;
  const hasSeas = !!(seasonalProfile && seasonalProfile.hasHistory);

  let fromLevel = 0, fromTrend = 0, fromSeasonal = 0, total = 0;
  for (let d = 0; d < td; d++) {
    const date = new Date(today.getTime() + d * 86400000);
    const mi = date.getMonth();
    const baseLevel = holt.level;

    // [FIX-1] Damped trend
    const phi = TREND_DAMPING_PHI;
    const horizon = d + 1;
    const dampedTrendContrib = effectiveTrend === 0
      ? 0
      : effectiveTrend * phi * (1 - Math.pow(phi, horizon)) / (1 - phi);

    const pointForecast = Math.max(0, baseLevel + dampedTrendContrib);

    let seasFactor = 1.0;
    if (hasSeas) {
      const shape = seasonalProfile.lastYearShape[mi] ?? 1.0;
      const rawNorm = curShape > 0 ? shape / curShape : 1.0;
      seasFactor = 1 + (rawNorm - 1) * DAMP;
    }
    const dayDemand = pointForecast * seasFactor;

    fromLevel += baseLevel;
    fromTrend += dampedTrendContrib;
    fromSeasonal += pointForecast * (seasFactor - 1);
    total += dayDemand;
  }
  total = Math.max(0, total);

  // Step 4
  const sigma = calcSigmaLT(clean, lt);
  const safetyStock = Math.max(0, Z * sigma.sigmaLT);

  const flatDemand = Math.max(0, holt.level * td);

  return {
    level: holt.level,
    trend: holt.trend,           // raw trend for display / debugging
    effectiveTrend,              // trend actually used in projection (may be 0 if gated)
    coverageDemand: total,
    flatDemand,
    safetyStock,
    sigmaLT: sigma.sigmaLT,
    Z,
    demandBreakdown: {
      fromLevel: Math.round(fromLevel),
      fromTrend: Math.round(fromTrend),
      fromSeasonal: Math.round(fromSeasonal),
      total: Math.round(total),
    },
    flags: {
      usedHolt: holt.usedHolt,
      shortHistory: holt.shortHistory,
      trendCapped: holt.trendCapped,
      safetyStockFallback: sigma.fallback,
      outliersRemoved: outlierIndices.length,
      trackingSignal: ts.ts,
      trackingSignalExceeded: ts.exceeded,
      trendGatedByTS,
      noData: false,
      recentRegimeApplied,
      recentRegimeInfo,
      slowRegimeApplied,         // [FIX-REGIME-SLOW]
      slowRegimeInfo,            // [FIX-REGIME-SLOW]
    },
    effectiveDSR: holt.level, // for backwards compat
  };
}

// ─── Batch helper (cache friendly) ────────────────────────────────
export function batchBundleForecasts({
  bundles,
  bundleDays,
  vendorsByName,   // { name: vendor }
  abcA,
  seasonalProfiles,
  settings,
  getTargetDoc,    // fn(vendor) → number
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
    });
  }
  return out;
}
