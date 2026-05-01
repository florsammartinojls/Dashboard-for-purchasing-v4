// src/lib/segmentClassifier.js
// ============================================================
// 7-Segment Demand Classifier (v4)
// ============================================================
// Replaces (and subsumes) the 3-regime regimeClassifier:
//   - INTERMITTENT and NEW_OR_SPARSE map directly across.
//   - CONTINUOUS gets split into STABLE / SEASONAL_PEAKED /
//     GROWING / DECLINING / DORMANT_REVIVED depending on shape.
//
// Pure functions. Inputs:
//   - bundleId
//   - bundleDays:    daily series [{j, date, dsr}, ...] — 365d
//   - bundleSales:   monthly summary [{j, y, m, units, avgDsr,
//                                       dataDays}, ...] (optional;
//                    used to bolster seasonality features when
//                    multi-year data exists)
//
// Output (per bundle):
//   { bundleId, segment, confidence, reason, features }
//
// Features computed on the daily series last 365d:
//   cv                    = stdev/mean of daily units
//   peakConcentration     = top-3-month-share of yearly volume
//   seasonalityIndex      = variance(monthly_means) /
//                           mean(within_month_variance)
//   trendRatio            = avg(last 90d) / avg(days 91-180 ago)
//   recentActivity        = days_with_sales(last 30d) / 30
//   historicalActivity    = days_with_sales(180-365 ago) / 185
//   zeroRatio             = zero_days / total_days
//   totalDays             = days with any record
// ============================================================

const ZERO = 1e-9;

// Thresholds — kept here as exported constants so they can be
// referenced from the Glossary tab and tuned later if needed.
export const T = {
  // Hard rule thresholds (from spec §2.3, "first match wins")
  MIN_DAYS_FOR_HISTORY: 30,            // <30d → NEW_OR_SPARSE
  INTERMITTENT_ZERO_RATIO: 0.50,       // ≥50% zero days → INTERMITTENT
  DORMANT_HIST_LOW: 0.30,              // historical activity < 0.30
  DORMANT_RECENT_HIGH: 0.50,           // recent > 0.50  → DORMANT_REVIVED
  DORMANT_HIST_HIGH: 0.50,             // historical activity > 0.50
  DORMANT_RECENT_LOW: 0.30,            // recent < 0.30   → DORMANT_REVIVED (going dormant)
  PEAK_CONCENTRATION_HIGH: 0.50,       // peakConcentration > 0.50
  SEASONALITY_INDEX_HIGH: 1.5,         // seasonalityIndex > 1.5  → SEASONAL_PEAKED
  TREND_DECLINING: 0.70,               // trendRatio < 0.70  → DECLINING
  TREND_GROWING: 1.40,                 // trendRatio > 1.40  → GROWING (+ recentActivity > 0.70)
  GROWING_RECENT_FLOOR: 0.70,
  // Confidence band heuristics (clear-cut vs near-boundary)
  PEAK_CONCENTRATION_CLEAR: 0.65,
  SEASONALITY_INDEX_CLEAR: 2.0,
  TREND_DECLINING_CLEAR: 0.55,
  TREND_GROWING_CLEAR: 1.7,
};

export const SEGMENTS = [
  'STABLE',
  'SEASONAL_PEAKED',
  'GROWING',
  'DECLINING',
  'INTERMITTENT',
  'NEW_OR_SPARSE',
  'DORMANT_REVIVED',
];

export const SEGMENT_PRIORITY = {
  // Lower = higher priority for review
  SEASONAL_PEAKED: 1,
  GROWING: 2,
  DECLINING: 3,
  DORMANT_REVIVED: 4,
  INTERMITTENT: 5,
  NEW_OR_SPARSE: 6,
  STABLE: 7,
};

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

function todayDate() {
  return new Date();
}

