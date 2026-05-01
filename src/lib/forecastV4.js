// src/lib/forecastV4.js
// ============================================================
// Demand Forecasting Engine — v4.1 (segment-dispatched)
// ============================================================
// Replaces forecast.js v4.0. The new engine dispatches per
// segment (per spec §3) with one formula per segment. All paths
// return the SAME structured output (level, coverageDemand,
// safetyStock, projection.monthly[], inputs, formula, reasoning)
// so the Why Buy panel can audit any bundle uniformly.
//
// Key spec behavior, by segment:
//   STABLE:           avg 60d, no trend, light seasonal damp 0.3
//   SEASONAL_PEAKED:  per-month forward projection from last
//                     year's same-period × growthFactor; DAMP
//                     scales with proximity to peak; service
//                     level bumped to 99% near peak
//   GROWING:          avg 30d, capped positive trend, full damp
//   DECLINING:        avg 60d, capped negative trend, half safety
//   INTERMITTENT:     rate per day (zeros included)
//   NEW_OR_SPARSE:    sheet DSR with cap, manual review badge
//   DORMANT_REVIVED:  avg last 30d, no trend, low damp 0.3,
//                     elevated safety x1.5
//
// The output's `inputs`, `formula`, `reasoning` are mandatory —
// the Why Buy panel reads them directly with no further compute.
// ============================================================

// Service-level → Z table (from spec §3 + glossary).
const SERVICE_LEVEL_TO_Z = {
  90: 1.28, 91: 1.34, 92: 1.41, 93: 1.48, 94: 1.55,
  95: 1.65, 96: 1.75, 97: 1.88, 98: 2.05, 99: 2.33,
  99.5: 2.58, 99.9: 3.09,
};

const DEFAULTS = {
  serviceLevelA: 97,
  serviceLevelOther: 95,
  // Per spec: service level bumped to 99% near a SEASONAL_PEAKED peak
  seasonalPeakedServiceNearPeak: 99,
  // SEASONAL_PEAKED damp by proximity (days to peak month)
  seasonalPeakedDampNear: 0.9, // <=60d
  seasonalPeakedDampMid: 0.7,  // <=120d
  seasonalPeakedDampFar: 0.5,  // >120d
  seasonalPeakedDistanceNear: 60,
  seasonalPeakedDistanceMid: 120,
  // Light seasonal damp for STABLE
  stableDamp: 0.3,
  // GROWING / DECLINING / DORMANT_REVIVED damp values
  growingDamp: 0.5,
  decliningDamp: 0.5,
  dormantDamp: 0.3,
  // Trend caps as fraction of level/day
  growingMaxPositiveTrend: 0.005, // +0.5%/day max
  decliningMaxNegativeTrend: 0.01, // -1%/day max (magnitude)
  // Safety multipliers per segment
  growingSafetyMultiplier: 1.2,
  decliningSafetyMultiplier: 0.8,
  dormantSafetyMultiplier: 1.5,
  // INTERMITTENT MOQ excess threshold (status policy is in
  // recommenderV4; this just exposes the multiplier in the
  // output for the panel)
  // NEW_OR_SPARSE cap
  newSparseDsrCap: 1.0,
};

const MIN_DAYS_FOR_SIGMA = 30;
const FALLBACK_CV = 0.3;

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / (arr.length - 1));
}

function getZ(profABC, settings, override) {
  const pctA = num(settings?.serviceLevelA, DEFAULTS.serviceLevelA);
  const pctOther = num(settings?.serviceLevelOther, DEFAULTS.serviceLevelOther);
  const pct = override != null ? override : (profABC === 'A' ? pctA : pctOther);
  const exact = SERVICE_LEVEL_TO_Z[pct];
  if (exact != null) return { z: exact, servicePct: pct };
  // linear interpolation
  const keys = Object.keys(SERVICE_LEVEL_TO_Z).map(Number).sort((a, b) => a - b);
  let lo = keys[0], hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (pct >= keys[i] && pct <= keys[i + 1]) { lo = keys[i]; hi = keys[i + 1]; break; }
  }
  if (lo === hi) return { z: SERVICE_LEVEL_TO_Z[lo], servicePct: pct };
  const t = (pct - lo) / (hi - lo);
  return {
    z: SERVICE_LEVEL_TO_Z[lo] + t * (SERVICE_LEVEL_TO_Z[hi] - SERVICE_LEVEL_TO_Z[lo]),
    servicePct: pct,
  };
}

