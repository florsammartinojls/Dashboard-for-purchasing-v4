// src/lib/recommender.js
// ============================================================
// v2 Purchase Recommendation Engine
// ============================================================
// Pure module. Given (vendor, cores, bundles, sales, receiving, settings),
// returns a VendorRecommendation with per-bundle and per-core buy quantities.
//
// Core principles (see "FBA Tool - Recommender v2 Design"):
//   1. Truth lives in the BUNDLE. Cores are aggregation for MOQ.
//   2. Single calc, two consistent views (core / bundle) by construction.
//   3. Assigned bundle inventory is intransferible in the calc.
//   4. Core raw is fungible, distributed via waterfall (urgency -> leveling).
//   5. Seasonality at bundle level via calcBundleSeasonalProfile.
//   6. MOQ applied at the end; if forced, buy MOQ and warn.
//   7. Buy mode (bundle-form vs core-form) decided per bundle from 7f history.
//   8. vendor.lt is used as-is (already includes shipping + processing).
// ============================================================


import { calcBundleSeasonalProfile, DEFAULT_PROFILE } from './seasonal.js';

// ────────────────────────────────────────────────────────────
// Vendor-specific unit material cost from 7g (priceCompFull)
// ────────────────────────────────────────────────────────────
// Returns the most recent material-only unit cost the vendor charged for
// this exact core. Excludes inbound shipping and tariffs because those
// are paid separately from the vendor PO.
//
// priceCompFull rows shape (from the sheet):
//   { core, vendor, date, pcs, matPrice (total material $), inbShip, tariffs, totalCost, cpp }
// Here we use matPrice / pcs, NOT cpp (cpp includes inbound + tariffs).
//
// If no row exists for (vendor, core), returns null so the caller can fallback.
let __rec_debug_printed = false;

// ────────────────────────────────────────────────────────────
// Parse the "Note" field of a 7g row to figure out which vendor paid it.
// Two patterns:
//   (a) "Vendor Name - PO#XXX"  → US / domestic vendor, take the Vendor Name
//   (b) "FSMSF2406050" / "AGL..." / anything WITHOUT " - " → Chinese container
//       (we can't tell which specific Chinese vendor, just that it's Chinese)
// ────────────────────────────────────────────────────────────
function parseNoteVendor(note) {
  if (!note) return { kind: 'unknown', name: null };
  const n = String(note).trim();
  // US/domestic pattern: "Name - rest"
  const m = n.match(/^(.+?)\s+-\s+/);
  if (m) {
    return { kind: 'named', name: m[1].trim() };
  }
  // No " - " separator → Chinese container code
  return { kind: 'container', name: null };
}

function isChinaVendor(vendor) {
  const c = (vendor?.country || '').toLowerCase().trim();
  return c === 'china' || c === 'cn' || c === 'prc';
}

// ────────────────────────────────────────────────────────────
// Vendor-specific unit material cost from 7g (priceComp / priceCompFull).
// Returns the most recent (totalMaterial / piecesBought) that matches this
// vendor for this core. Match strategy depends on vendor country:
//
//   US / domestic vendor:
//     row.note must start with "<vendor.name> - " (case-insensitive, fuzzy).
//
//   Chinese vendor:
//     row.note must start with a container code (no " - " separator).
//     This is a best-effort heuristic: we can't distinguish between multiple
//     Chinese vendors sharing the same core, so it returns the most recent
//     container-code row for this core, regardless of which Chinese vendor
//     actually shipped it. Acceptable as a transitional fallback.
//
// Falls back to null if nothing matches; caller then uses sheet core.cost.
// ────────────────────────────────────────────────────────────
let __rec_debug_count = 0;

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
      matches = noteName === vName
             || noteName.includes(vName)
             || vName.includes(noteName);
    }
    if (!matches) continue;

    if (!best || (r.date || '') > (best.date || '')) best = r;
  }

  // Debug: log only when we're looking up Jiangmen or when a lookup fails
  // for a Chinese vendor with rows present in the data
  if (typeof window !== 'undefined' && window.__REC_DEBUG__) {
    const rowsForCore = paymentHistory.filter(r => (r?.core || '').toLowerCase().trim() === cid);
    if (rowsForCore.length > 0 && !best) {
      console.log(`[rec-debug] NO MATCH for ${coreId} @ ${vendor.name} (country=${vendor.country}, isChina=${china})`);
      console.log(`[rec-debug]   ${rowsForCore.length} rows exist for this core:`);
      rowsForCore.slice(0, 5).forEach(r => {
        const parsed = parseNoteVendor(r.note);
        console.log(`[rec-debug]   - date=${r.date} note="${r.note}" parsed=`, parsed);
      });
    }
  }

  if (!best) return null;
  return Number(best.matPrice) / Number(best.pcs);
}
// ────────────────────────────────────────────────────────────
// Defaults for tunables (can be overridden via settings)
// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// Defaults for tunables (can be overridden via settings)
// ────────────────────────────────────────────────────────────
export const DEFAULT_SPIKE_THRESHOLD = 1.25;          // d7 >= X * cd -> spike
export const DEFAULT_MOQ_INFLATION_THRESHOLD = 1.5;   // finalQty/need >= X -> warn

