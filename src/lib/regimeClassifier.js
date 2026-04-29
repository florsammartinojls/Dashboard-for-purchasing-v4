// src/lib/regimeClassifier.js
// ============================================================
// Demand Regime Classifier
// ============================================================
// Decide qué tipo de demanda tiene cada bundle ANTES de forecast.
// Tres regímenes posibles:
//
//   1. CONTINUOUS — vende casi todos los días.
//      Holt + seasonal funciona bien. Engine actual.
//
//   2. INTERMITTENT — vende esporádicamente (muchos días en cero).
//      Holt sobreestima groseramente porque su filter de >0
//      ignora los ceros. Usamos tasa promedio sobre la ventana
//      total (zeros incluidos) → "vendí 4 unidades en 30 días"
//      → 0.13 unidades/día, no 4.
//
//   3. NEW_OR_SPARSE — < 30 días de historia.
//      Imposible forecast confiable. Usamos DSR plano de la
//      planilla con cap conservador (no extrapolamos).
//
// El clasificador NO toca cantidades — solo etiqueta. forecast.js
// y recommender.js leen la etiqueta y aplican la fórmula correcta.
// ============================================================

// % of zero-sale days en la ventana para considerar intermitente.
// 0.50 = mitad o más de los días sin venta → intermitente.
// Conservador a propósito: preferimos sub-buy a over-buy.
export const INTERMITTENT_ZERO_RATIO = 0.50;

// Mínimo de días con datos para considerar la historia "suficiente".
// < 30 días → régimen NEW_OR_SPARSE.
export const MIN_DAYS_FOR_REGIME = 30;

// Ventana de análisis (alineada con forecast.js).
export const REGIME_WINDOW_DAYS = 365;

// Cap conservador para new/sparse: no proyectar más que esto × DSR.
// Si DSR plano es muy alto y solo tenemos 10 días, no vamos a
// confiar en él al 100%.
export const NEW_SPARSE_DSR_CAP = 1.0;

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

/**
 * Clasifica el régimen de demanda de UN bundle.
 *
 * @param {string} bundleId
 * @param {Array} bundleDays - [{ j, date, dsr }, ...]
 * @returns {Object} {
 *   regime: 'continuous' | 'intermittent' | 'new_or_sparse',
 *   totalDays: number,           // días con cualquier dato (>0 o =0)
 *   nonZeroDays: number,
 *   zeroDays: number,
 *   zeroRatio: number,           // 0..1
 *   totalUnits: number,          // suma de DSR sobre la ventana
 *   ratePerDay: number,          // totalUnits / totalDays (incluye ceros)
 *   avgWhenSelling: number,      // promedio de los días con venta > 0
 *   reason: string,              // explicación human-readable
 * }
 */