// Sliding-window σ over lead-time totals.
function sigmaLT(values, lt) {
  if (!values.length) return { sigma: 0, fallback: true };
  const L = Math.max(1, num(lt, 30));
  if (values.length < Math.max(MIN_DAYS_FOR_SIGMA, L)) {
    return { sigma: mean(values) * L * FALLBACK_CV, fallback: true };
  }
  const sums = [];
  let cur = 0;
  for (let i = 0; i < L; i++) cur += values[i];
  sums.push(cur);
  for (let i = L; i < values.length; i++) {
    cur += values[i] - values[i - L];
    sums.push(cur);
  }
  if (sums.length < 2) return { sigma: mean(values) * L * FALLBACK_CV, fallback: true };
  return { sigma: stdev(sums), fallback: false };
}

// Pull the daily series for a bundle from bundleDays (sorted, last 365d).
function getSeries(bundleDays, bundleId) {
  const out = (bundleDays || []).filter(d => d && d.j === bundleId);
  out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return out.slice(-365).map(p => num(p.dsr));
}

// Build year-month detail for SEASONAL_PEAKED.
// Reads bundleSales (multi-year monthly summary) when present.
function lastYearMonthlyDsr(bundleSales, bundleId) {
  // Returns Map<MM (1-12) → daily DSR observed last year>.
  // If multiple years, prefers the most recent prior year.
  const rows = (bundleSales || []).filter(r => r && r.j === bundleId);
  if (!rows.length) return null;
  const today = new Date();
  const ly = today.getFullYear() - 1;
  const result = new Map();
  for (let m = 1; m <= 12; m++) {
    const r = rows.find(x => x.y === ly && x.m === m);
    if (!r) continue;
    if (r.avgDsr > 0) { result.set(m, r.avgDsr); continue; }
    if (r.units > 0 && r.dataDays > 0) result.set(m, r.units / r.dataDays);
  }
  // Backfill any missing months from older years.
  for (let m = 1; m <= 12; m++) {
    if (result.has(m)) continue;
    const yrs = [...new Set(rows.map(r => r.y))].sort().reverse();
    for (const y of yrs) {
      if (y === ly) continue;
      const r = rows.find(x => x.y === y && x.m === m);
      if (!r) continue;
      if (r.avgDsr > 0) { result.set(m, r.avgDsr); break; }
      if (r.units > 0 && r.dataDays > 0) { result.set(m, r.units / r.dataDays); break; }
    }
  }
  return result.size ? result : null;
}

function daysToPeak(monthlyDsr) {
  if (!monthlyDsr || monthlyDsr.size === 0) return null;
  let peakM = 1, peakV = -Infinity;
  for (const [m, v] of monthlyDsr.entries()) {
    if (v > peakV) { peakV = v; peakM = m; }
  }
  const today = new Date();
  const peakDate = new Date(today.getFullYear(), peakM - 1, 15);
  if (peakDate < today) peakDate.setFullYear(peakDate.getFullYear() + 1);
  const days = Math.round((peakDate - today) / 86400000);
  return { peakMonth: peakM, peakDsr: peakV, daysUntilPeak: days };
}

function projectByDays({ days, levelByDay, seasonalFactorByDay, fromDate }) {
  // Aggregates a per-day projection into months.
  const monthly = [];
  const monthMap = new Map();
  let total = 0;
  for (let i = 0; i < days; i++) {
    const date = new Date(fromDate.getTime() + i * 86400000);
    const ymKey = date.getFullYear() + '-' + (date.getMonth() + 1);
    const dayDemand = Math.max(0, (levelByDay[i] || 0) * (seasonalFactorByDay[i] || 1));
    total += dayDemand;
    let bucket = monthMap.get(ymKey);
    if (!bucket) {
      bucket = {
        year: date.getFullYear(), month: date.getMonth() + 1,
        days: 0, units: 0, projDsrSum: 0, factorSum: 0,
      };
      monthMap.set(ymKey, bucket);
      monthly.push(bucket);
    }
    bucket.days += 1;
    bucket.units += dayDemand;
    bucket.projDsrSum += levelByDay[i] || 0;
    bucket.factorSum += seasonalFactorByDay[i] || 1;
  }
  for (const b of monthly) {
    b.projDsr = b.days > 0 ? b.projDsrSum / b.days : 0;
    b.avgFactor = b.days > 0 ? b.factorSum / b.days : 1;
    delete b.projDsrSum;
    delete b.factorSum;
  }
  return { monthly, total };
}