const DAMP = 0.5;                                     // matches seasonal.js
const LEVELING_STEP_DAYS = 10;
const MAX_WATERFALL_ITER = 100;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function isDomestic(country) {
  const c = (country || '').toLowerCase().trim();
  return c === '' || c === 'us' || c === 'usa' || c === 'united states';
}

function getTargetDoc(vendor, settings) {
  return isDomestic(vendor?.country)
    ? num(settings?.domesticDoc, 90)
    : num(settings?.intlDoc, 180);
}

function effectiveDSR(b, spikeThreshold) {
  const cd = num(b.cd);
  const d7 = num(b.d7comp);
  const t = num(spikeThreshold, DEFAULT_SPIKE_THRESHOLD);
  if (d7 > 0 && cd > 0 && d7 >= t * cd) return d7;
  return cd;
}

function bundleAssignedInv(b, replenMap, missingMap) {
  // Matches the existing all-in model for a bundle:
  //   FIB Inv (already includes SC + Reserved + Inbound to FBA)
  // + pre-processed (replenRec.pprcUnits)
  // + batched (replenRec.batched)
  // + 7f inbound already in bundle form (from `missingMap` keyed by bundle JLS)
  const rp = (replenMap && replenMap[b.j]) || {};
  const inb7fBundle = (missingMap && missingMap[b.j]) || 0;
  return num(b.fibInv) + num(rp.pprcUnits) + num(rp.batched) + num(inb7fBundle);
}

