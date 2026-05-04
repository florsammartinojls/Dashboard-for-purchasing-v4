// src/lib/recommenderV4.js
// ============================================================
// V4 Purchase Recommendation Engine
// ============================================================
// Replaces recommender.js (v3.4). Same external API surface so
// the rest of the app needs only the import switched.
//
// Differences from v3.4:
//   1. Per-bundle forecast uses calcBundleForecastV4 dispatched
//      by the bundle's EFFECTIVE segment (auto + override).
//   2. Removes the YoY sanity cap (segments encode the same idea
//      more cleanly).
//   3. INTERMITTENT MOQ rule: if MOQ would inflate need >2x the
//      coverage, status defaults to 'inflated_excess' (wait).
//   4. The forecast object carries inputs/formula/reasoning, which
//      bundleDetails surfaces verbatim for the Why Buy panel.
//   5. Pre-built priceIndex is used end-to-end.
//
// All structural pieces (waterfall, MOQ + casepack, force mode,
// bundle MOQ override) are unchanged in spirit.
// ============================================================

import { calcBundleForecastV4 } from './forecastV4.js';
import { detectVendorAnomalies } from './anomalyDetector.js';

export const DEFAULT_SPIKE_THRESHOLD = 1.25;
export const DEFAULT_MOQ_INFLATION_THRESHOLD = 1.5;
export const DEFAULT_MOQ_INFLATION_HARD_CAP = 3.0;
const LEVELING_STEP_DAYS = 10;
const MAX_WATERFALL_ITER = 100;
const INTERMITTENT_MOQ_INFLATE_LIMIT = 2.0;

// ─── helpers ───────────────────────────────────────────────────
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

function parseNoteVendor(note) {
  if (!note) return { kind: 'unknown', name: null };
  const n = String(note).trim();
  const m = n.match(/^(.+?)\s+-\s+/);
  if (m) return { kind: 'named', name: m[1].trim() };
  return { kind: 'unnamed', name: null };
}
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
// Returns one of:
//   { buyMode: 'bundle', reason: 'bundle-history' }
//      this exact bundle has been delivered as bundle by this vendor
//   { buyMode: 'bundle', reason: 'vendor-fallback' }
//      no bundle-specific history, but the vendor has delivered SOME
//      bundle (any JLS-prefixed ID) — treat them as a bundle vendor
//   { buyMode: 'core', reason: 'core-default' }
//      neither rule fired
function getBuyModeForBundle(b, vendor, receivingFull) {
  if (!Array.isArray(receivingFull) || !vendor?.name) {
    return { buyMode: 'core', reason: 'core-default' };
  }
  const v = vendor.name.toLowerCase().trim();
  const bid = (b.j || '').toLowerCase().trim();
  let vendorEverDeliveredABundle = false;
  for (const r of receivingFull) {
    if (!r) continue;
    const rv = (r.vendor || '').toLowerCase().trim();
    if (rv !== v) continue;
    const rc = (r.core || '').toLowerCase().trim();
    if (rc === bid) {
      // Strict: this exact bundle was delivered as a bundle
      return { buyMode: 'bundle', reason: 'bundle-history' };
    }
    // Bundle-vendor signal: any JLS-prefixed ID counts as evidence
    // that the vendor ships finished bundles.
    if (/^jls/i.test(r.core || '')) {
      vendorEverDeliveredABundle = true;
    }
  }
  if (vendorEverDeliveredABundle) {
    return { buyMode: 'bundle', reason: 'vendor-fallback' };
  }
  return { buyMode: 'core', reason: 'core-default' };
}

// Legacy boolean shim for any caller that doesn't need the reason.
function canBuyAsBundle(b, vendor, receivingFull) {
  return getBuyModeForBundle(b, vendor, receivingFull).buyMode === 'bundle';
}
function isSpikeVisual(b, threshold) {
  const cd = num(b.cd);
  const d7 = num(b.d7comp);
  const t = num(threshold, DEFAULT_SPIKE_THRESHOLD);
  return d7 > 0 && cd > 0 && d7 >= t * cd;
}

