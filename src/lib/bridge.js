// src/lib/bridge.js
// Bridge Tab — pure module. Computes USA bridge recommendations.
// Consumes v3 vendorRecs + data layer. Does NOT modify any engine code.
//
// Algorithm phases:
//   1. Per-bundle gap calculation (China_eta + pipeline_days vs effDSR cover)
//   2. Bundle → Core aggregation (multi-bundle cores sum demand)
//   3. USA vendor selection + flag determination
//   4. Bundle group construction (visual grouping w/ INCOMPLETE_BRIDGE meta-flag)

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

// Try to extract China inbound info for a bundle from multiple possible sources.
// Returns { inbound_pieces, china_eta_days } — china_eta_days is null if unknown.
const getBundleInboundInfo = (bundle, inboundData) => {
  let inbound_pieces = 0;
  let china_eta = null;

  // Direct bundle fields (multiple possible names)
  const directInb = bundle.inboundPieces ?? bundle.bundleInboundPieces ?? bundle.inbound ?? bundle.bundleInbound;
  if (directInb != null) inbound_pieces = num(directInb);

  const directEta = bundle.daysBeforeArrival ?? bundle.chinaEta ?? bundle.china_eta_days ?? bundle.daysToArrival;
  if (directEta != null && !isNaN(Number(directEta))) china_eta = Number(directEta);

  // Fallback to inbound table
  if ((inbound_pieces === 0 || china_eta == null) && Array.isArray(inboundData) && inboundData.length > 0) {
    const matches = inboundData.filter(i =>
      i && (i.bundleId === bundle.j || i.j === bundle.j || i.bundleJls === bundle.j)
    );
    if (matches.length > 0) {
      if (inbound_pieces === 0) {
        inbound_pieces = matches.reduce((s, m) => s + num(m.pieces), 0);
      }
      if (china_eta == null) {
        const etas = matches
          .map(m => num(m.daysBeforeArrival ?? m.daysToArrival ?? m.eta))
          .filter(d => d > 0);
        if (etas.length > 0) china_eta = Math.min(...etas);
      }
    }
  }

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
  settings = {},
}) {
  const pipeline_days = num(settings.pipeline_days) || DEFAULT_PIPELINE_DAYS;
  const moqInflationThreshold = num(settings.moqInflationThreshold) || 1.5;

  // Lookup maps
  const coreMap = {};
  for (const c of cores) if (c && c.id) coreMap[c.id] = c;

  const vendorMap = {};
  for (const v of vendors) if (v && v.name) vendorMap[v.name] = v;

  const bundleMap = {};
  for (const b of bundles) if (b && b.j) bundleMap[b.j] = b;

  // ─── Phase 1: per-bundle gap ──────────────────────────────────
  const bundlesWithGap = [];
  const allBundleSnapshots = []; // for preventive section

  for (const vendorName of Object.keys(vendorRecs || {})) {
    const vRec = vendorRecs[vendorName];
    if (!vRec || !Array.isArray(vRec.bundleDetails)) continue;

    for (const bd of vRec.bundleDetails) {
      const bundle = bundleMap[bd.bundleId];
      if (!bundle) continue;

      const effDSR = num(bd.effectiveDSR);
      const assignedInv = num(bd.assignedInv);
      const rawFromWaterfall = num(bd.rawAssignedFromWaterfall);
      const non_inbound_pieces = assignedInv + rawFromWaterfall;

      // Use v3's currentCoverDOC if available (post-waterfall)
      const current_DOC = bd.currentCoverDOC != null
        ? num(bd.currentCoverDOC)
        : (effDSR > 0 ? non_inbound_pieces / effDSR : null);

      const { inbound_pieces, china_eta } = getBundleInboundInfo(bundle, inbound);

      // Snapshot for "other actions" section (all active bundles)
      allBundleSnapshots.push({
        bundleId: bd.bundleId,
        bundleName: bundle.title || bundle.name || bd.bundleId,
        effDSR,
        non_inbound_pieces,
        inbound_pieces,
        china_eta,
        current_DOC,
        bundle,
        bd,
      });

      // Skip non-classic-bridge cases
      if (effDSR <= 0) continue;
      if (china_eta == null || china_eta <= 0) continue;
      if (inbound_pieces <= 0) continue;
      if (current_DOC == null) continue;

      const total_cover_needed_DOC = china_eta + pipeline_days;
      const target_pieces = total_cover_needed_DOC * effDSR;
      const gap_pieces = Math.max(0, target_pieces - non_inbound_pieces);

      if (gap_pieces <= 0) continue;

      const gap_DOC = gap_pieces / effDSR;

      bundlesWithGap.push({
        bundleId: bd.bundleId,
        bundleName: bundle.title || bundle.name || bd.bundleId,
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
        coresUsed: bd.coresUsed || [],
        bundle,
        bd,
      });
    }
  }

  // ─── Phase 2: aggregate to cores ──────────────────────────────
  const coreDemand = {};

  for (const bg of bundlesWithGap) {
    for (const cu of (bg.coresUsed || [])) {
      const core_id = cu.coreId;
      if (!core_id) continue;
      const qty_per_bundle = num(cu.qty) || 1;
      const pieces_contributed = bg.gap_pieces * qty_per_bundle;

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

    // Weighted DSR consumption rate of this core
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

    // Price delta (positive % = USA more expensive)
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