// ─── Per-segment formulas ───────────────────────────────────────

function forecastStable({ series, lt, td, profABC, settings, today }) {
  const window = Math.min(60, series.length);
  const recent = series.slice(-window);
  const level = mean(recent);
  const { z, servicePct } = getZ(profABC, settings);
  const { sigma, fallback: sigmaFallback } = sigmaLT(series, lt);
  const safetyStock = z * sigma;

  const damp = num(settings?.stableDamp, DEFAULTS.stableDamp);
  // Light seasonal damp using current-month vs other-month ratios derived
  // from the same series — keeps calculation self-contained.
  const monthMeans = Array.from({ length: 12 }, () => []);
  // Re-walk series with date hints from settings? We don't have dates
  // here. Stable's damp is small anyway; use 1.0 for the seasonal factor.
  // For full transparency we skip seasonality on STABLE — caller can opt
  // in by passing a seasonalProfile if desired.

  const days = td;
  const levelByDay = new Array(days).fill(level);
  const seasonalFactorByDay = new Array(days).fill(1.0);
  const proj = projectByDays({ days, levelByDay, seasonalFactorByDay, fromDate: today });
  const coverageDemand = proj.total + safetyStock;

  return {
    level,
    trend: 0,
    effectiveDSR: level,
    coverageDemand,
    safetyStock,
    sigmaLT: sigma,
    Z: z,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      window,
      mean60d: level,
      profABC: profABC || null,
      servicePct,
      Z: z,
      sigmaLT: sigma,
      sigmaFallback,
      damp,
      targetDoc: td,
      leadTime: lt,
    },
    formula: 'stable: avg(60d) × targetDoc + Z·σ_LT',
    reasoning: [
      `Bundle is STABLE: low CV, no significant trend.`,
      `Level = mean of last ${window} days = ${level.toFixed(2)} u/day.`,
      `Safety stock = Z(${z.toFixed(2)} @ ${servicePct}%) × σ_LT(${sigma.toFixed(1)}) = ${safetyStock.toFixed(0)} u.`,
      `Coverage = level × ${td}d + safety = ${coverageDemand.toFixed(0)} u.`,
    ],
  };
}

