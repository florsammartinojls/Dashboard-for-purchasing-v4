// src/lib/recommender.js
// ============================================================
// v3.4 Purchase Recommendation Engine
// ============================================================
// NEW in v3.4:
//   [FIX-INTERMITTENT] Clasificación de régimen ANTES de forecast.
//     Cada bundle se clasifica en continuous / intermittent /
//     new_or_sparse según % de días con venta cero. forecast.js
//     dispatcha al método correcto. Resultado: para bundles que
//     venden 4 unidades cada 30 días, ahora la recomendación es
//     ~24 unidades para 180 días, no 720.
//
//   [FIX-CONSISTENCY] Force Cores y Force Bundles ahora son SOLO
//     un switch de buyMode — el cálculo numérico es idéntico al
//     de Mix. PurchTab.fillR debe pasar bundleDays/coreDays/abcA
//     cuando llama directo (ver fix en PurchTab.jsx).
//
// Carried from v3.3:
//   effDSR = coverageDemand / targetDoc, regla única en todos los
//   puntos de decisión.
// ===========================================================

import { calcBundleSeasonalProfile, DEFAULT_PROFILE } from './seasonal.js';
import { calcBundleForecast, calcHistoricSamePeriod } from './forecast.js';
import { detectVendorAnomalies } from './anomalyDetector.js';
import { classifyDemandRegime } from './regimeClassifier.js';

export const MAX_YOY_RATIO = 1.5;
export const MIN_HISTORIC_FOR_YOY = 30;

function parseNoteVendor(note) {
  if (!note) return { kind: 'unknown', name: null };
  const n = String(note).trim();
  const m = n.match(/^(.+?)\s+-\s+/);
  if (m) return { kind: 'named', name: m[1].trim() };
  return { kind: 'unnamed', name: null };
}

// Detecta si una compra es de China basado en costos de import
// (en vez del formato del note, que no es confiable)
function isChinaPurchase(row) {
  const inb = Number(row?.inbShip) || 0;
  const tar = Number(row?.tariffs) || 0;
  return inb > 0 || tar > 0;
}

function isChinaVendor(vendor) {
  const c = (vendor?.country || '').toLowerCase().trim();
  return c === 'china' || c === 'cn' || c === 'prc';
}

function getVendorCoreUnitCost(coreId, vendor, paymentHistory, priceIndex) {
  if (!coreId || !vendor?.name) return null;
  const cid = coreId.toLowerCase().trim();
  const vName = vendor.name.toLowerCase().trim();
  const china = isChinaVendor(vendor);

  // Prefer the pre-built index when available — avoids scanning the
  // full priceCompFull (potentially 100k+ rows) per call.
  let candidates = null;
  if (priceIndex && priceIndex.pricesByCoreLower) {
    candidates = priceIndex.pricesByCoreLower.get(cid) || null;
    if (!candidates) return null;
  } else if (Array.isArray(paymentHistory)) {
    candidates = paymentHistory;
  } else {
    return null;
  }

  let best = null;
  for (const r of candidates) {
    if (!r) continue;
    // If we used the index, core already matches. Otherwise re-check.
    if (!priceIndex && (r.core || '').toLowerCase().trim() !== cid) continue;
    const pcs = Number(r.pcs);
    const mat = Number(r.matPrice);
    if (!(pcs > 0) || !(mat > 0)) continue;

    let matches = false;
    if (china) {
      matches = isChinaPurchase(r);
    } else {
      if (isChinaPurchase(r)) continue;
      const parsed = parseNoteVendor(r.note);
      if (parsed.kind !== 'named' || !parsed.name) continue;
      const noteName = parsed.name.toLowerCase();
      matches = noteName === vName || noteName.includes(vName) || vName.includes(noteName);
    }
    if (!matches) continue;
    if (!best || (r.date || '') > (best.date || '')) best = r;
  }
  if (!best) return null;
  return Number(best.matPrice) / Number(best.pcs);
}

export const DEFAULT_SPIKE_THRESHOLD = 1.25;
export const DEFAULT_MOQ_INFLATION_THRESHOLD = 1.5;
const LEVELING_STEP_DAYS = 10;
const MAX_WATERFALL_ITER = 100;

function num(x, d = 0) { const n = Number(x); return Number.isFinite(n) ? n : d; }
function isDomestic(country) {
  const c = (country || '').toLowerCase().trim();
  return c === '' || c === 'us' || c === 'usa' || c === 'united states';
}
function getTargetDoc(vendor, settings) {
  return isDomestic(vendor?.country)
    ? num(settings?.domesticDoc, 90)
    : num(settings?.intlDoc, 180);
}