export function classifyDemandRegime(bundleId, bundleDays) {
  const series = (bundleDays || [])
    .filter(d => d && d.j === bundleId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(-REGIME_WINDOW_DAYS);

  const totalDays = series.length;

  if (totalDays < MIN_DAYS_FOR_REGIME) {
    return {
      regime: 'new_or_sparse',
      totalDays,
      nonZeroDays: 0,
      zeroDays: 0,
      zeroRatio: 0,
      totalUnits: 0,
      ratePerDay: 0,
      avgWhenSelling: 0,
      reason: `Solo ${totalDays} días de historia (mínimo ${MIN_DAYS_FOR_REGIME}). Usar DSR plano con cap conservador.`,
    };
  }

  const vals = series.map(p => num(p.dsr));
  const nonZero = vals.filter(v => v > 0);
  const nonZeroDays = nonZero.length;
  const zeroDays = totalDays - nonZeroDays;
  const zeroRatio = totalDays > 0 ? zeroDays / totalDays : 0;
  const totalUnits = vals.reduce((s, v) => s + v, 0);
  const ratePerDay = totalDays > 0 ? totalUnits / totalDays : 0;
  const avgWhenSelling = nonZeroDays > 0 ? totalUnits / nonZeroDays : 0;

  if (zeroRatio >= INTERMITTENT_ZERO_RATIO) {
    return {
      regime: 'intermittent',
      totalDays,
      nonZeroDays,
      zeroDays,
      zeroRatio,
      totalUnits,
      ratePerDay,
      avgWhenSelling,
      reason: `${Math.round(zeroRatio * 100)}% de los días sin venta (${zeroDays}/${totalDays}). Holt sobreestimaría. Usar tasa promedio real: ${ratePerDay.toFixed(3)} u/día.`,
    };
  }

  return {
    regime: 'continuous',
    totalDays,
    nonZeroDays,
    zeroDays,
    zeroRatio,
    totalUnits,
    ratePerDay,
    avgWhenSelling,
    reason: `Vende ${Math.round((1 - zeroRatio) * 100)}% de los días. Forecast normal con Holt + seasonal.`,
  };
}

/**
 * Calcula la cobertura para un bundle según su régimen.
 *
 * Esta es la función que reemplaza el cálculo de coverageDemand
 * para los regímenes intermittent y new_or_sparse. Para continuous
 * se sigue usando calcBundleForecast normal.
 *
 * @param {Object} regimeInfo - output de classifyDemandRegime
 * @param {number} targetDoc
 * @param {number} bundleDsrFromSheet - DSR plano de la planilla (b.cd)
 * @returns {Object} {
 *   coverageDemand: number,
 *   safetyStock: number,
 *   effectiveDSR: number,
 *   method: string,            // descripción del método usado
 * }
 */
export function calcRegimeCoverage(regimeInfo, targetDoc, bundleDsrFromSheet) {
  const td = num(targetDoc, 180);
  const sheetDsr = num(bundleDsrFromSheet, 0);

  if (regimeInfo.regime === 'intermittent') {
    // Tasa real sobre la ventana. Si vendí 4 unidades en 30 días,
    // mi tasa es 4/30 = 0.13/día. En 180 días esperaría vender
    // 180 × 0.13 = 24 unidades. NADA de proyectar 4×180 = 720.
    const coverageDemand = regimeInfo.ratePerDay * td;

    // Safety stock para intermitente: 1 venta promedio extra.
    // Es una heurística simple pero defensible — si vendés ~4
    // unidades por venta, llevá 4 extra de cushion.
    const safetyStock = regimeInfo.avgWhenSelling;

    // effDSR para waterfall: la tasa real, no el pico de venta.
    const effectiveDSR = regimeInfo.ratePerDay;

    return {
      coverageDemand: Math.max(0, coverageDemand),
      safetyStock: Math.max(0, safetyStock),
      effectiveDSR: Math.max(0.001, effectiveDSR),
      method: `intermittent: ${regimeInfo.totalUnits.toFixed(1)}u en ${regimeInfo.totalDays}d → ${regimeInfo.ratePerDay.toFixed(3)}u/día × ${td}d`,
    };
  }

  if (regimeInfo.regime === 'new_or_sparse') {
    // Para nuevos: usar DSR plano de la planilla pero capeado.
    // No queremos proyectar agresivamente con poca historia.
    const cappedDsr = Math.min(sheetDsr, NEW_SPARSE_DSR_CAP);
    const coverageDemand = cappedDsr * td;

    // Sin safety stock para nuevos — no hay base para estimar σ.
    // El usuario verá el badge "NEW" y decide manualmente.
    const safetyStock = 0;

    return {
      coverageDemand: Math.max(0, coverageDemand),
      safetyStock,
      effectiveDSR: Math.max(0.001, cappedDsr),
      method: `new_or_sparse: DSR ${sheetDsr.toFixed(2)} (cap ${NEW_SPARSE_DSR_CAP}) × ${td}d`,
    };
  }

  // continuous → null indica que el caller debe usar Holt normal
  return null;
}

/**
 * Helper: clasifica todos los bundles de una sola pasada.
 * Más eficiente que llamar uno por uno cuando hay muchos.
 */
export function batchClassifyRegimes(bundleIds, bundleDays) {
  const out = {};
  for (const id of bundleIds) {
    if (!id) continue;
    out[id] = classifyDemandRegime(id, bundleDays);
  }
  return out;
}