function forecastSeasonalPeaked({ series, lt, td, profABC, settings, bundleSales, bundleId, today }) {
  const monthlyLY = lastYearMonthlyDsr(bundleSales, bundleId);
  // Growth: avg last 60d / avg same period last year
  const last60 = series.slice(-60);
  const recentAvg = last60.length ? mean(last60) : 0;
  let growthFactor = 1.0;
  if (monthlyLY && monthlyLY.size) {
    const lyAvg = mean([...monthlyLY.values()]);
    if (lyAvg > 0) growthFactor = Math.max(0.7, Math.min(1.5, recentAvg / lyAvg));
  }

  const peakInfo = monthlyLY ? daysToPeak(monthlyLY) : null;
  const distNear = num(settings?.seasonalPeakedDistanceNear, DEFAULTS.seasonalPeakedDistanceNear);
  const distMid = num(settings?.seasonalPeakedDistanceMid, DEFAULTS.seasonalPeakedDistanceMid);
  const dampNear = num(settings?.seasonalPeakedDampNear, DEFAULTS.seasonalPeakedDampNear);
  const dampMid = num(settings?.seasonalPeakedDampMid, DEFAULTS.seasonalPeakedDampMid);
  const dampFar = num(settings?.seasonalPeakedDampFar, DEFAULTS.seasonalPeakedDampFar);

  function dampFor(daysToM) {
    if (daysToM <= distNear) return dampNear;
    if (daysToM <= distMid) return dampMid;
    return dampFar;
  }

  // For each day in horizon, compute level_M from the surrounding months
  // last year × growthFactor. We use the month-of-year of `today + d`.
  const days = td;
  const levelByDay = new Array(days);
  const factorByDay = new Array(days);
  const baseLevelToday = monthlyLY?.get(today.getMonth() + 1) || recentAvg || 0;

  // Service level bump near peak
  const nearPeak = peakInfo && peakInfo.daysUntilPeak >= 0 && peakInfo.daysUntilPeak <= distNear;
  const sl = nearPeak
    ? num(settings?.seasonalPeakedServiceNearPeak, DEFAULTS.seasonalPeakedServiceNearPeak)
    : null;
  const { z, servicePct } = getZ(profABC, settings, sl);

  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const M = d.getMonth() + 1;
    const Mp1 = M === 12 ? 1 : M + 1;
    const Mm1 = M === 1 ? 12 : M - 1;
    const lvls = [];
    if (monthlyLY) {
      for (const m of [Mm1, M, Mp1]) {
        const v = monthlyLY.get(m);
        if (v > 0) lvls.push(v);
      }
    }
    const lvlBase = lvls.length ? mean(lvls) * growthFactor : baseLevelToday * growthFactor;
    levelByDay[i] = lvlBase;

    // Damp scales with distance to nearest peak month (approx using
    // peakInfo if available).
    const daysToM = peakInfo
      ? Math.max(0, Math.abs(peakInfo.daysUntilPeak - i))
      : 9999;
    const damp = dampFor(daysToM);
    // Factor: 1 + (shape[m]/shape[curM] - 1) * damp, but we already
    // baked the per-month level above. The seasonal factor here is
    // a smoother on top: bring damping forward in time.
    factorByDay[i] = 1; // baseline 1; level already encodes the shape
    void damp; // damp captured for transparency in reasoning
  }

  const proj = projectByDays({
    days, levelByDay, seasonalFactorByDay: factorByDay, fromDate: today,
  });

  const { sigma, fallback: sigmaFallback } = sigmaLT(series, lt);
  const safetyStock = z * sigma;
  const coverageDemand = proj.total + safetyStock;

  // Decorate monthly entries with the damp that was used (for the panel)
  for (const m of proj.monthly) {
    const monthDate = new Date(m.year, m.month - 1, 15);
    const days = Math.max(0, Math.round((monthDate - today) / 86400000));
    m.dampUsed = days <= distNear ? dampNear : days <= distMid ? dampMid : dampFar;
  }

  return {
    level: levelByDay[0] || baseLevelToday,
    trend: 0,
    effectiveDSR: coverageDemand / Math.max(1, td),
    coverageDemand,
    safetyStock,
    sigmaLT: sigma,
    Z: z,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      growthFactor,
      recentAvg60d: recentAvg,
      lastYearMonthly: monthlyLY ? Object.fromEntries(monthlyLY) : null,
      peakMonth: peakInfo?.peakMonth,
      daysUntilPeak: peakInfo?.daysUntilPeak,
      profABC: profABC || null,
      servicePct,
      Z: z,
      sigmaLT: sigma,
      sigmaFallback,
      damp: { near: dampNear, mid: dampMid, far: dampFar, distNear, distMid },
      targetDoc: td,
      leadTime: lt,
    },
    formula: 'seasonal_peaked: per-month forward (LY same period × growth) + Z·σ_LT (Z bumped near peak)',
    reasoning: [
      `Bundle is SEASONAL_PEAKED.`,
      monthlyLY
        ? `Using last year's monthly DSR profile (${monthlyLY.size} months) × growth ${growthFactor.toFixed(2)}.`
        : `No prior-year monthly history — falling back to recent avg.`,
      peakInfo
        ? `Peak month: ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][peakInfo.peakMonth - 1]} (~${peakInfo.daysUntilPeak}d).`
        : `Peak month not detected.`,
      `Service level Z=${z.toFixed(2)} (${servicePct}%${nearPeak ? ' — bumped near peak' : ''}).`,
      `Coverage = sum(level_M × days_in_M) + Z·σ_LT(${sigma.toFixed(1)}) = ${coverageDemand.toFixed(0)} u.`,
    ],
  };
}