function effDSR(b, targetDoc) {
  if (b.coverageDemand > 0 && targetDoc > 0) return b.coverageDemand / targetDoc;
  if (b.forecastLevel && b.forecastLevel > 0) return b.forecastLevel;
  if (b.dsr && b.dsr > 0) return b.dsr;
  return 0.01;
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
export function calcVendorRecommendationV4({
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
  segmentMap, // bundleId -> 'STABLE' | 'SEASONAL_PEAKED' | ...
  settings,
  forceMode,
  bundleMoqOverride,
  moqExtraDocThreshold,
}) {
  if (!vendor || !vendor.name) return null;

  const targetDoc = getTargetDoc(vendor, settings);
  const replenFloor = num(settings?.replenFloorDoc, 80);
  const spikeThreshold = num(settings?.spikeThreshold, DEFAULT_SPIKE_THRESHOLD);
  const moqThreshold = num(settings?.moqInflationThreshold, DEFAULT_MOQ_INFLATION_THRESHOLD);
  const moqHardCap = num(settings?.moqInflationHardCap, DEFAULT_MOQ_INFLATION_HARD_CAP);
  const lt = num(vendor.lt, 30);

  // Inactive/ignored cores are NOT processed by the recommender.
  // They reappear automatically when reactivated upstream — no code change needed.
  // Same gate that PurchTab already applies at the UI layer; making
  // it authoritative here removes the "core in coreDetails but invisible to UI"
  // class of bugs (see Sprint 1 vendor-mapping audit).
  const vendorCores = (cores || []).filter(
    c => c && c.id && !/^JLS/i.test(c.id) && c.ven === vendor.name &&
         c.active === 'Yes' && !c.ignoreUntil
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

  // Sprint 3 Fix 8: typical PO size per core for THIS vendor.
  // Median of the most recent 5 receiving rows tagged to this vendor
  // and core. UI surfaces a "Below typical PO" warning when the
  // engine recommends less than 30% of this baseline. Output-only:
  // not consumed by the recommender, never alters finalQty/cost.
  const typicalPoSizeByCore = (() => {
    const out = {};
    if (!Array.isArray(receivingFull) || !vendor?.name) return out;
    const vNameLower = vendor.name.toLowerCase().trim();
    const byCore = new Map();
    for (const r of receivingFull) {
      if (!r || !r.core) continue;
      const rv = (r.vendor || '').toLowerCase().trim();
      if (rv !== vNameLower) continue;
      const pcs = Number(r.pieces);
      if (!(pcs > 0)) continue;
      const cid = r.core;
      let arr = byCore.get(cid);
      if (!arr) { arr = []; byCore.set(cid, arr); }
      arr.push({ date: r.date || '', pcs });
    }
    for (const [cid, arr] of byCore.entries()) {
      arr.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const last = arr.slice(0, 5).map(x => x.pcs).sort((a, b) => a - b);
      if (last.length === 0) continue;
      const mid = Math.floor(last.length / 2);
      const median = last.length % 2 === 1 ? last[mid] : (last[mid - 1] + last[mid]) / 2;
      out[cid] = Math.round(median);
    }
    return out;
  })();

  const segmentationEnabled = settings?.segmentationEnabled !== false;

  // Pre-index bundleDays by bundleId once so the per-bundle reconciliation
  // check below stays O(n) total instead of O(n²).
  const bundleDaysByJ = {};
  for (const d of (bundleDays || [])) {
    if (!d || !d.j) continue;
    let arr = bundleDaysByJ[d.j];
    if (!arr) { arr = []; bundleDaysByJ[d.j] = arr; }
    arr.push(d);
  }
  // bundleDays may not be sorted; sort once per bundle so .slice(-N) is the
  // last N calendar days, not an arbitrary window.
  for (const j of Object.keys(bundleDaysByJ)) {
    bundleDaysByJ[j].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }
  const reconcileRatio = num(settings?.sevenDayReconciliationRatio, 1.0);

  const prepped = vendorBundles.map(b => {
    const fallbackDsr = num(b.cd);
    let segment = segmentationEnabled
      ? (segmentMap && segmentMap[b.j]) || 'STABLE'
      : 'STABLE';

    // 7D reconciliation (Sprint 2 Fix 5b): if last-7d DSR has recovered
    // to >= ratio × mean60d, override DECLINING → STABLE so the engine
    // doesn't keep extrapolating a drop that has already reversed.
    // Done at the recommender layer (not in the pure classifier) because
    // it's a business override, not a data signal.
    let sevenDayReconciled = null;
    if (segment === 'DECLINING') {
      const series = bundleDaysByJ[b.j] || [];
      const last7 = series.slice(-7).map(d => Number(d.dsr) || 0);
      const last60 = series.slice(-60).map(d => Number(d.dsr) || 0);
      const m7 = last7.length ? last7.reduce((s, v) => s + v, 0) / last7.length : 0;
      const m60 = last60.length ? last60.reduce((s, v) => s + v, 0) / last60.length : 0;
      if (m7 > 0 && m60 > 0 && (m7 / m60) >= reconcileRatio) {
        sevenDayReconciled = { mean7: m7, mean60: m60, ratio: reconcileRatio, originalSegment: 'DECLINING' };
        segment = 'STABLE';
      }
    }

    const forecast = calcBundleForecastV4({
      bundleId: b.j,
      segment,
      bundleDays,
      bundleSales,
      leadTime: lt,
      targetDoc,
      profABC: abcMap[b.j] || null,
      bundleDsrFromSheet: fallbackDsr,
      settings,
    });

    const ai = bundleAssignedInv(b, replenMap, missingMap);

    return {
      raw: b,
      id: b.j,
      j: b.j,
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
      segment,
      sevenDayReconciled,
      forecastLevel: forecast.flags.noData ? fallbackDsr : (forecast.level || fallbackDsr),
      dsr: forecast.flags.noData ? fallbackDsr : Math.max(forecast.level, fallbackDsr * 0.01),
      spikeVisual: isSpikeVisual(b, spikeThreshold),
      profABC: abcMap[b.j] || null,
    };
  });

  // demand projection from forecast
  for (const b of prepped) {
    let coverageDemand = b.forecast.coverageDemand;
    if (coverageDemand <= 0 && b.dsr > 0) {
      coverageDemand = b.dsr * targetDoc;
      b.usedFlatFallback = true;
    }
    b.coverageDemand = Math.round(coverageDemand);
    b.flatDemand = Math.round(b.forecastLevel * targetDoc);
    b.ltDemand = Math.max(0, Math.round(b.forecastLevel * lt));
    b.effectiveDSR = effDSR(b, targetDoc);
  }

  // waterfall
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

  // buy need
  for (const b of prepped) {
    const total = b.assignedInv + b.rawAssigned;
    b.totalAvailable = total;
    const edsr = b.effectiveDSR;
    b.currentCoverDOC = edsr > 0 ? total / edsr : 99999;
    b.buyNeed = Math.max(0, Math.ceil(b.coverageDemand - total));
    b.urgent = (total - b.ltDemand) < 0;

    // DORMANT_REVIVED policy (Sprint 2 Fix 6): never auto-buy. Force
    // buyNeed to 0 even when the projection happens to be positive.
    // Capture wouldHaveBuy in units now; dollar cost is filled in
    // below once priceMap is built.
    if (b.segment === 'DORMANT_REVIVED') {
      const wouldHaveCov = b.forecast?.inputs?.wouldHaveCoverageDemand || 0;
      const wouldHaveBuy = Math.max(0, Math.ceil(wouldHaveCov - total));
      b.dormantRevivedSafetyDeclined = {
        wouldHaveBought: wouldHaveBuy,
        wouldHaveSafetyStock: b.forecast?.inputs?.wouldHaveSafetyStock || 0,
        wouldHaveCoverageDemand: wouldHaveCov,
        wouldHaveCost: 0, // priced after priceMap is built
      };
      b.buyNeed = 0;
      b.urgent = false; // dormant items don't generate urgency by definition
    }
  }

  // buy mode (with reason exposed for the Why Buy panel)
  for (const b of prepped) {
    if (forceMode === 'bundles') {
      b.buyMode = 'bundle';
      b.buyModeReason = 'force-bundles';
    } else if (forceMode === 'cores') {
      b.buyMode = 'core';
      b.buyModeReason = 'force-cores';
    } else {
      const decision = getBuyModeForBundle(b.raw, vendor, receivingFull);
      b.buyMode = decision.buyMode;
      b.buyModeReason = decision.reason;
    }
  }

  // Bundle MOQ override (BdlMOQ).
  //
  // Three cases per spec Item 4:
  //   need = 0       → skip the bundle entirely (don't auto-buy MOQ).
  //                    Status: 'bdlmoq-skipped-no-need'.
  //   need >= MOQ    → MOQ already met naturally. Status: 'meets_moq'.
  //   need < MOQ     → DO NOT auto-buy MOQ. Surface three options to
  //                    the user via Why Buy:
  //                      (a) buy MOQ (extra DOC)
  //                      (b) switch to core mode
  //                      (c) throttle demand (UI suggestion only)
  //                    Default recommendation: buyNeed = 0 until user
  //                    reviews. Status: 'bdlmoq-need-below-moq'.
  const bMoq = num(bundleMoqOverride, 0);
  const moqDocThresh = num(moqExtraDocThreshold, 30);
  for (const b of prepped) {
    b.bundleMoqStatus = null;
    b.bundleMoqExtraDOC = 0;
    b.bundleMoqOriginalNeed = b.buyNeed;
    b.bundleMoqOptions = null;
    if (bMoq <= 0 || b.buyMode !== 'bundle') continue;

    if (b.buyNeed === 0) {
      b.bundleMoqStatus = 'bdlmoq-skipped-no-need';
      continue;
    }
    if (b.buyNeed >= bMoq) {
      b.bundleMoqStatus = 'meets_moq';
      continue;
    }
    // need > 0 && need < bMoq
    const extraUnits = bMoq - b.buyNeed;
    const edsr = b.effectiveDSR;
    const extraDOC = edsr > 0 ? Math.round(extraUnits / edsr) : 99999;
    b.bundleMoqExtraDOC = extraDOC;
    b.bundleMoqStatus = 'bdlmoq-need-below-moq';
    b.bundleMoqOptions = {
      a_buyMoq: { qty: bMoq, extraDOC, extraUnits },
      b_switchToCore: { available: true, instruction: 'Use Force Cores in the Purchasing tab' },
      c_throttle: {
        gapUnits: extraUnits,
        instruction: 'Consider raising the Amazon price for this bundle until demand justifies the MOQ.',
      },
    };
    // Default: do NOT auto-buy. User must explicitly review.
    b.buyNeed = 0;
    void moqDocThresh; // legacy v3 threshold no longer used; kept import path stable
  }

  // aggregate to core
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

  // MOQ + casepack per core
  const coreItems = [];
  for (const [coreId, needPieces] of Object.entries(coreNeedMap)) {
    const core = vCoreById[coreId];
    if (!core) continue;
    const histUnitCost = getVendorCoreUnitCost(coreId, vendor, priceCompFull, priceIndex);
    const pricePerPiece = histUnitCost != null ? histUnitCost : num(core.cost);
    const priceSource = histUnitCost != null ? '7g-history' : 'sheet-cost';
    const moqCredit = coreMoqCreditFromBundles[coreId] || 0;
    const moqRes = applyMoqAndCasePack(needPieces, core.moq, core.casePack, moqThreshold, moqCredit);

    // INTERMITTENT-aware MOQ status: if any bundle driving this core is
    // INTERMITTENT and the inflation ratio > limit, flag for review.
    let intermittentExcess = false;
    if ((coreBundlesMap[coreId] || []).some(bid => {
      const b = prepped.find(x => x.id === bid);
      return b && b.segment === 'INTERMITTENT';
    })) {
      if (moqRes.moqInflationRatio > INTERMITTENT_MOQ_INFLATE_LIMIT) {
        intermittentExcess = true;
      }
    }

    // ─── MOQ inflation hard cap ─────────────────────────────────
    // If the MOQ would inflate the buy beyond `moqHardCap × need`,
    // refuse to recommend the purchase. The item still appears in
    // the output (so the UI can surface a "blocked" badge), but
    // finalQty/cost are zeroed and `rejectedByMoqCap` carries the
    // detail the UI needs to render the override CTA.
    let finalQty = moqRes.finalQty;
    let costApplied = finalQty * pricePerPiece;
    let excessFromMoq = moqRes.excessFromMoq;
    let excessCostFromMoq = excessFromMoq * pricePerPiece;
    let rejectedByMoqCap = false;
    let moqCapDetail = null;
    if (
      needPieces > 0 &&
      moqHardCap > 0 &&
      moqRes.moqInflationRatio > moqHardCap
    ) {
      moqCapDetail = {
        reason: 'moq_cap_exceeded',
        ratio: moqRes.moqInflationRatio,
        cap: moqHardCap,
        wouldHaveBought: moqRes.finalQty,
        wouldHaveCost: moqRes.finalQty * pricePerPiece,
        coreNeed: needPieces,
      };
      rejectedByMoqCap = true;
      finalQty = 0;
      costApplied = 0;
      excessFromMoq = 0;
      excessCostFromMoq = 0;
    }

    // Sprint 3 Fix 8: Below-typical-PO warning. Fires only when the
    // engine actually recommends a buy (finalQty>0), there's PO history
    // (typicalPoSize defined), and the recommendation falls below 30%
    // of the typical size. Doesn't affect finalQty.
    const typicalPoSize = typicalPoSizeByCore[coreId] ?? null;
    const poSizeWarning = !!(
      typicalPoSize && typicalPoSize > 0 && finalQty > 0 &&
      finalQty < typicalPoSize * 0.3
    );

    coreItems.push({
      id: coreId,
      mode: 'core',
      needPieces,
      finalQty,
      pricePerPiece,
      priceSource,
      cost: costApplied,
      moqInflated: moqRes.moqInflated,
      moqInflationRatio: moqRes.moqInflationRatio,
      excessFromMoq,
      excessCostFromMoq,
      moqOriginal: num(core.moq),
      moqCredit: moqRes.moqCredit,
      moqEffective: moqRes.effectiveMoq,
      creditingBundles: coreCreditBundlesMap[coreId] || [],
      bundlesAffected: (coreBundlesMap[coreId] || []).length,
      bundlesAffectedIds: coreBundlesMap[coreId] || [],
      urgent: prepped.some(b =>
        b.urgent && b.buyMode === 'core' && b.coresUsed.some(c => c.coreId === coreId)
      ),
      intermittentExcess,
      rejectedByMoqCap,
      moqCapDetail,
      typicalPoSize,
      poSizeWarning,
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
    const histUnitCost = getVendorCoreUnitCost(c.id, vendor, priceCompFull, priceIndex);
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

  // Now that priceMap exists, fill in the dollar value of safety the
  // engine would have bought for DORMANT_REVIVED bundles.
  for (const b of prepped) {
    if (!b.dormantRevivedSafetyDeclined) continue;
    const unit = priceMap[b.id] || 0;
    b.dormantRevivedSafetyDeclined.wouldHaveCost =
      b.dormantRevivedSafetyDeclined.wouldHaveBought * unit;
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
    buyModeReason: b.buyModeReason || null,
    urgent: b.urgent,
    coresUsed: b.coresUsed,
    bundleMoqStatus: b.bundleMoqStatus || null,
    bundleMoqExtraDOC: b.bundleMoqExtraDOC || 0,
    bundleMoqOriginalNeed: b.bundleMoqOriginalNeed ?? b.buyNeed,
    bundleMoqOptions: b.bundleMoqOptions || null,
    forecast: {
      level: b.forecast.level,
      trend: b.forecast.trend,
      effectiveTrend: b.forecast.trend,
      // Pass through the full forecast structure for the Why Buy panel:
      segment: b.forecast.segment,
      formula: b.forecast.formula,
      reasoning: b.forecast.reasoning,
      inputs: b.forecast.inputs,
      projection: b.forecast.projection,
      coverageDemand: b.forecast.coverageDemand,
      safetyStock: b.forecast.safetyStock,
      sigmaLT: b.forecast.sigmaLT,
      Z: b.forecast.Z,
    },
    safetyStock: {
      amount: Math.round(b.forecast.safetyStock),
      sigmaLT: b.forecast.sigmaLT,
      Z: b.forecast.Z,
      profABC: b.profABC,
      fallback: !!b.forecast.flags?.safetyStockFallback,
    },
    // Legacy compat fields (consumers may still read these)
    demandBreakdown: {
      fromLevel: Math.round(b.forecastLevel * targetDoc),
      fromTrend: 0,
      fromSeasonal: Math.round(Math.max(0, b.coverageDemand - b.forecastLevel * targetDoc - b.forecast.safetyStock)),
      total: Math.round(b.coverageDemand),
    },
    spikeVisual: b.spikeVisual,
    yoyInfo: null,
    segment: b.segment,
    sevenDayReconciled: b.sevenDayReconciled || null,
    dormantRevived: b.segment === 'DORMANT_REVIVED',
    dormantRevivedSafetyDeclined: b.dormantRevivedSafetyDeclined || null,
    // Watchlist support: derived from bundleDays if available.
    lastSaleDate: (() => {
      const series = bundleDaysByJ[b.id] || [];
      for (let i = series.length - 1; i >= 0; i--) {
        if ((Number(series[i].dsr) || 0) > 0) return series[i].date || null;
      }
      return null;
    })(),
    daysDormant: (() => {
      const series = bundleDaysByJ[b.id] || [];
      let lastSale = null;
      for (let i = series.length - 1; i >= 0; i--) {
        if ((Number(series[i].dsr) || 0) > 0) { lastSale = series[i].date; break; }
      }
      if (!lastSale) return null;
      const t = new Date(lastSale);
      if (isNaN(t.getTime())) return null;
      return Math.max(0, Math.round((Date.now() - t.getTime()) / 86400000));
    })(),
    historicalDsr: (() => {
      const series = bundleDaysByJ[b.id] || [];
      const positives = series.map(d => Number(d.dsr) || 0).filter(v => v > 0);
      if (!positives.length) return 0;
      return positives.reduce((s, v) => s + v, 0) / positives.length;
    })(),
    regime: b.segment === 'INTERMITTENT' ? 'intermittent'
          : b.segment === 'NEW_OR_SPARSE' ? 'new_or_sparse'
          : 'continuous',
    flags: {
      segment: b.segment,
      shortHistory: !!b.forecast.flags?.seriesLength && b.forecast.flags.seriesLength < 30,
      safetyStockFallback: !!b.forecast.flags?.safetyStockFallback,
      noData: !!b.forecast.flags?.noData,
      regime: b.segment === 'INTERMITTENT' ? 'intermittent'
            : b.segment === 'NEW_OR_SPARSE' ? 'new_or_sparse'
            : 'continuous',
      regimeMethod: b.forecast.formula,
      regimeReason: (b.forecast.reasoning && b.forecast.reasoning[0]) || '',
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
      intermittentExcess: !!item?.intermittentExcess,
      rejectedByMoqCap: !!item?.rejectedByMoqCap,
      moqCapDetail: item?.moqCapDetail || null,
      typicalPoSize: item?.typicalPoSize ?? null,
      poSizeWarning: !!item?.poSizeWarning,
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
    engineVersion: 'v4',
  };
}

// ============================================================
// Batch helper — same shape as v3.4's batchVendorRecommendations
// so the App.jsx call site flips imports and keeps working.
// ============================================================
export function batchVendorRecommendationsV4({
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
  segmentMap,
  settings,
  onProgress,
}) {
  const out = {};
  const vList = vendors || [];
  for (let i = 0; i < vList.length; i++) {
    const v = vList[i];
    if (!v || !v.name) continue;
    out[v.name] = calcVendorRecommendationV4({
      vendor: v,
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
      segmentMap,
      settings,
      bundleMoqOverride: 0,
      moqExtraDocThreshold: num(settings?.moqExtraDocThreshold, 30),
    });
    if (onProgress) {
      try { onProgress((i + 1) / vList.length, v.name); } catch {}
    }
  }
  return out;
}
