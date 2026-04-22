// src/lib/recommender.js
// ============================================================
// v3.2 Purchase Recommendation Engine (FIXED)
// ============================================================
// NEW in v3.2:
//   [FIX-MOQ-CROSS] When a core has MOQ inflation AND the same vendor is
//                   also getting bundles-as-bundles that USE this core,
//                   the raw material needed to build those bundles is
//                   credited against the core's MOQ.
//
//                   Example (Core-10294 w/ TIANJIN HUAYUE):
//                     needPieces: 4,176
//                     MOQ: 34,560
//                     bundles-as-bundle consuming this core: 11,831 pcs
//                     (JLS-0866 × 12, JLS-0865 × 4, JLS-0536 × 1)
//
//                   v3.1 behavior: finalQty = 34,560 (MOQ forced on 4,176)
//                   v3.2 behavior: effectiveMoq = 34,560 − 11,831 = 22,729
//                                  finalQty = max(4,176, 22,729) = 22,729
//                                  Still MOQ-inflated, but 5.4× instead of 8.3×.
//
//                   Logic: if we're already getting ~X units of this core
//                   baked into bundle deliveries, the vendor's minimum-run
//                   cost is effectively partially amortized. We credit X
//                   against the MOQ before applying it to the raw-core line.
//
// NEW in v3.1 (kept):
//   [FIX-YoY] After calcBundleForecast returns, compare total demand
//             (coverageDemand + safetyStock) against the same calendar
//             window one year ago. If today's forecast is more than
//             MAX_YOY_RATIO × historic, cap it at that ratio and flag.
//
// v3 principles (unchanged):
//   9.  Baseline forecast uses Hampel + Holt (not raw DSR). Industry-standard.
//   10. Safety stock = Z × σ_LT with Z from service-level-by-ABC.
//   11. Inventory anomalies are detected and corrected before waterfall.
//   12. Spike detection is visual-only; cálculo nunca oscila.
// ============================================================

import { calcBundleSeasonalProfile, DEFAULT_PROFILE } from './seasonal.js';
import { calcBundleForecast, calcHistoricSamePeriod } from './forecast.js';
import { detectVendorAnomalies } from './anomalyDetector.js';

// [FIX-YoY] If forecast > MAX_YOY_RATIO × historic LY same-period sales,
// cap it at that ratio. 1.5 means "we'll forecast up to 50% more than LY
// but never more than that without manual review". Set high enough to allow
// genuine growth, low enough to catch runaway models.
export const MAX_YOY_RATIO = 1.5;

// Minimum LY sales to trust the sanity check. If LY same-period was < 30
// units total, YoY ratios are noise (e.g. going from 5 → 25 is +400% but
// meaningless). Skip the check entirely in that case.
export const MIN_HISTORIC_FOR_YOY = 30;

// ────────────────────────────────────────────────────────────
// 7g vendor-specific material cost lookup (unchanged from v2)
// ────────────────────────────────────────────────────────────
function parseNoteVendor(note) {
  if (!note) return { kind: 'unknown', name: null };
  const n = String(note).trim();
  const m = n.match(/^(.+?)\s+-\s+/);
  if (m) return { kind: 'named', name: m[1].trim() };
  return { kind: 'container', name: null };
}

function isChinaVendor(vendor) {
  const c = (vendor?.country || '').toLowerCase().trim();
  return c === 'china' || c === 'cn' || c === 'prc';
}