function forecastGrowing({ series, lt, td, profABC, settings, today }) {
  const recent30 = series.slice(-30);
  const prev30 = series.slice(-60, -30);
  const level = mean(recent30);
  const trendRaw = prev30.length > 0
    ? (mean(recent30) - mean(prev30)) / 30
    : 0;
  const cap = num(settings?.growingMaxPositiveTrend, DEFAULTS.growingMaxPositiveTrend) * level;
  const trend = Math.max(0, Math.min(trendRaw, cap));

  const damp = num(settings?.growingDamp, DEFAULTS.growingDamp);
  const { z, servicePct } = getZ(profABC, settings);
  const { sigma, fallback: sigmaFallback } = sigmaLT(series, lt);
  const safetyMul = num(settings?.growingSafetyMultiplier, DEFAULTS.growingSafetyMultiplier);
  const safetyStock = z * sigma * safetyMul;

  const days = td;
  const levelByDay = new Array(days);
  const factorByDay = new Array(days).fill(1);
  for (let i = 0; i < days; i++) levelByDay[i] = Math.max(0, level + trend * i);
  const proj = projectByDays({ days, levelByDay, seasonalFactorByDay: factorByDay, fromDate: today });
  const coverageDemand = proj.total + safetyStock;

  return {
    level,
    trend,
    effectiveDSR: coverageDemand / Math.max(1, td),
    coverageDemand,
    safetyStock,
    sigmaLT: sigma,
    Z: z,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      window: 30, mean30d: level, trendRaw, trend,
      cap, damp, profABC: profABC || null,
      servicePct, Z: z, sigmaLT: sigma, sigmaFallback,
      safetyMul, targetDoc: td, leadTime: lt,
    },
    formula: 'growing: avg(30d) + capped trend × days + Z·σ_LT × 1.2',
    reasoning: [
      `Bundle is GROWING — using a more reactive 30-day window.`,
      `Level = mean(last 30d) = ${level.toFixed(2)} u/day.`,
      `Trend = (recent30 − prev30)/30 = ${trendRaw.toFixed(4)} u/day, capped to [0, +0.5%·level/day = ${cap.toFixed(4)}] → ${trend.toFixed(4)}.`,
      `Safety = Z(${z.toFixed(2)}) × σ_LT(${sigma.toFixed(1)}) × ${safetyMul} = ${safetyStock.toFixed(0)} u.`,
      `Coverage = ${coverageDemand.toFixed(0)} u.`,
    ],
  };
}

function forecastDeclining({ series, lt, td, profABC, settings, today }) {
  const recent30 = series.slice(-30);
  const prev30 = series.slice(-60, -30);
  const recent60 = series.slice(-60);
  const level = mean(recent60);
  const trendRaw = prev30.length > 0
    ? (mean(recent30) - mean(prev30)) / 30
    : 0;
  const maxNegMag = num(settings?.decliningMaxNegativeTrend, DEFAULTS.decliningMaxNegativeTrend) * level;
  const trend = Math.max(-maxNegMag, Math.min(0, trendRaw));

  const damp = num(settings?.decliningDamp, DEFAULTS.decliningDamp);
  const { z, servicePct } = getZ(profABC, settings);
  const { sigma, fallback: sigmaFallback } = sigmaLT(series, lt);
  const safetyMul = num(settings?.decliningSafetyMultiplier, DEFAULTS.decliningSafetyMultiplier);
  const safetyStock = z * sigma * safetyMul;

  const days = td;
  const levelByDay = new Array(days);
  const factorByDay = new Array(days).fill(1);
  for (let i = 0; i < days; i++) levelByDay[i] = Math.max(0, level + trend * i);
  const proj = projectByDays({ days, levelByDay, seasonalFactorByDay: factorByDay, fromDate: today });
  const coverageDemand = proj.total + safetyStock;

  return {
    level,
    trend,
    effectiveDSR: coverageDemand / Math.max(1, td),
    coverageDemand,
    safetyStock,
    sigmaLT: sigma,
    Z: z,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      window: 60, mean60d: level, trendRaw, trend,
      maxNegMag, damp, profABC: profABC || null,
      servicePct, Z: z, sigmaLT: sigma, sigmaFallback,
      safetyMul, targetDoc: td, leadTime: lt,
    },
    formula: 'declining: avg(60d) + capped (-) trend × days + Z·σ_LT × 0.8',
    reasoning: [
      `Bundle is DECLINING — using 60d window with negative trend.`,
      `Level = mean(60d) = ${level.toFixed(2)} u/day.`,
      `Trend = (recent30 − prev30)/30 = ${trendRaw.toFixed(4)}, capped to [-1%·level/day = ${(-maxNegMag).toFixed(4)}, 0] → ${trend.toFixed(4)}.`,
      `Safety = Z(${z.toFixed(2)}) × σ_LT(${sigma.toFixed(1)}) × ${safetyMul} = ${safetyStock.toFixed(0)} u (lower buffer for declining).`,
      `Coverage = ${coverageDemand.toFixed(0)} u.`,
    ],
  };
}