function bundleAssignedInv(b, replenMap, missingMap) {
  const rp = (replenMap && replenMap[b.j]) || {};
  const inb7fBundle = (missingMap && missingMap[b.j]) || 0;
  return num(b.fibInv) + num(rp.pprcUnits) + num(rp.batched) + num(inb7fBundle);
}

function coresOf(b) {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const cid = b['core' + i];
    const q = num(b['qty' + i]);
    if (cid && q > 0) out.push({ coreId: cid, qty: q });
  }
  return out;
}

function isActiveBundle(b, settings) {
  if (!b) return false;
  const bA = settings?.bA || 'yes';
  const bI = settings?.bI || 'blank';
  if (bA === 'yes' && b.active !== 'Yes') return false;
  if (bA === 'no' && b.active === 'Yes') return false;
  if (bI === 'blank' && !!b.ignoreUntil) return false;
  if (bI === 'set' && !b.ignoreUntil) return false;
  return true;
}

function bundleBelongsToVendor(b, vendorName) {
  return (b.vendors || '').indexOf(vendorName) >= 0;
}

function canBuyAsBundle(b, vendor, receivingFull) {
  if (!Array.isArray(receivingFull) || !vendor?.name) return false;
  const v = vendor.name.toLowerCase().trim();
  const bid = (b.j || '').toLowerCase().trim();
  for (const r of receivingFull) {
    if (!r) continue;
    const rv = (r.vendor || '').toLowerCase().trim();
    const rc = (r.core || '').toLowerCase().trim();
    if (rv === v && rc === bid) return true;
  }
  return false;
}

function isSpikeVisual(b, threshold) {
  const cd = num(b.cd);
  const d7 = num(b.d7comp);
  const t = num(threshold, DEFAULT_SPIKE_THRESHOLD);
  return d7 > 0 && cd > 0 && d7 >= t * cd;
}

function effDSR(b, targetDoc) {
  if (b.coverageDemand > 0 && targetDoc > 0) {
    return b.coverageDemand / targetDoc;
  }
  if (b.forecastLevel && b.forecastLevel > 0) return b.forecastLevel;
  if (b.dsr && b.dsr > 0) return b.dsr;
  return 0.01;
}

