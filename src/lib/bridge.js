// src/lib/bridge.js
// Bridge Tab — pure module. Computes USA bridge recommendations.
// Consumes v3 vendorRecs + data layer. Does NOT modify any engine code.
//
// IMPORTANT: inbound info is NOT on the bundle object directly. It lives in
// `data.inbound` (the 7f receiving table), keyed by core or JLS#. We aggregate
// the same way BundleTab does: match inbound rows where row.core ∈ {bundle.j,
// bundle.core1, bundle.core2, bundle.core3} (case-insensitive). ETA is the
// LATEST eta (so the gap window covers all in-transit pieces). Days-to-arrival
// is derived from that ETA date.

const DEFAULT_PIPELINE_DAYS = 25;
const PREVENTIVE_DOC_THRESHOLD = 90;

// ─── helpers ───────────────────────────────────────────────────
const num = (x) => { const n = Number(x); return isNaN(n) ? 0 : n; };
const numOrNull = (x) => { const n = Number(x); return isNaN(n) ? null : n; };

const isUSAVendor = (v) => {
  if (!v) return false;
  const c = (v.country || '').toLowerCase().trim();
  return c === 'us' || c === 'usa' || c === 'united states' || c === '';
};

const isChinaVendor = (v) => {
  if (!v) return false;
  const c = (v.country || '').toLowerCase().trim();
  return c === 'china' || c === 'cn';
};

// Convert ISO-ish date string to days from today (rounded up).
// Returns null if invalid or in the past.
const etaToDays = (etaStr) => {
  if (!etaStr) return null;
  const d = new Date(etaStr);
  if (isNaN(d.getTime())) return null;
  const days = Math.ceil((d - new Date()) / 86400000);
  return days > 0 ? days : null;
};

// Mirror of BundleTab's inbound aggregation logic.
// Match inbound rows where row.core matches the bundle's JLS or any of its cores.
const getBundleInboundInfo = (bundle, inboundData) => {
  if (!bundle || !Array.isArray(inboundData) || inboundData.length === 0) {
    return { inbound_pieces: 0, china_eta: null };
  }

  const cores = [bundle.core1, bundle.core2, bundle.core3].filter(Boolean);
  const ids = new Set(
    [bundle.j, ...cores]
      .filter(Boolean)
      .map(x => String(x).trim().toLowerCase())
  );
  if (ids.size === 0) return { inbound_pieces: 0, china_eta: null };

  const matches = inboundData.filter(i =>
    i && ids.has(String(i.core || '').trim().toLowerCase())
  );
  if (matches.length === 0) return { inbound_pieces: 0, china_eta: null };

  const inbound_pieces = matches.reduce((s, m) => s + num(m.pieces), 0);

  // Use the LATEST eta — that's how long we need bridge cover for
  const etas = matches.map(m => m.eta).filter(Boolean).sort();
  const latestEta = etas.length > 0 ? etas[etas.length - 1] : null;
  const china_eta = etaToDays(latestEta);

  return { inbound_pieces, china_eta };
};