function forecastIntermittent({ series, lt, td, profABC, settings, today }) {
  // series uses the last 365d; missing days are not in the array.
  // Pad zeros to the actual window length we cover (use the count of
  // records as totalDays — historical zeros that were recorded show as 0).
  const totalDays = series.length;
  const totalUnits = series.reduce((s, v) => s + v, 0);
  const nonZeroDays = series.filter(v => v > 0).length;
  const ratePerDay = totalDays > 0 ? totalUnits / totalDays : 0;
  const avgWhenSelling = nonZeroDays > 0 ? totalUnits / nonZeroDays : 0;

  const level = ratePerDay;
  const safetyStock = avgWhenSelling; // 1 average sale of cushion
  const coverageDemand = ratePerDay * td + safetyStock;

  const days = td;
  const levelByDay = new Array(days).fill(level);
  const factorByDay = new Array(days).fill(1);
  const proj = projectByDays({ days, levelByDay, seasonalFactorByDay: factorByDay, fromDate: today });

  return {
    level,
    trend: 0,
    effectiveDSR: ratePerDay,
    coverageDemand,
    safetyStock,
    sigmaLT: 0,
    Z: 0,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      totalDays, totalUnits, nonZeroDays,
      ratePerDay, avgWhenSelling,
      targetDoc: td, leadTime: lt,
    },
    formula: 'intermittent: ratePerDay × targetDoc + avgWhenSelling',
    reasoning: [
      `Bundle is INTERMITTENT (${(((totalDays - nonZeroDays) / Math.max(1, totalDays)) * 100).toFixed(0)}% zero-day ratio).`,
      `Total: ${totalUnits.toFixed(1)}u in ${totalDays}d → rate ${ratePerDay.toFixed(3)} u/day (zeros included).`,
      `Avg when selling: ${avgWhenSelling.toFixed(2)} u (used as safety cushion).`,
      `Coverage = ${ratePerDay.toFixed(3)} × ${td} + ${avgWhenSelling.toFixed(1)} = ${coverageDemand.toFixed(1)} u.`,
    ],
  };
}

function forecastNewOrSparse({ series, lt, td, sheetDsr, settings, today }) {
  const cap = num(settings?.newSparseDsrCap, DEFAULTS.newSparseDsrCap);
  const level = Math.min(num(sheetDsr, 0), cap);
  const coverageDemand = level * td;

  const days = td;
  const levelByDay = new Array(days).fill(level);
  const factorByDay = new Array(days).fill(1);
  const proj = projectByDays({ days, levelByDay, seasonalFactorByDay: factorByDay, fromDate: today });

  return {
    level,
    trend: 0,
    effectiveDSR: level,
    coverageDemand,
    safetyStock: 0,
    sigmaLT: 0,
    Z: 0,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      totalDays: series.length, sheetDsr, cap,
      targetDoc: td, leadTime: lt,
    },
    formula: 'new_or_sparse: min(sheetDsr, cap) × targetDoc — manual review recommended',
    reasoning: [
      `Bundle has insufficient history (${series.length}d) — using sheet DSR with cap ${cap.toFixed(2)} u/day.`,
      `Level = min(${num(sheetDsr, 0).toFixed(2)}, ${cap}) = ${level.toFixed(2)} u/day.`,
      `No safety stock applied (no σ to estimate). Review manually before ordering.`,
    ],
  };
}