// ─── Feature computation ────────────────────────────────────────
export function computeFeatures(bundleId, bundleDays, bundleSales) {
  const series = (bundleDays || [])
    .filter(d => d && d.j === bundleId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(-365);

  const today = todayDate();
  const totalDays = series.length;

  if (totalDays === 0) {
    return {
      totalDays: 0, cv: 0, peakConcentration: 0, seasonalityIndex: 0,
      trendRatio: 1, recentActivity: 0, historicalActivity: 0, zeroRatio: 0,
      mean: 0, totalUnits: 0, nonZeroDays: 0, avgWhenSelling: 0,
      monthlyMatrix: null,
    };
  }

  const vals = series.map(p => num(p.dsr));
  const totalUnits = vals.reduce((s, v) => s + v, 0);
  const m = totalUnits / totalDays;
  const cv = m > 0 ? stdev(vals) / m : 0;
  const nonZeroDays = vals.filter(v => v > ZERO).length;
  const zeroRatio = totalDays > 0 ? (totalDays - nonZeroDays) / totalDays : 0;
  const avgWhenSelling = nonZeroDays > 0 ? totalUnits / nonZeroDays : 0;

  // ── Monthly matrix (year → month → daily values) ──
  // Used for peakConcentration and seasonalityIndex.
  const byYearMonth = new Map(); // "YYYY-MM" -> daily values[]
  for (const p of series) {
    if (!p.date) continue;
    const ym = p.date.slice(0, 7);
    let arr = byYearMonth.get(ym);
    if (!arr) { arr = []; byYearMonth.set(ym, arr); }
    arr.push(num(p.dsr));
  }

  // Monthly totals (units in each month) — last 365d only
  const monthlyTotals = new Map();
  for (const [ym, arr] of byYearMonth.entries()) {
    let sum = 0;
    for (const v of arr) sum += v;
    monthlyTotals.set(ym, sum);
  }

  // peakConcentration: sum of top-3 months / total
  let peakConcentration = 0;
  if (monthlyTotals.size >= 3) {
    const sorted = [...monthlyTotals.values()].sort((a, b) => b - a);
    const top3 = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
    const total = sorted.reduce((s, v) => s + v, 0);
    if (total > ZERO) peakConcentration = top3 / total;
  }

  // seasonalityIndex: variance of monthly means / mean of within-month variances
  // Group months across years (use 'M' only). Need at least one year of data.
  // To be robust we incorporate bundleSales (multi-year monthly) when present.
  const monthlyMeansByM = Array.from({ length: 12 }, () => []);
  const monthlyVariancesByM = Array.from({ length: 12 }, () => []);
  for (const [ym, arr] of byYearMonth.entries()) {
    const M = parseInt(ym.slice(5, 7), 10) - 1;
    if (Number.isNaN(M) || M < 0 || M > 11) continue;
    if (arr.length === 0) continue;
    monthlyMeansByM[M].push(mean(arr));
    monthlyVariancesByM[M].push(stdev(arr) * stdev(arr));
  }

  // Augment with bundleSales (monthly summary) if available — gives us
  // multi-year context for stronger seasonality detection.
  if (Array.isArray(bundleSales)) {
    for (const r of bundleSales) {
      if (!r || r.j !== bundleId) continue;
      if (!(r.m >= 1 && r.m <= 12)) continue;
      const dsr = r.avgDsr > 0
        ? r.avgDsr
        : (r.units > 0 && r.dataDays > 0 ? r.units / r.dataDays : 0);
      if (dsr > 0) monthlyMeansByM[r.m - 1].push(dsr);
    }
  }

  const collapsedMeans = monthlyMeansByM.map(a => a.length ? mean(a) : 0).filter(v => v > 0);
  const allWithin = monthlyVariancesByM.flat();
  const meansVar = collapsedMeans.length >= 3 ? stdev(collapsedMeans) ** 2 : 0;
  const meanWithinVar = allWithin.length > 0 ? mean(allWithin) : 0;
  const seasonalityIndex = meanWithinVar > ZERO ? meansVar / meanWithinVar : 0;

  // trendRatio: avg(last 90d) / avg(days 91-180 ago)
  const last90 = vals.slice(-90);
  const prev90 = vals.length >= 180 ? vals.slice(-180, -90) : vals.slice(0, Math.max(0, vals.length - 90));
  const m90 = mean(last90);
  const mp90 = mean(prev90);
  const trendRatio = mp90 > ZERO ? m90 / mp90 : (m90 > 0 ? 999 : 1);

  // recentActivity: days_with_sales(last 30d) / 30
  const last30 = vals.slice(-30);
  const recentActivity = last30.length > 0
    ? last30.filter(v => v > ZERO).length / Math.max(30, last30.length)
    : 0;

  // historicalActivity: days_with_sales(180-365 ago) / 185 (or available window)
  const histStart = Math.max(0, vals.length - 365);
  const histEnd = Math.max(histStart, vals.length - 180);
  const histWindow = vals.slice(histStart, histEnd);
  const histDenom = Math.min(185, histWindow.length);
  const historicalActivity = histDenom > 0
    ? histWindow.filter(v => v > ZERO).length / histDenom
    : 0;

  return {
    totalDays,
    nonZeroDays,
    zeroRatio,
    cv,
    mean: m,
    totalUnits,
    avgWhenSelling,
    peakConcentration,
    seasonalityIndex,
    trendRatio,
    recentActivity,
    historicalActivity,
    monthlyMatrix: byYearMonth,
  };
}

// ─── Classification (per spec §2.3, in order) ───────────────────
function classifyFromFeatures(f) {
  if (f.totalDays < T.MIN_DAYS_FOR_HISTORY) {
    return { segment: 'NEW_OR_SPARSE', reason: `Only ${f.totalDays} days of history (min ${T.MIN_DAYS_FOR_HISTORY}).` };
  }
  if (f.zeroRatio >= T.INTERMITTENT_ZERO_RATIO) {
    return {
      segment: 'INTERMITTENT',
      reason: `${Math.round(f.zeroRatio * 100)}% of days had no sales (${f.totalDays - f.nonZeroDays}/${f.totalDays}).`,
    };
  }
  // Dormant revived (came back to life)
  if (f.historicalActivity < T.DORMANT_HIST_LOW && f.recentActivity > T.DORMANT_RECENT_HIGH) {
    return {
      segment: 'DORMANT_REVIVED',
      reason: `Historical activity ${(f.historicalActivity * 100).toFixed(0)}% but recent ${(f.recentActivity * 100).toFixed(0)}% — coming back to life.`,
    };
  }
  // Going dormant
  if (f.historicalActivity > T.DORMANT_HIST_HIGH && f.recentActivity < T.DORMANT_RECENT_LOW) {
    return {
      segment: 'DORMANT_REVIVED',
      reason: `Historical activity ${(f.historicalActivity * 100).toFixed(0)}% but recent only ${(f.recentActivity * 100).toFixed(0)}% — going dormant.`,
    };
  }
  if (f.peakConcentration > T.PEAK_CONCENTRATION_HIGH && f.seasonalityIndex > T.SEASONALITY_INDEX_HIGH) {
    return {
      segment: 'SEASONAL_PEAKED',
      reason: `Top-3 months hold ${Math.round(f.peakConcentration * 100)}% of yearly volume (seasonality index ${f.seasonalityIndex.toFixed(2)}).`,
    };
  }
  if (f.trendRatio < T.TREND_DECLINING) {
    return {
      segment: 'DECLINING',
      reason: `Last 90d averages ${(f.trendRatio * 100).toFixed(0)}% of the prior 90d — declining.`,
    };
  }
  if (f.trendRatio > T.TREND_GROWING && f.recentActivity > T.GROWING_RECENT_FLOOR) {
    return {
      segment: 'GROWING',
      reason: `Last 90d averages ${(f.trendRatio * 100).toFixed(0)}% of the prior 90d, recent activity ${(f.recentActivity * 100).toFixed(0)}%.`,
    };
  }
  return { segment: 'STABLE', reason: `CV ${f.cv.toFixed(2)}, no significant trend or peak.` };
}

// ─── Confidence (high / medium / low) ───────────────────────────
function confidenceFor(segment, f) {
  if (f.totalDays < 60) return 'low';

  switch (segment) {
    case 'NEW_OR_SPARSE':
      return 'high'; // by definition a clear rule
    case 'INTERMITTENT':
      if (f.zeroRatio >= 0.65) return 'high';
      if (f.zeroRatio >= 0.55) return 'medium';
      return 'low';
    case 'SEASONAL_PEAKED':
      if (f.peakConcentration >= T.PEAK_CONCENTRATION_CLEAR && f.seasonalityIndex >= T.SEASONALITY_INDEX_CLEAR) return 'high';
      if (f.peakConcentration >= 0.55 && f.seasonalityIndex >= 1.7) return 'medium';
      return 'low';
    case 'GROWING':
      if (f.trendRatio >= T.TREND_GROWING_CLEAR && f.recentActivity >= 0.85) return 'high';
      if (f.trendRatio >= 1.55 && f.recentActivity >= 0.75) return 'medium';
      return 'low';
    case 'DECLINING':
      if (f.trendRatio <= T.TREND_DECLINING_CLEAR) return 'high';
      if (f.trendRatio <= 0.62) return 'medium';
      return 'low';
    case 'DORMANT_REVIVED':
      // Tight signal: very low hist + very high recent (or inverse)
      if ((f.historicalActivity <= 0.20 && f.recentActivity >= 0.65)
       || (f.historicalActivity >= 0.65 && f.recentActivity <= 0.20)) return 'high';
      return 'medium';
    case 'STABLE': {
      // Stable is high-confidence when: low CV, no near-rule signal
      const nearPeak = f.peakConcentration >= 0.40;
      const nearSeas = f.seasonalityIndex >= 1.0;
      const nearTrendDown = f.trendRatio <= 0.85;
      const nearTrendUp = f.trendRatio >= 1.20;
      if (f.cv <= 0.25 && !nearPeak && !nearSeas && !nearTrendDown && !nearTrendUp) return 'high';
      if (nearPeak || nearSeas || nearTrendDown || nearTrendUp) return 'low';
      return 'medium';
    }
    default:
      return 'medium';
  }
}

// ─── Public: classify one bundle ────────────────────────────────
export function classifyBundleSegment(bundleId, bundleDays, bundleSales) {
  const features = computeFeatures(bundleId, bundleDays, bundleSales);
  const { segment, reason } = classifyFromFeatures(features);
  const confidence = confidenceFor(segment, features);
  return { bundleId, segment, confidence, reason, features };
}

// ─── Public: classify all bundles in one pass ───────────────────
export function batchClassifySegments({ bundles, bundleDays, bundleSales }) {
  // Pre-group bundleDays by bundle id once — avoids O(N·B) scan.
  const byBundle = new Map();
  for (const d of (bundleDays || [])) {
    if (!d || !d.j) continue;
    let arr = byBundle.get(d.j);
    if (!arr) { arr = []; byBundle.set(d.j, arr); }
    arr.push(d);
  }
  const out = {};
  for (const b of (bundles || [])) {
    if (!b || !b.j) continue;
    const days = byBundle.get(b.j) || [];
    const features = computeFeatures(b.j, days, bundleSales);
    const { segment, reason } = classifyFromFeatures(features);
    const confidence = confidenceFor(segment, features);
    out[b.j] = { bundleId: b.j, segment, confidence, reason, features };
  }
  return out;
}

// ─── Map a v3 regime to a v4 segment, for legacy code paths ─────
export function regimeToSegment(regime) {
  if (regime === 'intermittent') return 'INTERMITTENT';
  if (regime === 'new_or_sparse') return 'NEW_OR_SPARSE';
  return 'STABLE'; // continuous → conservative default
}

// ─── Display helpers ────────────────────────────────────────────
export const SEGMENT_LABELS = {
  STABLE: 'Stable',
  SEASONAL_PEAKED: 'Seasonal · peaked',
  GROWING: 'Growing',
  DECLINING: 'Declining',
  INTERMITTENT: 'Intermittent',
  NEW_OR_SPARSE: 'New / sparse',
  DORMANT_REVIVED: 'Dormant ↔ revived',
};

export const SEGMENT_COLORS = {
  STABLE: 'bg-slate-500/20 text-slate-300 border border-slate-500/40',
  SEASONAL_PEAKED: 'bg-purple-500/20 text-purple-300 border border-purple-500/40',
  GROWING: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  DECLINING: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  INTERMITTENT: 'bg-sky-500/20 text-sky-300 border border-sky-500/40',
  NEW_OR_SPARSE: 'bg-violet-500/20 text-violet-300 border border-violet-500/40',
  DORMANT_REVIVED: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
};

export const CONFIDENCE_COLORS = {
  high: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-red-500/15 text-red-300',
};