function coresOf(b) {
  // Bundles store cores in flat fields core1..core20 / qty1..qty20
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

// ────────────────────────────────────────────────────────────
// Demand projection — inline, mirrors seasonal.js projectDemand
// but simpler (returns just the total)
// ────────────────────────────────────────────────────────────
function projectBundleDemand(dsr, days, profile, safety) {
  if (!(dsr > 0) || !(days > 0)) return 0;
  const s = num(safety, 1);

  // Flat fallback if no history
  if (!profile || !profile.hasHistory || !profile.lastYearShape) {
    return dsr * days * s;
  }

  const today = new Date();
  const curMonth = today.getMonth();
  const curShape = profile.lastYearShape[curMonth] || 1;
  const endMs = today.getTime() + days * 86400000;

  let total = 0;
  let cursor = new Date(today);
  let iter = 0;
  while (cursor.getTime() < endMs && iter < 36) {
    iter++;
    const mi = cursor.getMonth();
    const yr = cursor.getFullYear();
    const mLast = new Date(yr, mi + 1, 0);
    const effEnd = Math.min(mLast.getTime(), endMs);
    const effStart = Math.max(cursor.getTime(), today.getTime());
    const d = Math.max(0, Math.round((effEnd - effStart) / 86400000) + 1);
    const shape = profile.lastYearShape[mi] || 1;
    const rawNorm = curShape > 0 ? shape / curShape : 1;
    const dampedNorm = 1 + (rawNorm - 1) * DAMP;
    total += dsr * dampedNorm * s * d;
    cursor = new Date(yr, mi + 1, 1);
  }
  return total;
}

// ────────────────────────────────────────────────────────────
// Buy mode detection: has the vendor ever delivered this bundle
// as a finished bundle (matching row.core === bundle.j)?
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Waterfall helpers
// ────────────────────────────────────────────────────────────
function maxBundleUnitsFromPools(b, corePools) {
  let max = Infinity;
  for (const { coreId, qty } of b.coresUsed) {
    if (!(qty > 0)) continue;
    const pool = corePools[coreId];
    // Core de OTRO vendor → no es responsabilidad de este waterfall.
    // Asumimos que ese otro vendor maneja su propio raw.
    if (pool === undefined) continue;
    // Mi propio core con pool en 0 → no puedo armar nada con esta bundle.
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
    // Solo decrementar pools que pertenecen a este vendor.
    // Cores de otros vendors no están en corePools y no se tocan.
    if (corePools[coreId] === undefined) continue;
    corePools[coreId] = corePools[coreId] - give * qty;
  }
}
function distributeRawToBundles(prepped, corePools, targetDoc, replenFloor) {
  // DEBUG — quitar después de validar
  const isDebugCore = Object.keys(corePools).some(k => k === 'Core-10258');
  const dbg = isDebugCore ? (...args) => console.log('[waterfall]', ...args) : () => {};
  if (isDebugCore) {
    dbg('=== START ===');
    dbg('corePools:', { ...corePools });
    dbg('replenFloor:', replenFloor, 'targetDoc:', targetDoc);
    dbg('bundles:', prepped.map(b => ({
      j: b.j,
      dsr: b.dsr,
      seasonalDSR: b.seasonalDSR,
      assignedInv: b.assignedInv,
      curDOC_plain: b.assignedInv / b.dsr,
      curDOC_seasonal: b.assignedInv / (b.seasonalDSR || b.dsr),
      coresUsed: b.coresUsed,
    })));
  }
  
  // ... resto de la función sin tocar por ahora
  // Helper: seasonal-aware DSR for waterfall targets. Falls back to plain dsr
  // if seasonalDSR isn't set (shouldn't happen, but defensive).
  const effDSR = (b) => (b.seasonalDSR && b.seasonalDSR > 0) ? b.seasonalDSR : b.dsr;

  // "DOC" inside the waterfall is measured against seasonalDSR so that
  // reaching "90 days" here means "90 days of actual expected demand",
  // not 90 days of the flat current-DSR projection. This keeps the
  // waterfall target consistent with coverageDemand / buyNeed downstream.

  // PHASE A — urgency: bring critical bundles up to replenFloor
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

  // PHASE B — leveling: raise everyone toward targetDoc in steps,
  // using seasonal-aware DSR so the end state matches coverageDemand.
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
  // DEBUG FINAL — agregar acá, justo antes del cierre de la función
  if (isDebugCore) {
    dbg('=== END ===');
    dbg('corePools after:', { ...corePools });
    dbg('bundles after:', prepped.map(b => ({
      j: b.j,
      rawAssigned: b.rawAssigned,
      newDOC: (b.assignedInv + b.rawAssigned) / effDSR(b),
    })));
  }
}

// ────────────────────────────────────────────────────────────
// MOQ + casepack for a core
// ────────────────────────────────────────────────────────────
function applyMoqAndCasePack(needPieces, moq, casePack, moqThreshold) {
  if (needPieces <= 0) {
    return { finalQty: 0, moqInflated: false, excessFromMoq: 0, moqInflationRatio: 0 };
  }
  let qty = needPieces;
  const m = num(moq);
  const cp = num(casePack, 1);
  if (m > 0 && qty < m) qty = m;
  if (cp > 1) qty = Math.ceil(qty / cp) * cp;
  const t = num(moqThreshold, DEFAULT_MOQ_INFLATION_THRESHOLD);
  const ratio = needPieces > 0 ? qty / needPieces : 0;
  return {
    finalQty: qty,
    moqInflated: ratio >= t,
    moqInflationRatio: ratio,
    excessFromMoq: qty - needPieces,
  };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
export function calcVendorRecommendation({
  vendor,
  cores,
  bundles,
  bundleSales,
  receivingFull,
  replenMap,
  missingMap,
  priceCompFull,   // full 7g purchase history rows — used to get the last
                   // material unit cost the vendor charged for each core
  settings,
  purchFreqSafety,
  forceMode,       // optional: 'cores' | 'bundles' — overrides historical detection
}) {
  if (!vendor || !vendor.name) return null;

  const targetDoc = getTargetDoc(vendor, settings);
  const replenFloor = num(settings?.replenFloorDoc, 80);
  const spikeThreshold = num(settings?.spikeThreshold, DEFAULT_SPIKE_THRESHOLD);
  const moqThreshold = num(settings?.moqInflationThreshold, DEFAULT_MOQ_INFLATION_THRESHOLD);
  const lt = num(vendor.lt, 30);
  const safety = num(purchFreqSafety, 1.0);

  // Cores owned by this vendor (exclude JLS-prefixed rows which aren't real cores)
  const vendorCores = (cores || []).filter(
    c => c && c.id && !/^JLS/i.test(c.id) && c.ven === vendor.name
  );
  const vCoreById = {};
  vendorCores.forEach(c => { vCoreById[c.id] = c; });

  // Active bundles that reference this vendor
  const vendorBundles = (bundles || []).filter(
    b => isActiveBundle(b, settings) && bundleBelongsToVendor(b, vendor.name)
  );

  // Steps 1-2: prep each bundle (assigned inv, effective DSR, seasonal profile)
  const prepped = vendorBundles.map(b => {
    const dsr = effectiveDSR(b, spikeThreshold);

    // Use precomputed profile if provided (via batch), otherwise compute now
    let profile = b._profile;
    if (!profile) {
      try {
        profile = calcBundleSeasonalProfile(b.j, bundleSales);
      } catch {
        profile = DEFAULT_PROFILE;
      }
    }

    const ai = bundleAssignedInv(b, replenMap, missingMap);
    return {
      raw: b,
      id: b.j,
      j: b.j,
      dsr,
      profile,
      hasSeasonalHistory: !!(profile && profile.hasHistory),
      assignedInv: ai,
      coresUsed: coresOf(b),
      currentDOC: dsr > 0 ? ai / dsr : 99999,
      rawAssigned: 0,
      coverageDemand: 0,
      ltDemand: 0,
      totalAvailable: 0,
      currentCoverDOC: 0,
      buyNeed: 0,
      buyMode: 'core',
      urgent: false,
    };
  });

// Step 3: project demand
  //   flatDemand    = dsr × targetDoc × safety (the non-seasonal baseline)
  //   coverageDemand = seasonally-adjusted (what buyNeed uses)
  //   ltDemand      = for the urgency flag only
  //   seasonalDSR   = coverageDemand / targetDoc — average DSR over the horizon
  //                   accounting for seasonality. Used by the waterfall so the
  //                   leveling target matches the actual demand the bundle
  //                   will face, not a flat projection.
  for (const b of prepped) {
    b.coverageDemand = projectBundleDemand(b.dsr, targetDoc, b.profile, safety);
    b.flatDemand = Math.round(b.dsr * targetDoc * safety);
    b.ltDemand = projectBundleDemand(b.dsr, lt, b.profile, 1.0);
    b.seasonalDSR = targetDoc > 0 ? b.coverageDemand / targetDoc : b.dsr;
  }

  // Step 4: waterfall — distribute this vendor's core raw among the bundles
  // that use those cores. Pool = raw in JLS warehouse + 7f inbound to JLS
  // (pendingInbound from missingMap keyed by core.id). `core.inb` is NOT
  // included because that's inbound to Amazon FBA (already committed to
  // direct-to-Amazon flow, can't be used to assemble bundles).
  const corePools = {};
  const corePendingInbound = {};
  for (const c of vendorCores) {
    const pending = num(missingMap?.[c.id]);
    corePendingInbound[c.id] = pending;
    corePools[c.id] = num(c.raw) + pending;
  }

  
  // Only bundles that have at least one core from this vendor participate
  const waterfallBundles = prepped.filter(
    b => b.coresUsed.some(c => vCoreById[c.coreId])
  );
  distributeRawToBundles(waterfallBundles, corePools, targetDoc, replenFloor);

// Step 5: buy need per bundle
  //   currentCoverDOC is expressed in "seasonal days" — how many days of the
  //   expected (seasonal) demand the current total covers. This matches what
  //   buyNeed operates on, so DOC₁ and buyNeed stay consistent.
  for (const b of prepped) {
    const total = b.assignedInv + b.rawAssigned;
    b.totalAvailable = total;
    const edsr = (b.seasonalDSR && b.seasonalDSR > 0) ? b.seasonalDSR : b.dsr;
    b.currentCoverDOC = edsr > 0 ? total / edsr : 99999;
    b.buyNeed = Math.max(0, Math.ceil(b.coverageDemand - total));
    b.urgent = (total - b.ltDemand) < 0;
  }

  // Step 6: decide buy mode per bundle
  for (const b of prepped) {
    if (forceMode === 'bundles') {
      b.buyMode = 'bundle';
    } else if (forceMode === 'cores') {
      b.buyMode = 'core';
    } else {
      b.buyMode = canBuyAsBundle(b.raw, vendor, receivingFull) ? 'bundle' : 'core';
    }
  }

  // Step 7: aggregate to core (only for core-mode bundles and
  // only for cores owned by THIS vendor)
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

  // Step 8: MOQ + casepack per core -> coreItems

  // Price per piece comes from 7g (last material cost vendor charged for this
  // core). Falls back to sheet core.cost if no history with this vendor.
  const coreItems = [];
  for (const [coreId, needPieces] of Object.entries(coreNeedMap)) {
    const core = vCoreById[coreId];
    if (!core) continue;
    const histUnitCost = getVendorCoreUnitCost(coreId, vendor, priceCompFull);
    const pricePerPiece = histUnitCost != null ? histUnitCost : num(core.cost);
    const priceSource = histUnitCost != null ? '7g-history' : 'sheet-cost';
    const moqRes = applyMoqAndCasePack(needPieces, core.moq, core.casePack, moqThreshold);
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
      bundlesAffected: (coreBundlesMap[coreId] || []).length,
      bundlesAffectedIds: coreBundlesMap[coreId] || [],
      urgent: prepped.some(b =>
        b.urgent && b.buyMode === 'core' && b.coresUsed.some(c => c.coreId === coreId)
      ),
    });
  }
// Bundle-mode items: one row per bundle bought as a finished bundle.
  // Price per bundle unit = Σ (vendor-specific unit cost of each constituent
  // core × qty per bundle). The vendor unit cost comes from 7g history
  // (material-only, excluding inbound/tariffs which are paid separately).
  //
  // Rationale: the user confirmed that the vendor charges the same material
  // price whether they ship the core loose or assemble it into a bundle —
  // the material cost encapsulates the bundle assembly if it was bought
  // assembled historically.
  //
  // If any core in the bundle has no history with this vendor, we fallback to
  // sheet core.cost for that one core and mark priceSource as 'partial-history'.
  // If no core has any history, priceSource is 'sheet-cost'.
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
      if (histUnit != null) {
        pricePerPiece += histUnit * qty;
        anyFromHistory = true;
      } else {
        pricePerPiece += num(c.cost) * qty;
        anyFromSheet = true;
      }
    }
    const priceSource = anyFromHistory && anyFromSheet ? 'partial-history'
                      : anyFromHistory ? '7g-history'
                      : 'sheet-cost';
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