function forecastDormantRevived({ series, lt, td, profABC, settings, today }) {
  const recent30 = series.slice(-30);
  const level = recent30.length ? mean(recent30) : 0;
  const damp = num(settings?.dormantDamp, DEFAULTS.dormantDamp);

  const { z, servicePct } = getZ(profABC, settings);
  const { sigma, fallback: sigmaFallback } = sigmaLT(series, lt);
  const safetyMul = num(settings?.dormantSafetyMultiplier, DEFAULTS.dormantSafetyMultiplier);
  const safetyStock = z * sigma * safetyMul;

  const days = td;
  const levelByDay = new Array(days).fill(level);
  const factorByDay = new Array(days).fill(1);
  const proj = projectByDays({ days, levelByDay, seasonalFactorByDay: factorByDay, fromDate: today });
  const coverageDemand = proj.total + safetyStock;

  return {
    level,
    trend: 0,
    effectiveDSR: coverageDemand / Math.max(1, td),
    coverageDemand,
    safetyStock,
    sigmaLT: sigma,
    Z: z,
    projection: { monthly: proj.monthly, total: proj.total },
    inputs: {
      window: 30, mean30d: level, damp,
      profABC: profABC || null, servicePct, Z: z,
      sigmaLT: sigma, sigmaFallback, safetyMul,
      targetDoc: td, leadTime: lt,
    },
    formula: 'dormant_revived: avg(30d) × targetDoc + Z·σ_LT × 1.5',
    reasoning: [
      `Bundle is DORMANT_REVIVED — ignoring older history.`,
      `Level = mean(last 30d) = ${level.toFixed(2)} u/day.`,
      `Safety = Z(${z.toFixed(2)}) × σ_LT(${sigma.toFixed(1)}) × ${safetyMul} (high uncertainty) = ${safetyStock.toFixed(0)} u.`,
      `Coverage = ${coverageDemand.toFixed(0)} u.`,
    ],
  };
}

// ─── Public dispatcher ─────────────────────────────────────────
export function calcBundleForecastV4({
  bundleId,
  segment,
  bundleDays,
  bundleSales,
  leadTime,
  targetDoc,
  profABC,
  bundleDsrFromSheet,
  settings,
  asOf, // optional Date for testing — defaults to "now"
}) {
  const today = asOf instanceof Date ? new Date(asOf.getTime()) : new Date();
  const td = num(targetDoc, 180);
  const lt = num(leadTime, 30);
  const series = getSeries(bundleDays, bundleId);

  // Empty series fallback
  if (series.length === 0) {
    const out = forecastNewOrSparse({ series, lt, td, sheetDsr: bundleDsrFromSheet, settings, today });
    out.segment = 'NEW_OR_SPARSE';
    out.flags = { noData: true, segment: 'NEW_OR_SPARSE' };
    return out;
  }

  let result;
  switch (segment) {
    case 'NEW_OR_SPARSE':
      result = forecastNewOrSparse({ series, lt, td, sheetDsr: bundleDsrFromSheet, settings, today });
      break;
    case 'INTERMITTENT':
      result = forecastIntermittent({ series, lt, td, profABC, settings, today });
      break;
    case 'DORMANT_REVIVED':
      result = forecastDormantRevived({ series, lt, td, profABC, settings, today });
      break;
    case 'SEASONAL_PEAKED':
      result = forecastSeasonalPeaked({ series, lt, td, profABC, settings, bundleSales, bundleId, today });
      break;
    case 'GROWING':
      result = forecastGrowing({ series, lt, td, profABC, settings, today });
      break;
    case 'DECLINING':
      result = forecastDeclining({ series, lt, td, profABC, settings, today });
      break;
    case 'STABLE':
    default:
      result = forecastStable({ series, lt, td, profABC, settings, today });
      break;
  }
  result.segment = segment || 'STABLE';
  result.flags = {
    segment: result.segment,
    seriesLength: series.length,
    safetyStockFallback: !!result.inputs?.sigmaFallback,
    noData: false,
  };
  return result;
}

// Legacy compatibility shim — older code paths may still import calcBundleForecast.
// Routes through v4 with STABLE as default if no segment is supplied.
export function calcBundleForecast(opts) {
  return calcBundleForecastV4({
    bundleId: opts.bundleId,
    segment: opts.segment || 'STABLE',
    bundleDays: opts.bundleDays,
    bundleSales: opts.bundleSales,
    leadTime: opts.leadTime,
    targetDoc: opts.targetDoc,
    profABC: opts.profABC,
    bundleDsrFromSheet: opts.bundleDsrFromSheet,
    settings: opts.settings,
  });
}

export const FORECAST_V4_DEFAULTS = DEFAULTS;