// ────────────────────────────────────────────────────────────
// YoY Sanity Check con cap DINÁMICO según tendencia
// ────────────────────────────────────────────────────────────
// Compara el nivel actual (level del forecast = avg últimos 60d)
// vs el nivel histórico del mismo período año pasado.
//
//   levelActual / levelHistorico < 0.9  → tendencia BAJA  → cap × 1.0
//   levelActual / levelHistorico 0.9–1.1 → ESTABLE         → cap × 1.2
//   levelActual / levelHistorico > 1.1   → CRECE           → cap × 1.5
//
// Filosofía: si vendés MENOS que el año pasado, no podés
// comprar MÁS que el año pasado. Si crece, dejamos margen.
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// Calcula histórico desde bundleSales (mensual)
// ────────────────────────────────────────────────────────────
// bundleSales tiene una fila por bundle/mes con campo `units`.
// Para un horizonte de N días empezando hoy:
//   1. Tomamos el período "hace 1 año" → "hace 1 año + N días"
//   2. Sumamos las unidades de los meses que caen en ese rango,
//      prorrateando los meses parciales
// ────────────────────────────────────────────────────────────
function calcHistoricFromMonthlySales(bundleSales, bundleId, horizonDays) {
  if (!Array.isArray(bundleSales) || !bundleId || !(horizonDays > 0)) return null;

  const today = new Date();
  const startDate = new Date(today);
  startDate.setFullYear(startDate.getFullYear() - 1);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + horizonDays);

  const rows = bundleSales.filter(r => r && r.j === bundleId);
  if (rows.length === 0) return null;

  let total = 0;
  let monthsTouched = 0;

  // Iterar mes por mes desde startDate hasta endDate
  const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cur <= last) {
    const y = cur.getFullYear();
    const m = cur.getMonth() + 1; // 1-12

    // Buscar fila para este (year, month)
    const row = rows.find(r => r.y === y && r.m === m);
    const monthUnits = row?.units > 0 ? row.units :
                       (row?.avgDsr > 0 && row?.dataDays > 0 ? Math.round(row.avgDsr * row.dataDays) : 0);

    if (monthUnits > 0) {
      // Días del mes
      const daysInMonth = new Date(y, m, 0).getDate();
      // Días que efectivamente caen en nuestro rango [startDate, endDate]
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m - 1, daysInMonth);
      const effStart = monthStart < startDate ? startDate : monthStart;
      const effEnd = monthEnd > endDate ? endDate : monthEnd;
      const daysInRange = Math.max(0, Math.round((effEnd - effStart) / 86400000) + 1);

      const prorated = monthUnits * (daysInRange / daysInMonth);
      total += prorated;
      monthsTouched++;
    }

    // Avanzar al próximo mes
    cur.setMonth(cur.getMonth() + 1);
  }

  if (monthsTouched === 0) return null;

  return {
    total: Math.round(total),
    monthsTouched,
    horizonDays,
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

function applyYoYSanityCheck(forecast, bundleId, bundleSales, targetDoc) {
  if (!forecast || forecast.flags.noData) return null;

  const historic = calcHistoricFromMonthlySales(bundleSales, bundleId, targetDoc);
  if (!historic) return { applied: false, reason: 'no_history' };
  if (historic.total < MIN_HISTORIC_FOR_YOY) {
    return { applied: false, reason: 'historic_too_small', historic: historic.total };
  }

  // Nivel actual = level del forecast (avg últimos 60d, ya calculado)
  const levelActual = num(forecast.level, 0);
  // Nivel histórico = promedio diario del mismo período año pasado
  const levelHistorico = targetDoc > 0
    ? historic.total / targetDoc
    : 0;

  // Determinar cap según tendencia
  let trendRatio = 1.0;
  let trendLabel = 'unknown';
  if (levelHistorico > 0) {
    trendRatio = levelActual / levelHistorico;
    if (trendRatio < 0.9) { trendLabel = 'declining'; }
    else if (trendRatio > 1.1) { trendLabel = 'growing'; }
    else { trendLabel = 'stable'; }
  }

  let yoyCapMultiplier;
  if (trendLabel === 'declining') yoyCapMultiplier = 1.0;
  else if (trendLabel === 'growing') yoyCapMultiplier = 1.5;
  else yoyCapMultiplier = 1.2;

// forecast.coverageDemand ya incluye safety stock (lo agregó forecast.js)
  // Capeamos contra histórico × multiplier según tendencia
  const forecastTotal = forecast.coverageDemand;
  const safetyStock = num(forecast.safetyStock, 0);
  const maxAllowed = historic.total * yoyCapMultiplier;

  if (forecastTotal <= maxAllowed) {
    return {
      applied: false,
      reason: 'within_bounds',
      historic: historic.total,
      forecast: forecastTotal,
      ratio: forecastTotal / historic.total,
      trendLabel,
      trendRatio,
      yoyCapMultiplier,
    };
  }

  const scale = maxAllowed / forecastTotal;
  const originalTotal = forecastTotal;
  // El cap se distribuye proporcionalmente entre coverageDemand y safetyStock
  const newCoverageDemand = forecast.coverageDemand * scale;
  const newSafetyStock = safetyStock * scale;

  forecast.coverageDemand = newCoverageDemand;
  forecast.safetyStock = newSafetyStock;

  if (forecast.demandBreakdown) {
    forecast.demandBreakdown = {
      fromLevel: Math.round((forecast.demandBreakdown.fromLevel || 0) * scale),
      fromTrend: Math.round((forecast.demandBreakdown.fromTrend || 0) * scale),
      fromSeasonal: Math.round((forecast.demandBreakdown.fromSeasonal || 0) * scale),
      total: Math.round(newCoverageDemand),
    };
  }
  forecast.flags.yoyCapApplied = true;
  forecast.flags.yoyHistoric = Math.round(historic.total);
  forecast.flags.yoyOriginalForecast = Math.round(originalTotal);
  forecast.flags.yoyOriginalCoverageDemand = Math.round(originalTotal - safetyStock);
  forecast.flags.yoyOriginalSafetyStock = Math.round(safetyStock);
  forecast.flags.yoyScale = scale;
  forecast.flags.yoyTrendLabel = trendLabel;
  forecast.flags.yoyTrendRatio = trendRatio;
  forecast.flags.yoyCapMultiplier = yoyCapMultiplier;

  return {
    applied: true,
    historic: historic.total,
    originalForecast: originalTotal,
    cappedForecast: maxAllowed,
    cappedCoverageDemand: Math.round(newCoverageDemand),
    cappedSafetyStock: Math.round(newSafetyStock),
    ratio: originalTotal / historic.total,
    scale,
    trendLabel,
    trendRatio,
    yoyCapMultiplier,
    levelActual,
    levelHistorico,
  };
}

function maxBundleUnitsFromPools(b, corePools) {
  let max = Infinity;
  for (const { coreId, qty } of b.coresUsed) {
    if (!(qty > 0)) continue;
    const pool = corePools[coreId];
    if (pool === undefined) continue;
    if (pool <= 0) return 0;
    const can = Math.floor(pool / qty);
    if (can < max) max = can;
  }
  return max === Infinity ? 0 : max;
}

function applyBundleGive(b, give, corePools) {
  if (give <= 0) return;
  b.rawAssigned += give;
  for (const { coreId, qty } of b.coresUsed) {
    if (corePools[coreId] === undefined) continue;
    corePools[coreId] = corePools[coreId] - give * qty;
  }
}

function distributeRawToBundles(prepped, corePools, targetDoc, replenFloor) {
  const byUrgency = [...prepped].sort((a, b) => {
    const ad = a.assignedInv / effDSR(a, targetDoc);
    const bd = b.assignedInv / effDSR(b, targetDoc);
    return ad - bd;
  });
  for (const b of byUrgency) {
    const edsr = effDSR(b, targetDoc);
    if (!(edsr > 0)) continue;
    const curInv = b.assignedInv + b.rawAssigned;
    const curDOC = curInv / edsr;
    if (curDOC >= replenFloor) continue;
    const targetInv = Math.ceil(replenFloor * edsr);
    const gap = Math.max(0, targetInv - curInv);
    if (gap <= 0) continue;
    const maxPossible = maxBundleUnitsFromPools(b, corePools);
    const give = Math.min(gap, maxPossible);
    if (give <= 0) continue;
    applyBundleGive(b, give, corePools);
  }

  let level = replenFloor + LEVELING_STEP_DAYS;
  let iter = 0;
  while (level <= targetDoc && iter < MAX_WATERFALL_ITER) {
    iter++;
    let any = false;
    const sorted = [...prepped].sort((a, b) => {
      const ad = (a.assignedInv + a.rawAssigned) / effDSR(a, targetDoc);
      const bd = (b.assignedInv + b.rawAssigned) / effDSR(b, targetDoc);
      return ad - bd;
    });
    for (const b of sorted) {
      const edsr = effDSR(b, targetDoc);
      if (!(edsr > 0)) continue;
      const curInv = b.assignedInv + b.rawAssigned;
      const curDOC = curInv / edsr;
      if (curDOC >= level) continue;
      const targetInv = Math.ceil(level * edsr);
      const gap = Math.max(0, targetInv - curInv);
      if (gap <= 0) continue;
      const maxPossible = maxBundleUnitsFromPools(b, corePools);
      const give = Math.min(gap, maxPossible);
      if (give <= 0) continue;
      applyBundleGive(b, give, corePools);
      any = true;
    }
    if (!any) break;
    level += LEVELING_STEP_DAYS;
  }
}

function applyMoqAndCasePack(needPieces, moq, casePack, moqThreshold, moqCredit = 0) {
  if (needPieces <= 0) {
    return { finalQty: 0, moqInflated: false, excessFromMoq: 0, moqInflationRatio: 0, moqCredit: 0, effectiveMoq: 0 };
  }
  let qty = needPieces;
  const m = num(moq);
  const cp = num(casePack, 1);
  const credit = Math.max(0, num(moqCredit));

  const effectiveMoq = Math.max(0, m - credit);

  if (effectiveMoq > 0 && qty < effectiveMoq) qty = effectiveMoq;
  if (cp > 1) qty = Math.ceil(qty / cp) * cp;
  const t = num(moqThreshold, DEFAULT_MOQ_INFLATION_THRESHOLD);
  const ratio = needPieces > 0 ? qty / needPieces : 0;
  return {
    finalQty: qty,
    moqInflated: ratio >= t,
    moqInflationRatio: ratio,
    excessFromMoq: qty - needPieces,
    moqCredit: credit,
    effectiveMoq,
  };
}

function buildAbcMap(abcA) {
  const m = {};
  (abcA || []).forEach(a => { if (a?.j) m[a.j] = a.profABC || null; });
  return m;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
export function calcVendorRecommendation({
  vendor,
  cores,
  bundles,
  bundleSales,
  bundleDays,
  coreDays,
  abcA,
  receivingFull,
  replenMap,
  missingMap,
  priceCompFull,
  priceIndex,
  settings,
  purchFreqSafety,
  forceMode,
  bundleMoqOverride,
  moqExtraDocThreshold,
}) {
  if (!vendor || !vendor.name) return null;

  const targetDoc = getTargetDoc(vendor, settings);
  const replenFloor = num(settings?.replenFloorDoc, 80);
  const spikeThreshold = num(settings?.spikeThreshold, DEFAULT_SPIKE_THRESHOLD);
  const moqThreshold = num(settings?.moqInflationThreshold, DEFAULT_MOQ_INFLATION_THRESHOLD);
  const lt = num(vendor.lt, 30);

  const vendorCores = (cores || []).filter(
    c => c && c.id && !/^JLS/i.test(c.id) && c.ven === vendor.name
  );
  const vCoreById = {};
  vendorCores.forEach(c => { vCoreById[c.id] = c; });

  const vendorBundles = (bundles || []).filter(
    b => isActiveBundle(b, settings) && bundleBelongsToVendor(b, vendor.name)
  );

  const abcMap = buildAbcMap(abcA);

  const anomalyMap = detectVendorAnomalies({
    vendor, cores: vendorCores, coreDays,
    receivingRows: receivingFull,
    settings,
  });

  // ──────────────────────────────────────────────────────────
  // [v3.4] Step 1.5: Clasificar régimen de cada bundle
  // ──────────────────────────────────────────────────────────
  const regimeMap = {};
  for (const b of vendorBundles) {
    regimeMap[b.j] = classifyDemandRegime(b.j, bundleDays);
  }

  // ──────────────────────────────────────────────────────────
  // Steps 1-3: forecast + profile + assigned inv per bundle
  // ──────────────────────────────────────────────────────────
  const prepped = vendorBundles.map(b => {
    let profile = b._profile;
    if (!profile) {
      try { profile = calcBundleSeasonalProfile(b.j, bundleSales); }
      catch { profile = DEFAULT_PROFILE; }
    }

    const regimeInfo = regimeMap[b.j];
    const fallbackDsr = num(b.cd);

    const forecast = calcBundleForecast({
      bundleId: b.j,
      bundleDays,
      leadTime: lt,
      targetDoc,
      profABC: abcMap[b.j] || null,
      seasonalProfile: profile,
      settings,
      regimeInfo,
      bundleDsrFromSheet: fallbackDsr,
    });

    const yoyInfo = applyYoYSanityCheck(forecast, b.j, bundleSales, targetDoc);

    const ai = bundleAssignedInv(b, replenMap, missingMap);

    return {
      raw: b,
      id: b.j,
      j: b.j,
      profile,
      hasSeasonalHistory: !!(profile && profile.hasHistory),
      assignedInv: ai,
      coresUsed: coresOf(b),
      rawAssigned: 0,
      coverageDemand: 0,
      flatDemand: 0,
      ltDemand: 0,
      totalAvailable: 0,
      currentCoverDOC: 0,
      effectiveDSR: 0,
      buyNeed: 0,
      buyMode: 'core',
      urgent: false,
      forecast,
      yoyInfo,
      regimeInfo,
      forecastLevel: forecast.flags.noData ? fallbackDsr : (forecast.level || fallbackDsr),
      dsr: forecast.flags.noData ? fallbackDsr : Math.max(forecast.level, fallbackDsr * 0.01),
      spikeVisual: isSpikeVisual(b, spikeThreshold),
      profABC: abcMap[b.j] || null,
    };
  });

  // ──────────────────────────────────────────────────────────
  // Step 4: demand projection from forecast
  // (forecast.coverageDemand YA incluye safety stock)
  // ──────────────────────────────────────────────────────────
  for (const b of prepped) {
    let coverageDemand = b.forecast.coverageDemand;
    let flatDemand = b.forecast.flatDemand;

    if (coverageDemand <= 0 && b.dsr > 0) {
      coverageDemand = b.dsr * targetDoc;
      flatDemand = b.dsr * targetDoc;
      b.usedFlatFallback = true;
    }

    b.coverageDemand = Math.round(coverageDemand);
    b.flatDemand = Math.round(flatDemand);
    b.ltDemand = Math.max(0, Math.round(b.forecastLevel * lt));
    b.effectiveDSR = effDSR(b, targetDoc);
    b.seasonalDSR = b.effectiveDSR;
  }

  // ──────────────────────────────────────────────────────────
  // Step 5: waterfall
  // ──────────────────────────────────────────────────────────
  const corePools = {};
  const corePendingInbound = {};
  const coreRawEffective = {};
  for (const c of vendorCores) {
    const pending = num(missingMap?.[c.id]);
    corePendingInbound[c.id] = pending;
    const anomaly = anomalyMap[c.id];
    const rawEff = (anomaly?.override?.rawEffective != null)
      ? anomaly.override.rawEffective
      : num(c.raw);
    coreRawEffective[c.id] = rawEff;
    corePools[c.id] = rawEff + pending;
  }

  const waterfallBundles = prepped.filter(
    b => b.coresUsed.some(c => vCoreById[c.coreId])
  );
  distributeRawToBundles(waterfallBundles, corePools, targetDoc, replenFloor);

  // ──────────────────────────────────────────────────────────
  // Step 6: buy need
  // ──────────────────────────────────────────────────────────
  for (const b of prepped) {
    const total = b.assignedInv + b.rawAssigned;
    b.totalAvailable = total;
    const edsr = b.effectiveDSR;
    b.currentCoverDOC = edsr > 0 ? total / edsr : 99999;
    b.buyNeed = Math.max(0, Math.ceil(b.coverageDemand - total));
    b.urgent = (total - b.ltDemand) < 0;
  }

  // ──────────────────────────────────────────────────────────
  // Step 7: buy mode per bundle
  // ──────────────────────────────────────────────────────────
  for (const b of prepped) {
    if (forceMode === 'bundles') b.buyMode = 'bundle';
    else if (forceMode === 'cores') b.buyMode = 'core';
    else b.buyMode = canBuyAsBundle(b.raw, vendor, receivingFull) ? 'bundle' : 'core';
  }

  // ──────────────────────────────────────────────────────────
  // Step 7.5: Bundle MOQ override
  // ──────────────────────────────────────────────────────────
  const bMoq = num(bundleMoqOverride, 0);
  const moqDocThresh = num(moqExtraDocThreshold, 30);
  for (const b of prepped) {
    b.bundleMoqStatus = null;
    b.bundleMoqExtraDOC = 0;
    b.bundleMoqOriginalNeed = b.buyNeed;
    if (bMoq <= 0 || b.buyMode !== 'bundle' || b.buyNeed <= 0) continue;
    if (b.buyNeed >= bMoq) { b.bundleMoqStatus = 'meets_moq'; continue; }
    const extraUnits = bMoq - b.buyNeed;
    const edsr = b.effectiveDSR;
    const extraDOC = edsr > 0 ? Math.round(extraUnits / edsr) : 99999;
    b.bundleMoqExtraDOC = extraDOC;
    if (b.urgent) { b.buyNeed = bMoq; b.bundleMoqStatus = 'inflated_urgent'; }
    else if (extraDOC <= moqDocThresh) { b.buyNeed = bMoq; b.bundleMoqStatus = 'inflated_ok'; }
    else { b.buyNeed = bMoq; b.bundleMoqStatus = 'inflated_excess'; }
  }

  // ──────────────────────────────────────────────────────────
  // Step 8: aggregate to core
  // ──────────────────────────────────────────────────────────
  const coreNeedMap = {};
  const coreBundlesMap = {};
  for (const b of prepped) {
    if (b.buyNeed <= 0 || b.buyMode !== 'core') continue;
    for (const { coreId, qty } of b.coresUsed) {
      if (!vCoreById[coreId]) continue;
      coreNeedMap[coreId] = (coreNeedMap[coreId] || 0) + b.buyNeed * qty;
      if (!coreBundlesMap[coreId]) coreBundlesMap[coreId] = [];
      if (!coreBundlesMap[coreId].includes(b.id)) coreBundlesMap[coreId].push(b.id);
    }
  }

  const coreMoqCreditFromBundles = {};
  const coreCreditBundlesMap = {};
  for (const b of prepped) {
    if (b.buyNeed <= 0 || b.buyMode !== 'bundle') continue;
    for (const { coreId, qty } of b.coresUsed) {
      if (!vCoreById[coreId]) continue;
      const credit = b.buyNeed * qty;
      coreMoqCreditFromBundles[coreId] = (coreMoqCreditFromBundles[coreId] || 0) + credit;
      if (!coreCreditBundlesMap[coreId]) coreCreditBundlesMap[coreId] = [];
      coreCreditBundlesMap[coreId].push({ bundleId: b.id, qty, credit });
    }
  }

  for (const coreId of Object.keys(coreNeedMap)) {
    const core = vCoreById[coreId];
    if (!core) continue;
    const allIn = num(core.raw) + num(core.pp) + num(core.inb) + num(core.fba);
    const coreDSR = num(core.dsr);
    if (coreDSR <= 0) continue;
    const coreDOC = allIn / coreDSR;
    if (coreDOC > targetDoc * 1.2) {
      coreNeedMap[coreId] = 0;
      if (!coreBundlesMap[coreId]) coreBundlesMap[coreId] = [];
      coreBundlesMap[coreId]._redistributeFlag = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Step 9: MOQ + casepack per core
  // ──────────────────────────────────────────────────────────
  const coreItems = [];
  for (const [coreId, needPieces] of Object.entries(coreNeedMap)) {
    const core = vCoreById[coreId];
    if (!core) continue;
    const histUnitCost = getVendorCoreUnitCost(coreId, vendor, priceCompFull, priceIndex);
    const pricePerPiece = histUnitCost != null ? histUnitCost : num(core.cost);
    const priceSource = histUnitCost != null ? '7g-history' : 'sheet-cost';

    const moqCredit = coreMoqCreditFromBundles[coreId] || 0;
    const moqRes = applyMoqAndCasePack(needPieces, core.moq, core.casePack, moqThreshold, moqCredit);

    coreItems.push({
      id: coreId,
      mode: 'core',
      needPieces,
      finalQty: moqRes.finalQty,
      pricePerPiece,
      priceSource,
      cost: moqRes.finalQty * pricePerPiece,
      moqInflated: moqRes.moqInflated,
      moqInflationRatio: moqRes.moqInflationRatio,
      excessFromMoq: moqRes.excessFromMoq,
      excessCostFromMoq: moqRes.excessFromMoq * pricePerPiece,
      moqOriginal: num(core.moq),
      moqCredit: moqRes.moqCredit,
      moqEffective: moqRes.effectiveMoq,
      creditingBundles: coreCreditBundlesMap[coreId] || [],
      bundlesAffected: (coreBundlesMap[coreId] || []).length,
      bundlesAffectedIds: coreBundlesMap[coreId] || [],
      urgent: prepped.some(b =>
        b.urgent && b.buyMode === 'core' && b.coresUsed.some(c => c.coreId === coreId)
      ),
    });
  }

  const bundleItems = [];
  for (const b of prepped) {
    if (b.buyNeed <= 0 || b.buyMode !== 'bundle') continue;
    let pricePerPiece = 0;
    let anyFromHistory = false;
    let anyFromSheet = false;
    for (const { coreId, qty } of b.coresUsed) {
      const c = vCoreById[coreId];
      if (!c) continue;
      const histUnit = getVendorCoreUnitCost(coreId, vendor, priceCompFull, priceIndex);
      if (histUnit != null) { pricePerPiece += histUnit * qty; anyFromHistory = true; }
      else { pricePerPiece += num(c.cost) * qty; anyFromSheet = true; }
    }
    const priceSource = anyFromHistory && anyFromSheet ? 'partial-history'
                      : anyFromHistory ? '7g-history' : 'sheet-cost';
    bundleItems.push({
      id: b.id,
      mode: 'bundle',
      needPieces: b.buyNeed,
      finalQty: b.buyNeed,
      pricePerPiece,
      priceSource,
      cost: b.buyNeed * pricePerPiece,
      moqInflated: false,
      moqInflationRatio: 1,
      excessFromMoq: 0,
      excessCostFromMoq: 0,
      bundlesAffected: 1,
      bundlesAffectedIds: [b.id],
      urgent: b.urgent,
    });
  }

  const items = [...coreItems, ...bundleItems];
  const totalCost = items.reduce((s, i) => s + num(i.cost), 0);
  const vendorMoqDollar = num(vendor.moqDollar);
  const meetsVendorMoq = vendorMoqDollar <= 0 || totalCost >= vendorMoqDollar;
  const vendorMoqGap = Math.max(0, vendorMoqDollar - totalCost);

  const priceMap = {};
  for (const c of vendorCores) {
    const histUnitCost = getVendorCoreUnitCost(c.id, vendor, priceCompFull);
    priceMap[c.id] = histUnitCost != null ? histUnitCost : num(c.cost);
  }
  for (const b of vendorBundles) {
    let price = 0;
    for (const { coreId, qty } of coresOf(b)) {
      const c = vCoreById[coreId];
      if (!c) continue;
      const histUnit = getVendorCoreUnitCost(coreId, vendor, priceCompFull, priceIndex);
      const unit = histUnit != null ? histUnit : num(c.cost);
      price += unit * qty;
    }
    priceMap[b.j] = price;
  }

  const bundleDetails = prepped.map(b => ({
    bundleId: b.id,
    completeDSR: num(b.raw.cd),
    assignedInv: b.assignedInv,
    rawAssignedFromWaterfall: b.rawAssigned,
    totalAvailable: b.totalAvailable,
    effectiveDSR: b.effectiveDSR,
    seasonalDSR: b.effectiveDSR,
    forecastLevelRaw: b.forecastLevel,
    currentCoverDOC: b.currentCoverDOC,
    targetDOC: targetDoc,
    replenFloorDOC: replenFloor,
    coverageDemand: Math.round(b.coverageDemand),
    flatDemand: b.flatDemand,
    ltDemand: Math.round(b.ltDemand),
    buyNeed: b.buyNeed,
    buyMode: b.buyMode,
    urgent: b.urgent,
    hasSeasonalHistory: b.hasSeasonalHistory,
    coresUsed: b.coresUsed,
    bundleMoqStatus: b.bundleMoqStatus || null,
    bundleMoqExtraDOC: b.bundleMoqExtraDOC || 0,
    bundleMoqOriginalNeed: b.bundleMoqOriginalNeed ?? b.buyNeed,
    forecast: {
      level: b.forecast.level,
      trend: b.forecast.trend,
      effectiveTrend: b.forecast.effectiveTrend,
      usedHolt: b.forecast.flags.usedHolt,
      outliersRemoved: b.forecast.flags.outliersRemoved,
    },
    safetyStock: {
      amount: Math.round(b.forecast.safetyStock),
      sigmaLT: b.forecast.sigmaLT,
      Z: b.forecast.Z,
      profABC: b.profABC,
      fallback: b.forecast.flags.safetyStockFallback,
    },
    demandBreakdown: b.forecast.demandBreakdown,
    spikeVisual: b.spikeVisual,
    yoyInfo: b.yoyInfo,
    // [v3.4] Régimen visible para UI
    regime: b.regimeInfo?.regime || 'unknown',
    regimeInfo: b.regimeInfo || null,
    flags: {
      trackingSignalExceeded: b.forecast.flags.trackingSignalExceeded,
      trackingSignal: b.forecast.flags.trackingSignal,
      trendGatedByTS: b.forecast.flags.trendGatedByTS,
      shortHistory: b.forecast.flags.shortHistory,
      trendCapped: b.forecast.flags.trendCapped,
      safetyStockFallback: b.forecast.flags.safetyStockFallback,
      outliersRemoved: b.forecast.flags.outliersRemoved,
      yoyCapApplied: b.forecast.flags.yoyCapApplied || false,
      yoyHistoric: b.forecast.flags.yoyHistoric,
      yoyOriginalForecast: b.forecast.flags.yoyOriginalForecast,
      usedFlatFallback: b.usedFlatFallback || false,
      regime: b.forecast.flags.regime,
      regimeMethod: b.forecast.flags.regimeMethod,
      regimeReason: b.forecast.flags.regimeReason,
    },
  }));

  const coreDetails = vendorCores.map(c => {
    const item = coreItems.find(i => i.id === c.id);
    const pending = corePendingInbound[c.id] || 0;
    const rawOnHand = num(c.raw);
    const rawEff = coreRawEffective[c.id];
    const anomaly = anomalyMap[c.id];
    const moqCredit = coreMoqCreditFromBundles[c.id] || 0;
    const creditingBundles = coreCreditBundlesMap[c.id] || [];
    return {
      coreId: c.id,
      needPieces: item?.needPieces || 0,
      finalQty: item?.finalQty || 0,
      cost: item?.cost || 0,
      moqInflated: item?.moqInflated || false,
      moqInflationRatio: item?.moqInflationRatio || 1,
      excessFromMoq: item?.excessFromMoq || 0,
      excessCostFromMoq: item?.excessCostFromMoq || 0,
      moqOriginal: item?.moqOriginal ?? num(c.moq),
      moqCredit,
      moqEffective: item?.moqEffective ?? Math.max(0, num(c.moq) - moqCredit),
      creditingBundles,
      urgent: item?.urgent || false,
      bundlesAffected: item?.bundlesAffected || 0,
      bundlesAffectedIds: item?.bundlesAffectedIds || [],
      rawOnHand,
      rawEffective: rawEff,
      pendingInbound: pending,
      totalPool: rawEff + pending,
      anomalyDetected: !!anomaly,
      anomalyInfo: anomaly || null,
    };
  });

  return {
    vendor: vendor.name,
    targetDoc,
    replenFloor,
    leadTime: lt,
    items,
    coreItems,
    bundleItems,
    coreDetails,
    bundleDetails,
    priceMap,
    totalCost,
    vendorMoqDollar,
    meetsVendorMoq,
    vendorMoqGap,
    anomalyMap,
    regimeMap,
  };
}

// ============================================================
// Batch helper
// ============================================================
export function batchVendorRecommendations({
  vendors,
  cores,
  bundles,
  bundleSales,
  bundleDays,
  coreDays,
  abcA,
  receivingFull,
  replenMap,
  missingMap,
  priceCompFull,
  priceIndex,
  settings,
  purchFreqMap,
}) {
  const out = {};
  const profileCache = {};
  for (const b of (bundles || [])) {
    if (!b || !b.j) continue;
    if (profileCache[b.j]) continue;
    try { profileCache[b.j] = calcBundleSeasonalProfile(b.j, bundleSales); }
    catch { profileCache[b.j] = DEFAULT_PROFILE; }
  }
  const bundlesWithProfile = (bundles || []).map(b => ({ ...b, _profile: profileCache[b.j] }));
  for (const v of (vendors || [])) {
    if (!v || !v.name) continue;
    const safety = purchFreqMap?.[v.name]?.safetyMultiplier || 1.0;
    out[v.name] = calcVendorRecommendation({
      vendor: v,
      cores,
      bundles: bundlesWithProfile,
      bundleSales,
      bundleDays,
      coreDays,
      abcA,
      receivingFull,
      replenMap,
      missingMap,
      priceCompFull,
      priceIndex,
      settings,
      purchFreqSafety: safety,
      bundleMoqOverride: 0,
      moqExtraDocThreshold: num(settings?.moqExtraDocThreshold, 30),
    });
  }
  return out;
}