function getVendorCoreUnitCost(coreId, vendor, paymentHistory) {
  if (!Array.isArray(paymentHistory) || !coreId || !vendor?.name) return null;
  const cid = coreId.toLowerCase().trim();
  const vName = vendor.name.toLowerCase().trim();
  const china = isChinaVendor(vendor);
  let best = null;
  for (const r of paymentHistory) {
    if (!r) continue;
    if ((r.core || '').toLowerCase().trim() !== cid) continue;
    const pcs = Number(r.pcs);
    const mat = Number(r.matPrice);
    if (!(pcs > 0) || !(mat > 0)) continue;
    const parsed = parseNoteVendor(r.note);
    let matches = false;
    if (china) {
      matches = parsed.kind === 'container';
    } else {
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

// ────────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────────
export const DEFAULT_SPIKE_THRESHOLD = 1.25;
export const DEFAULT_MOQ_INFLATION_THRESHOLD = 1.5;
const LEVELING_STEP_DAYS = 10;
const MAX_WATERFALL_ITER = 100;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
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

// Visual-only spike detection (for badge ⚡, NOT for math)
function isSpikeVisual(b, threshold) {
  const cd = num(b.cd);
  const d7 = num(b.d7comp);
  const t = num(threshold, DEFAULT_SPIKE_THRESHOLD);
  return d7 > 0 && cd > 0 && d7 >= t * cd;
}

// [FIX-YoY] Apply YoY sanity check to a bundle forecast. Mutates the
// forecast object's coverageDemand and flags; returns info about the cap
// for logging/UI. Returns null if check was not applicable (not enough
// history), so we know to skip the flag.
function applyYoYSanityCheck(forecast, bundleId, bundleDays, targetDoc) {
  if (!forecast || forecast.flags.noData) return null;

  const historic = calcHistoricSamePeriod(bundleDays, bundleId, targetDoc);
  if (!historic) return { applied: false, reason: 'no_history' };
  if (historic.total < MIN_HISTORIC_FOR_YOY) {
    return { applied: false, reason: 'historic_too_small', historic: historic.total };
  }

  const forecastTotal = forecast.coverageDemand; // before safety stock
  const maxAllowed = historic.total * MAX_YOY_RATIO;

  if (forecastTotal <= maxAllowed) {
    return {
      applied: false,
      reason: 'within_bounds',
      historic: historic.total,
      forecast: forecastTotal,
      ratio: forecastTotal / historic.total,
    };
  }

  // Cap the forecast. Preserve the structure: scale down coverageDemand
  // proportionally and recompute demandBreakdown for transparency.
  const scale = maxAllowed / forecastTotal;
  const cappedTotal = maxAllowed;
  const originalTotal = forecastTotal;

  forecast.coverageDemand = cappedTotal;
  forecast.demandBreakdown = {
    fromLevel: Math.round(forecast.demandBreakdown.fromLevel * scale),
    fromTrend: Math.round(forecast.demandBreakdown.fromTrend * scale),
    fromSeasonal: Math.round(forecast.demandBreakdown.fromSeasonal * scale),
    total: Math.round(cappedTotal),
  };
  forecast.flags.yoyCapApplied = true;
  forecast.flags.yoyHistoric = Math.round(historic.total);
  forecast.flags.yoyOriginalForecast = Math.round(originalTotal);
  forecast.flags.yoyScale = scale;

  return {
    applied: true,
    historic: historic.total,
    originalForecast: originalTotal,
    cappedForecast: cappedTotal,
    ratio: originalTotal / historic.total,
    scale,
  };
}

// ────────────────────────────────────────────────────────────
// Waterfall helpers (unchanged math, but uses rawEffective per core)
// ────────────────────────────────────────────────────────────
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
  const effDSR = b => (b.forecastLevel && b.forecastLevel > 0) ? b.forecastLevel : b.dsr;

  // PHASE A — urgency
  const byUrgency = [...prepped].sort((a, b) => {
    const ad = a.assignedInv / (effDSR(a) || 1);
    const bd = b.assignedInv / (effDSR(b) || 1);
    return ad - bd;
  });
  for (const b of byUrgency) {
    if (!(b.dsr > 0)) continue;
    const edsr = effDSR(b);
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

  // PHASE B — leveling
  let level = replenFloor + LEVELING_STEP_DAYS;
  let iter = 0;
  while (level <= targetDoc && iter < MAX_WATERFALL_ITER) {
    iter++;
    let any = false;
    const sorted = [...prepped].sort((a, b) => {
      const ad = (a.assignedInv + a.rawAssigned) / (effDSR(a) || 1);
      const bd = (b.assignedInv + b.rawAssigned) / (effDSR(b) || 1);
      return ad - bd;
    });
    for (const b of sorted) {
      if (!(b.dsr > 0)) continue;
      const edsr = effDSR(b);
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

// ────────────────────────────────────────────────────────────
// MOQ + casepack
// ────────────────────────────────────────────────────────────
// [FIX-MOQ-CROSS] New parameter: moqCredit = material from bundle-as-bundle
// purchases at the same vendor that consume this core. It reduces the
// effective MOQ threshold. If the raw-core need is X, and the vendor is
// simultaneously going to process Y units of the same core into bundles
// for us, the MOQ is effectively X+Y worth of core going through their
// production. We credit Y against the MOQ line.
function applyMoqAndCasePack(needPieces, moq, casePack, moqThreshold, moqCredit = 0) {
  if (needPieces <= 0) {
    return { finalQty: 0, moqInflated: false, excessFromMoq: 0, moqInflationRatio: 0, moqCredit: 0, effectiveMoq: 0 };
  }
  let qty = needPieces;
  const m = num(moq);
  const cp = num(casePack, 1);
  const credit = Math.max(0, num(moqCredit));

  // [FIX-MOQ-CROSS] Effective MOQ for the raw-core line = MOQ − credit
  // from bundle-as-bundle deliveries. Never goes below 0.
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

// ────────────────────────────────────────────────────────────
// ABC lookup
// ────────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────
  // Step 0: Inventory anomaly detection
  // ──────────────────────────────────────────────────────────
  const anomalyMap = detectVendorAnomalies({
    vendor, cores: vendorCores, coreDays,
    receivingRows: receivingFull,
    settings,
  });

  // ──────────────────────────────────────────────────────────
  // Steps 1-3: forecast + profile + assigned inv per bundle
  // ──────────────────────────────────────────────────────────
  const prepped = vendorBundles.map(b => {
    // Seasonal profile (cached from batch if provided, else compute now)
    let profile = b._profile;
    if (!profile) {
      try { profile = calcBundleSeasonalProfile(b.j, bundleSales); }
      catch { profile = DEFAULT_PROFILE; }
    }

    // Forecast (Holt + seasonal + safety)
    const forecast = calcBundleForecast({
      bundleId: b.j,
      bundleDays,
      leadTime: lt,
      targetDoc,
      profABC: abcMap[b.j] || null,
      seasonalProfile: profile,
      settings,
    });

    // [FIX-YoY] Apply YoY sanity check. Mutates `forecast` in place when a
    // cap is applied. Info object is stored for debugging / UI.
    const yoyInfo = applyYoYSanityCheck(forecast, b.j, bundleDays, targetDoc);

    const ai = bundleAssignedInv(b, replenMap, missingMap);
    const fallbackDsr = num(b.cd);

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
      buyNeed: 0,
      buyMode: 'core',
      urgent: false,
      // forecast outputs
      forecast,
      yoyInfo,                     // [FIX-YoY] for debugging / UI
      forecastLevel: forecast.flags.noData ? fallbackDsr : (forecast.level || fallbackDsr),
      // dsr kept for back-compat (urgency, DOC displays)
      dsr: forecast.flags.noData ? fallbackDsr : Math.max(forecast.level, fallbackDsr * 0.01),
      spikeVisual: isSpikeVisual(b, spikeThreshold),
      profABC: abcMap[b.j] || null,
    };
  });

  // ──────────────────────────────────────────────────────────
  // Step 4: demand projection from forecast
  // ──────────────────────────────────────────────────────────
  for (const b of prepped) {
    b.coverageDemand = Math.round(b.forecast.coverageDemand + b.forecast.safetyStock);
    b.flatDemand = Math.round(b.forecast.flatDemand);
    // LT demand: simple projection using level only (for urgency flag)
    b.ltDemand = Math.max(0, Math.round(b.forecastLevel * lt));
    b.seasonalDSR = targetDoc > 0 ? b.forecast.coverageDemand / targetDoc : b.forecastLevel;
  }

  // ──────────────────────────────────────────────────────────
  // Step 5: waterfall using rawEffective when anomaly detected
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
    const edsr = (b.seasonalDSR && b.seasonalDSR > 0) ? b.seasonalDSR : b.forecastLevel;
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
    const edsr = (b.seasonalDSR > 0) ? b.seasonalDSR : b.forecastLevel;
    const extraDOC = edsr > 0 ? Math.round(extraUnits / edsr) : 99999;
    b.bundleMoqExtraDOC = extraDOC;
    if (b.urgent) { b.buyNeed = bMoq; b.bundleMoqStatus = 'inflated_urgent'; }
    else if (extraDOC <= moqDocThresh) { b.buyNeed = bMoq; b.bundleMoqStatus = 'inflated_ok'; }
    else { b.buyNeed = 0; b.bundleMoqStatus = 'wait'; }
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

  // [FIX-MOQ-CROSS] Step 8.25: compute material credit per core from
  // bundles that are being bought AS BUNDLES (finished goods). Each such
  // bundle, when produced by the vendor, consumes raw-core material that
  // counts toward the vendor's MOQ production run of that core.
  //
  // Example: JLS-0866 uses 12× Core-10294. If we buy 407 of JLS-0866 as
  // bundle, the vendor processes 407×12 = 4,884 pcs of Core-10294 into
  // those bundles. We credit 4,884 against Core-10294's MOQ.
  const coreMoqCreditFromBundles = {};
  const coreCreditBundlesMap = {};
  for (const b of prepped) {
    if (b.buyNeed <= 0 || b.buyMode !== 'bundle') continue;
    for (const { coreId, qty } of b.coresUsed) {
      if (!vCoreById[coreId]) continue; // only credit if we own this core at this vendor
      const credit = b.buyNeed * qty;
      coreMoqCreditFromBundles[coreId] = (coreMoqCreditFromBundles[coreId] || 0) + credit;
      if (!coreCreditBundlesMap[coreId]) coreCreditBundlesMap[coreId] = [];
      coreCreditBundlesMap[coreId].push({ bundleId: b.id, qty, credit });
    }
  }

  // Step 8.5: sanity — if core's all-in already covers target DOC, don't buy
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
  // Step 9: MOQ + casepack per core -> coreItems
  // [FIX-MOQ-CROSS] Now passes moqCredit from bundle purchases.
  // ──────────────────────────────────────────────────────────
  const coreItems = [];
  for (const [coreId, needPieces] of Object.entries(coreNeedMap)) {
    const core = vCoreById[coreId];
    if (!core) continue;
    const histUnitCost = getVendorCoreUnitCost(coreId, vendor, priceCompFull);
    const pricePerPiece = histUnitCost != null ? histUnitCost : num(core.cost);
    const priceSource = histUnitCost != null ? '7g-history' : 'sheet-cost';

    // [FIX-MOQ-CROSS] credit from bundle-as-bundle purchases of this vendor
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
      // [FIX-MOQ-CROSS] new fields exposing the credit logic for UI/debug
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

  // [FIX-MOQ-CROSS] Edge case: a core has NO direct need (needPieces=0) but
  // bundles-as-bundles consume material from it. The vendor's MOQ for that
  // core is cleared by the bundle material itself — no coreItem row is needed,
  // but we still want this info visible in coreDetails for transparency.
  // (Handled below when building coreDetails.)

  // Bundle-mode items
  const bundleItems = [];
  for (const b of prepped) {
    if (b.buyNeed <= 0 || b.buyMode !== 'bundle') continue;
    let pricePerPiece = 0;
    let anyFromHistory = false;
    let anyFromSheet = false;
    for (const { coreId, qty } of b.coresUsed) {
      const c = vCoreById[coreId];
      if (!c) continue;
      const histUnit = getVendorCoreUnitCost(coreId, vendor, priceCompFull);
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

  // Price map (unchanged from v2)
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
      const histUnit = getVendorCoreUnitCost(coreId, vendor, priceCompFull);
      const unit = histUnit != null ? histUnit : num(c.cost);
      price += unit * qty;
    }
    priceMap[b.j] = price;
  }

  // ──────────────────────────────────────────────────────────
  // Bundle details (extended with forecast + safety stock + YoY info)
  // ──────────────────────────────────────────────────────────
  const bundleDetails = prepped.map(b => ({
    bundleId: b.id,
    assignedInv: b.assignedInv,
    rawAssignedFromWaterfall: b.rawAssigned,
    totalAvailable: b.totalAvailable,
    effectiveDSR: b.forecastLevel,
    seasonalDSR: b.seasonalDSR,
    currentCoverDOC: b.currentCoverDOC,
    targetDOC: targetDoc,
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
      effectiveTrend: b.forecast.effectiveTrend,    // [FIX-3] trend actually used
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
    yoyInfo: b.yoyInfo,          // [FIX-YoY] null or { applied, historic, ... }
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
    },
  }));

  // ──────────────────────────────────────────────────────────
  // Core details (extended with anomaly info + [FIX-MOQ-CROSS] credit info)
  // ──────────────────────────────────────────────────────────
  const coreDetails = vendorCores.map(c => {
    const item = coreItems.find(i => i.id === c.id);
    const pending = corePendingInbound[c.id] || 0;
    const rawOnHand = num(c.raw);
    const rawEff = coreRawEffective[c.id];
    const anomaly = anomalyMap[c.id];
    // [FIX-MOQ-CROSS] credit visibility even if this core has no direct buy
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
      // [FIX-MOQ-CROSS] expose the credit so UI / debug can show it
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
      settings,
      purchFreqSafety: safety, // kept for UI metadata only
      bundleMoqOverride: 0,
      moqExtraDocThreshold: num(settings?.moqExtraDocThreshold, 30),
    });
  }
  return out;
}