// ─── main entry ────────────────────────────────────────────────
export function computeBridgeRecommendations({
  vendors = [],
  cores = [],
  bundles = [],
  vendorRecs = {},
  receivingFull = [],
  inbound = [],
  fees = [],
  settings = {},
}) {
  const pipeline_days = num(settings.pipeline_days) || DEFAULT_PIPELINE_DAYS;
  const moqInflationThreshold = num(settings.moqInflationThreshold) || 1.5;

  // Build fee map: bundleId -> {aicogs, gp, pr}
  // Used for margin impact calculation in contributing_bundles.
  const feeMap = {};
  for (const f of fees) if (f && f.j) feeMap[f.j] = f;

  // ─── Diagnostic counters (kept always; helps any future debugging) ───
  const diag = {
    vendorsCount: vendors.length,
    coresCount: cores.length,
    bundlesCount: bundles.length,
    vendorRecsCount: Object.keys(vendorRecs || {}).length,
    inboundCount: (inbound || []).length,
    receivingFullCount: (receivingFull || []).length,
    inboundSample: (inbound || []).slice(0, 2),
    bundleDetailsTotal: 0,
    bundlesNotInMap: 0,
    bundlesWithZeroDSR: 0,
    bundlesWithNoChinaEta: 0,
    bundlesWithNoInboundPieces: 0,
    bundlesWithNoCurrentDOC: 0,
    bundlesWithNoGap: 0,
    bundlesWithGap: 0,
  };

  // Lookup maps
  const coreMap = {};
  for (const c of cores) if (c && c.id) coreMap[c.id] = c;

  const vendorMap = {};
  for (const v of vendors) if (v && v.name) vendorMap[v.name] = v;

  const bundleMap = {};
  for (const b of bundles) if (b && b.j) bundleMap[b.j] = b;

  // Build BOM map per bundle from core1..core20 (PurchTab iterates 1..20)
  const getBundleCores = (bundle) => {
    const out = [];
    for (let i = 1; i <= 20; i++) {
      const cid = bundle['core' + i];
      if (cid) out.push({ coreId: cid, qty: 1 }); // qty per bundle = 1 unless your data carries it
    }
    return out;
  };

  // ─── Phase 1: per-bundle gap ──────────────────────────────────
  const bundlesWithGap = [];
  const allBundleSnapshots = []; // for preventive section

  for (const vendorName of Object.keys(vendorRecs || {})) {
    const vRec = vendorRecs[vendorName];
    if (!vRec || !Array.isArray(vRec.bundleDetails)) continue;

    for (const bd of vRec.bundleDetails) {
      diag.bundleDetailsTotal++;
      const bundle = bundleMap[bd.bundleId];
      if (!bundle) { diag.bundlesNotInMap++; continue; }

      const effDSR = num(bd.effectiveDSR);
      const assignedInv = num(bd.assignedInv);
      const rawFromWaterfall = num(bd.rawAssignedFromWaterfall);
      const non_inbound_pieces = assignedInv + rawFromWaterfall;

      const current_DOC = bd.currentCoverDOC != null
        ? num(bd.currentCoverDOC)
        : (effDSR > 0 ? non_inbound_pieces / effDSR : null);

      const { inbound_pieces, china_eta } = getBundleInboundInfo(bundle, inbound);

      const coresUsed = (bd.coresUsed && bd.coresUsed.length > 0)
        ? bd.coresUsed
        : getBundleCores(bundle);

      allBundleSnapshots.push({
        bundleId: bd.bundleId,
        bundleName: bundle.t || bundle.title || bundle.name || bd.bundleId,
        effDSR,
        non_inbound_pieces,
        inbound_pieces,
        china_eta,
        current_DOC,
        bundle,
        bd,
      });

      // Filter & count reasons
      // Use 0.05 threshold (not just <=0) to filter out "ghost" bundles with
      // effectively zero DSR — they cause inconsistent tiny gaps from rounding.
      if (effDSR < 0.05) { diag.bundlesWithZeroDSR++; continue; }
      if (china_eta == null || china_eta <= 0) { diag.bundlesWithNoChinaEta++; continue; }
      if (inbound_pieces <= 0) { diag.bundlesWithNoInboundPieces++; continue; }
      if (current_DOC == null) { diag.bundlesWithNoCurrentDOC++; continue; }

      const total_cover_needed_DOC = china_eta + pipeline_days;
      const target_pieces = total_cover_needed_DOC * effDSR;
      const gap_pieces = Math.max(0, target_pieces - non_inbound_pieces);

      if (gap_pieces <= 0) { diag.bundlesWithNoGap++; continue; }
      diag.bundlesWithGap++;

      const gap_DOC = gap_pieces / effDSR;

      bundlesWithGap.push({
        bundleId: bd.bundleId,
        bundleName: bundle.t || bundle.title || bundle.name || bd.bundleId,
        effDSR,
        forecastLevel: bd.forecast?.level ?? effDSR,
        non_inbound_pieces,
        inbound_pieces,
        china_eta,
        total_cover_needed_DOC,
        target_pieces,
        gap_pieces,
        current_DOC,
        gap_DOC,
        coresUsed,
        bundle,
        bd,
      });
    }
  }

  // ─── Phase 2: aggregate to cores ──────────────────────────────
  // We also pre-compute last China & USA prices PER CORE here so we can
  // include margin impact on each contributing_bundle row.
  const coreDemand = {};

  // Pre-compute price lookups for all cores referenced by bundles-with-gap
  const corePrices = {};
  const allReferencedCores = new Set();
  for (const bg of bundlesWithGap) {
    for (const cu of (bg.coresUsed || [])) {
      if (cu.coreId) allReferencedCores.add(cu.coreId);
    }
  }
  for (const coreId of allReferencedCores) {
    const allReceipts = (receivingFull || []).filter(r =>
      r && (r.core === coreId || r.coreId === coreId)
    );
    const usaR = allReceipts.filter(r => isUSAVendor(vendorMap[r.vendor]));
    const chinaR = allReceipts.filter(r => isChinaVendor(vendorMap[r.vendor]));
    const usaSorted = [...usaR].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const chinaSorted = [...chinaR].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    corePrices[coreId] = {
      usa: usaSorted.length > 0
        ? (numOrNull(usaSorted[0].price) ?? numOrNull(usaSorted[0].pricePerUnit))
        : null,
      china: chinaSorted.length > 0
        ? (numOrNull(chinaSorted[0].price) ?? numOrNull(chinaSorted[0].pricePerUnit))
        : null,
    };
  }

  // Compute margin impact for one (bundle, core) pair.
  // Returns {margin_actual, margin_usa, margin_drop_pp} all-or-nothing.
  // Returns nulls if any input is missing/invalid.
  const computeMarginImpact = (bundleId, qty_per_bundle, coreId) => {
    const NULLS = { margin_actual: null, margin_usa: null, margin_drop_pp: null };
    const fee = feeMap[bundleId];
    if (!fee) return NULLS;
    const aicogs = num(fee.aicogs);
    const gp = num(fee.gp);
    if (aicogs <= 0 || gp <= 0) return NULLS;
    const prices = corePrices[coreId];
    if (!prices) return NULLS;
    const usa_price = prices.usa;
    const china_price = prices.china;
    if (usa_price == null || china_price == null) return NULLS;
    const delta_unit = (usa_price - china_price) * qty_per_bundle;
    const gp_usa = gp - delta_unit;
    const aicogs_usa = aicogs + delta_unit;
    if (aicogs_usa <= 0) return NULLS; // pathological
    const margin_actual = (gp / aicogs) * 100;
    const margin_usa = (gp_usa / aicogs_usa) * 100;
    return {
      margin_actual,
      margin_usa,
      margin_drop_pp: margin_actual - margin_usa,
    };
  };

  for (const bg of bundlesWithGap) {
    for (const cu of (bg.coresUsed || [])) {
      const core_id = cu.coreId;
      if (!core_id) continue;
      const qty_per_bundle = num(cu.qty) || 1;
      const pieces_contributed = bg.gap_pieces * qty_per_bundle;

      const marginImpact = computeMarginImpact(bg.bundleId, qty_per_bundle, core_id);

      if (!coreDemand[core_id]) {
        coreDemand[core_id] = { pieces_needed: 0, contributing_bundles: [] };
      }
      coreDemand[core_id].pieces_needed += pieces_contributed;
      coreDemand[core_id].contributing_bundles.push({
        bundle_id: bg.bundleId,
        bundle_name: bg.bundleName,
        gap_pieces: bg.gap_pieces,
        gap_DOC: bg.gap_DOC,
        qty_per_bundle,
        pieces_contributed,
        urgency_DOC: bg.current_DOC,
        effDSR: bg.effDSR,
        current_DOC: bg.current_DOC,
        china_eta: bg.china_eta,
        non_inbound_pieces: bg.non_inbound_pieces,
        target_pieces: bg.target_pieces,
        total_cover_needed_DOC: bg.total_cover_needed_DOC,
        // Margin impact (per-core, isolated — assumes other cores stay China)
        margin_actual: marginImpact.margin_actual,
        margin_usa: marginImpact.margin_usa,
        margin_drop_pp: marginImpact.margin_drop_pp,
      });
    }
  }

  // ─── Phase 3: USA vendor selection + recommendation ───────────
  const recommendations = [];

  for (const coreId of Object.keys(coreDemand)) {
    const core = coreMap[coreId];
    if (!core) continue;
    const demand = coreDemand[coreId];

    // Find historical receipts for this core
    const allReceipts = (receivingFull || []).filter(r =>
      r && (r.core === coreId || r.coreId === coreId)
    );
    const usaReceipts = allReceipts.filter(r => isUSAVendor(vendorMap[r.vendor]));
    const chinaReceipts = allReceipts.filter(r => isChinaVendor(vendorMap[r.vendor]));

    // Last China price
    const chinaSorted = [...chinaReceipts].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const last_china_price = chinaSorted.length > 0
      ? (numOrNull(chinaSorted[0].price) ?? numOrNull(chinaSorted[0].pricePerUnit))
      : null;

    // Pick most recent USA vendor (with valid vendor object)
    let usa_vendor = null;
    let last_usa_price = null;
    if (usaReceipts.length > 0) {
      const sorted = [...usaReceipts].sort((a, b) =>
        (b.date || '').localeCompare(a.date || '')
      );
      for (const recent of sorted) {
        const v = vendorMap[recent.vendor];
        if (v) {
          usa_vendor = {
            name: v.name,
            lt: num(v.lt) || 30,
            moq: num(v.moq) || 0,
            casePack: num(core.casePack) || 1,
            last_price: numOrNull(recent.price) ?? numOrNull(recent.pricePerUnit) ?? 0,
            last_purchase_date: recent.date,
            total_history_count: usaReceipts.length,
          };
          last_usa_price = usa_vendor.last_price;
          break;
        }
      }
    }

    // Aggregate metrics for throttle / urgency
    const min_urgency_DOC = Math.min(
      ...demand.contributing_bundles.map(b => b.urgency_DOC ?? Infinity)
    );
    const max_china_eta = Math.max(
      ...demand.contributing_bundles.map(b => b.china_eta ?? 0)
    );
    const days_until_china_live = max_china_eta + pipeline_days;

    // Determine flag
    let flag, suggested_action;
    if (!usa_vendor) {
      flag = 'NO_USA_HISTORY';
      suggested_action = 'price_increase';
    } else if (min_urgency_DOC < usa_vendor.lt) {
      flag = 'BRIDGE_TOO_LATE';
      suggested_action = 'price_increase';
    } else {
      flag = 'VIABLE';
      suggested_action = 'order';
    }

    // Throttle suggestion (worst-bundle perspective)
    let throttle_suggestion = null;
    if (flag !== 'VIABLE') {
      const worst = demand.contributing_bundles.reduce((a, b) =>
        (a.urgency_DOC ?? Infinity) < (b.urgency_DOC ?? Infinity) ? a : b
      );
      const days_for_worst = (worst.china_eta || max_china_eta) + pipeline_days;
      const target_DSR = days_for_worst > 0 ? worst.non_inbound_pieces / days_for_worst : 0;
      const reduction_pct = worst.effDSR > 0
        ? Math.max(0, (1 - target_DSR / worst.effDSR) * 100)
        : 0;
      throttle_suggestion = {
        target_DSR,
        current_DSR: worst.effDSR,
        reduction_pct,
        days_until_china_live: days_for_worst,
        worst_bundle: worst.bundle_id,
      };
    }

    // MOQ application
    let pieces_to_buy = null;
    let raw_pieces_needed = Math.round(demand.pieces_needed);
    let moq_inflated = false;
    let inflation_ratio = 1;
    let excess_pieces = 0;
    let bridge_DOC_added = null;
    let needed_DOC = null;
    let excess_DOC_overhead = 0;

    const weighted_dsr = demand.contributing_bundles.reduce(
      (s, b) => s + (b.effDSR * b.qty_per_bundle), 0
    );
    needed_DOC = weighted_dsr > 0 ? raw_pieces_needed / weighted_dsr : null;

    if (flag === 'VIABLE' && usa_vendor) {
      const moq = usa_vendor.moq || 0;
      const casePack = usa_vendor.casePack || 1;
      let final = Math.max(raw_pieces_needed, moq);
      if (casePack > 1) final = Math.ceil(final / casePack) * casePack;
      pieces_to_buy = final;
      excess_pieces = Math.max(0, final - raw_pieces_needed);
      inflation_ratio = raw_pieces_needed > 0 ? final / raw_pieces_needed : 1;
      moq_inflated = inflation_ratio >= moqInflationThreshold;
      bridge_DOC_added = weighted_dsr > 0 ? final / weighted_dsr : null;
      excess_DOC_overhead = bridge_DOC_added != null && needed_DOC != null
        ? Math.max(0, bridge_DOC_added - needed_DOC)
        : 0;
    }

    let delta_pct = null;
    if (last_china_price && last_usa_price && last_china_price > 0) {
      delta_pct = ((last_usa_price - last_china_price) / last_china_price) * 100;
    }

    recommendations.push({
      core_id: coreId,
      core_name: core.ti || core.name || coreId,
      flag,
      suggested_action,
      pieces_to_buy,
      raw_pieces_needed,
      bridge_DOC_added,
      needed_DOC,
      moq_inflated,
      inflation_ratio,
      excess_pieces,
      excess_DOC_overhead,
      usa_vendor,
      price_comparison: { last_china_price, last_usa_price, delta_pct },
      contributing_bundles: demand.contributing_bundles,
      throttle_suggestion,
      urgency_score: min_urgency_DOC,
      core,
      max_china_eta,
      days_until_china_live,
      weighted_dsr,
    });
  }

  recommendations.sort((a, b) => (a.urgency_score ?? 999) - (b.urgency_score ?? 999));

  // ─── Phase 4: bundle groups ───────────────────────────────────
  const bundleGroups = bundlesWithGap.map(bg => {
    const required_cores = (bg.coresUsed || []).map(c => c.coreId).filter(Boolean);
    const recs_for_this = recommendations.filter(r => required_cores.includes(r.core_id));
    const blocked_cores = recs_for_this.filter(r => r.flag !== 'VIABLE').map(r => r.core_id);
    const has_blocked = blocked_cores.length > 0;

    return {
      bundle_id: bg.bundleId,
      bundle_name: bg.bundleName,
      current_DOC_non_inbound: bg.current_DOC,
      gap_DOC: bg.gap_DOC,
      gap_pieces: bg.gap_pieces,
      china_eta: bg.china_eta,
      effDSR: bg.effDSR,
      required_cores,
      recommendations: recs_for_this,
      meta_flag: has_blocked ? 'INCOMPLETE_BRIDGE' : 'COMPLETE',
      meta_message: has_blocked
        ? `Bridge incomplete — ${blocked_cores.join(', ')} cannot be sourced from USA in time. Buying remaining cores alone will not prevent stockout.`
        : null,
    };
  });

  // ─── Other actions: preventive bridge candidates ──────────────
  const preventive = [];
  for (const ab of allBundleSnapshots) {
    if (ab.inbound_pieces > 0) continue;
    if (ab.effDSR <= 0) continue;
    if (ab.current_DOC == null) continue;
    if (ab.current_DOC > PREVENTIVE_DOC_THRESHOLD) continue;
    preventive.push({
      bundle_id: ab.bundleId,
      bundle_name: ab.bundleName,
      current_DOC: ab.current_DOC,
      effDSR: ab.effDSR,
      non_inbound_pieces: ab.non_inbound_pieces,
    });
  }
  preventive.sort((a, b) => a.current_DOC - b.current_DOC);

  const summary = {
    bundles_in_gap: bundlesWithGap.length,
    total_bridge_pieces: recommendations
      .filter(r => r.flag === 'VIABLE')
      .reduce((s, r) => s + (r.pieces_to_buy || 0), 0),
    total_bridge_cost: recommendations
      .filter(r => r.flag === 'VIABLE')
      .reduce((s, r) => s + ((r.pieces_to_buy || 0) * (r.usa_vendor?.last_price || 0)), 0),
    cores_viable: recommendations.filter(r => r.flag === 'VIABLE').length,
    cores_blocked: recommendations.filter(r => r.flag !== 'VIABLE').length,
    cores_no_history: recommendations.filter(r => r.flag === 'NO_USA_HISTORY').length,
    cores_too_late: recommendations.filter(r => r.flag === 'BRIDGE_TOO_LATE').length,
  };

  // ─── Diagnostic log + window expose ─────────────────────────
  // Always logs once per analysis run. Helps debug "why is everything in preventive?".
  // Exposes __bridgeDiag on window for inspection.
  if (typeof console !== 'undefined') {
    console.log('[BRIDGE] Analysis complete:', {
      ...diag,
      summary,
      preventiveCount: preventive.length,
      recommendationsCount: recommendations.length,
    });
  }
  if (typeof window !== 'undefined') {
    window.__bridgeDiag = {
      ...diag,
      summary,
      preventiveCount: preventive.length,
      sampleSnapshots: allBundleSnapshots.slice(0, 5),
      recommendations,
    };
  }

  return {
    generated_at: new Date().toISOString(),
    settings_used: { pipeline_days },
    primary_recommendations: recommendations,
    bundle_groups: bundleGroups,
    other_actions: {
      preventive,
      no_usa_history: recommendations.filter(r => r.flag === 'NO_USA_HISTORY'),
      bridge_too_late: recommendations.filter(r => r.flag === 'BRIDGE_TOO_LATE'),
    },
    summary,
  };
}