// === PRICE MAP — full lookup of { id → pricePerPiece } for every core
  // and every bundle of this vendor, regardless of whether they need to be
  // bought right now. The UI uses this so that ANY row for this vendor
  // displays the correct price (not just rows that are in buyNeed).
  //
  // For cores: unit cost = 7g material history or sheet core.cost fallback.
  // For bundles: Σ (per-core unit cost × qty per bundle), same formula as
  // bundleItems uses, but applied to ALL bundles of the vendor.
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
  
  // Per-bundle transparency (used by Bundle rows and CoreTab BundlesTable)
const bundleDetails = prepped.map(b => ({
    bundleId: b.id,
    assignedInv: b.assignedInv,
    rawAssignedFromWaterfall: b.rawAssigned,
    totalAvailable: b.totalAvailable,
    effectiveDSR: b.dsr,
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
  }));

  // Per-core summary (used by the by-core view)
  // Zero rows for cores with no need so the view can still show them.
  const coreDetails = vendorCores.map(c => {
    const item = coreItems.find(i => i.id === c.id);
    const pending = corePendingInbound[c.id] || 0;
    const rawOnHand = num(c.raw);
    return {
      coreId: c.id,
      needPieces: item?.needPieces || 0,
      finalQty: item?.finalQty || 0,
      cost: item?.cost || 0,
      moqInflated: item?.moqInflated || false,
      moqInflationRatio: item?.moqInflationRatio || 1,
      excessFromMoq: item?.excessFromMoq || 0,
      excessCostFromMoq: item?.excessCostFromMoq || 0,
      urgent: item?.urgent || false,
      bundlesAffected: item?.bundlesAffected || 0,
      bundlesAffectedIds: item?.bundlesAffectedIds || [],
      rawOnHand,
      pendingInbound: pending,
      totalPool: rawOnHand + pending,
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
  };
}

// ============================================================
// Batch helper — compute recommendations for all vendors in one go.
// Bundle seasonal profiles are computed once and cached across vendors.
// ============================================================
export function batchVendorRecommendations({
  vendors,
  cores,
  bundles,
  bundleSales,
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
    try {
      profileCache[b.j] = calcBundleSeasonalProfile(b.j, bundleSales);
    } catch {
      profileCache[b.j] = DEFAULT_PROFILE;
    }
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
      receivingFull,
      replenMap,
      missingMap,
      priceCompFull,
      settings,
      purchFreqSafety: safety,
    });
  }
  return out;
}
