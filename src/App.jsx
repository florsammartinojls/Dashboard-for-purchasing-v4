// src/App.jsx
import React, { useState, useMemo, useCallback, useEffect, useTransition, useRef } from "react";
import { fetchLive, fetchHistory, refreshHistoryOnServer, fetchInfo, apiPost } from "./lib/api";
import { R, D1, gS, fTs, gTD, isD, cAI, cNQ } from "./lib/utils";
import { Loader, Stg, QuickSum, SumCtx, SlidePanel, Dot, WorkflowChip, VendorNotes } from "./components/Shared";
import ErrorBoundary from "./components/ErrorBoundary";
import { SkeletonHero, HistoryProgressBanner } from "./components/Skeleton";
import DashboardSummary from "./components/DashboardSummary";
import PurchTab from "./components/PurchTab";
import CoreTab from "./components/CoreTab";
import BundleTab from "./components/BundleTab";
import OrdersTab from "./components/OrdersTab";
import PerformanceTab from "./components/PerformanceTab";
import BridgeTab from "./components/BridgeTab";
import SegmentsTab from "./components/SegmentsTab";
import { batchVendorRecommendationsV4 } from "./lib/recommenderV4";
import { calcPurchaseFrequency, calcBundleSeasonalProfile, DEFAULT_PROFILE } from "./lib/seasonal";
import { buildAllIndexes } from "./lib/dataIndexes";
import { batchClassifySegments } from "./lib/segmentClassifier";
import { loadOverrides, buildEffectiveMap, setOverride as setSegmentOverridePersist } from "./lib/segments";

const DEV = import.meta.env.DEV;

export const SegmentCtx = React.createContext({
  autoMap: {},
  overrides: {},
  effectiveMap: {},
  setOverride: () => {},
  refreshOverrides: () => {},
});


// === Vendors Tab ===
function VendorsTab({ data, stg, goVendor, workflow, saveWorkflow, deleteWorkflow, vendorComments, saveVendorComment }) {
  const [vSearch, setVSearch] = useState("");
  const [sortBy, setSortBy] = useState("alpha");
  const [filterNeed, setFilterNeed] = useState(false);
  const vMap = useMemo(() => { const m = {}; (data.vendors || []).forEach(v => m[v.name] = v); return m }, [data.vendors]);
  const vS = useMemo(() => {
    const g = {};
    (data.cores || []).filter(c => {
      if (stg.fA === "yes" && c.active !== "Yes") return false;
      if (stg.fA === "no" && c.active === "Yes") return false;
      if (stg.fV === "yes" && c.visible !== "Yes") return false;
      if (stg.fV === "no" && c.visible === "Yes") return false;
      if (stg.fI === "blank" && !!c.ignoreUntil) return false;
      if (stg.fI === "set" && !c.ignoreUntil) return false;
      return true;
    }).forEach(c => {
      if (!g[c.ven]) g[c.ven] = { name: c.ven, cr: 0, wa: 0, he: 0, cores: 0, dsr: 0, needBuy: 0 };
      const v = vMap[c.ven] || {};
      const st = gS(c.doc, v.lt || 30, c.buf || 14, stg);
      g[c.ven][st === "critical" ? "cr" : st === "warning" ? "wa" : "he"]++;
      g[c.ven].cores++; g[c.ven].dsr += c.dsr;
      const tg = gTD(v, stg);
      const nq = cNQ(c, tg);
      if (nq > 0) g[c.ven].needBuy++;
    });
    return Object.values(g);
  }, [data.cores, vMap, stg]);
  const vSF = useMemo(() => {
    let arr = vSearch ? vS.filter(v => v.name.toLowerCase().includes(vSearch.toLowerCase())) : [...vS];
    if (filterNeed) arr = arr.filter(v => v.needBuy > 0);
    if (sortBy === "alpha") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "critical") arr.sort((a, b) => b.cr - a.cr || b.wa - a.wa || a.name.localeCompare(b.name));
    else if (sortBy === "cores") arr.sort((a, b) => b.cores - a.cores || a.name.localeCompare(b.name));
    return arr;
  }, [vS, vSearch, sortBy, filterNeed]);
  return <div className="p-4 max-w-4xl mx-auto">
    <h2 className="text-xl font-bold text-white mb-4">Vendor Overview ({vSF.length})</h2>
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <input type="text" placeholder="Search vendor..." value={vSearch} onChange={e => setVSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2 w-full max-w-xs text-sm" />
      <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-2"><option value="alpha">A → Z</option><option value="critical">Critical ↓</option><option value="cores">Cores ↓</option></select>
      <button onClick={() => setFilterNeed(!filterNeed)} className={`text-xs px-3 py-2 rounded-lg font-medium ${filterNeed ? "bg-amber-600 text-white" : "bg-gray-800 border border-gray-700 text-gray-400"}`}>{filterNeed ? "Needs Buy ✓" : "Needs Buy"}</button>
    </div>
    {vSF.length > 0 ? <div className="space-y-1">{vSF.map(v => <div key={v.name} className="flex items-center gap-2 px-4 py-3 rounded-lg bg-gray-900/50 hover:bg-gray-800">
      <button onClick={() => goVendor(v.name)} className="flex items-center gap-4 flex-1 text-left">
        <div className="flex gap-1 min-w-[80px]">{v.cr > 0 && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold">{v.cr}</span>}{v.wa > 0 && <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-semibold">{v.wa}</span>}<span className="text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">{v.he}</span></div>
        <span className="text-white font-medium flex-1">{v.name}</span>
        <div className="flex gap-3 text-xs text-gray-500"><span>{v.cores} cores</span><span>DSR:{D1(v.dsr)}</span>{v.needBuy > 0 && <span className="text-amber-400">{v.needBuy} need</span>}</div>
      </button>
      <div className="relative"><WorkflowChip id={v.name} type="vendor" workflow={workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer="" /></div>
      <div className="relative"><VendorNotes vendor={v.name} comments={vendorComments} onSave={saveVendorComment} buyer="" /></div>
    </div>)}</div> : <p className="text-gray-500 text-sm py-8 text-center">No vendors match filters</p>}
  </div>;
}

// === Glossary Tab ===
const DEFAULT_GL = [
  // ─── BLOCK 1: BASIC STATUS METRICS ───────────────────────────
  { term: "—— BASIC STATUS ——", desc: "" },
  { term: "C.DSR", desc: "Composite Daily Sales Rate (1 decimal). Average daily units sold for a core or bundle, based on the live sheet. This is the FALLBACK number — the recommender uses something more sophisticated, but C.DSR is what shows in the table because it's familiar." },
  { term: "DOC", desc: "Days of Coverage — how many days current inventory will last at current sales rate. Calculated as All-In ÷ DSR. A DOC of 90 means: 'with the stock I have today, I'll be selling for 90 more days before running out.'" },
  { term: "All-In", desc: "Total available inventory across all stages: Raw + Pre-Processed (PPRC) + Inbound to Amazon + FBA Pieces. This is the denominator for DOC calculations." },
  { term: "Critical", desc: "DOC ≤ Lead Time. You will run out before your next order can possibly arrive. Needs immediate action — order today." },
  { term: "Warning", desc: "DOC ≤ Lead Time + Buffer Days. You won't run out before the next order, but you have no margin if anything goes wrong (vendor delay, demand spike). Monitor closely, plan to order soon." },
  { term: "Healthy", desc: "DOC > Lead Time + Buffer. Sufficient inventory. No urgent action needed." },
  { term: "Lead Time (LT)", desc: "Days from placing an order to having usable stock. For domestic vendors, typically 14-30 days; for international (China), 90-180 days. Used as-is from vendor.lt — the value already includes processing time after arrival." },
  { term: "Target DOC", desc: "How many days of coverage we want to maintain. Domestic vendors: 90 days default. International: 180 days default. Configurable in Settings." },
  { term: "Replen Floor DOC", desc: "Minimum days of coverage we never want to fall below. Default 80. The waterfall fills bundles to this floor first (urgency phase) before equalizing to target." },

  // ─── BLOCK 2: FORECAST ENGINE (CONTINUOUS) ───────────────────
  { term: "—— FORECAST ENGINE ——", desc: "" },
  { term: "Forecast Level (Holt level)", desc: "Smoothed baseline DSR estimated by Holt's method. Replaces raw DSR for forecast calculations because it's more stable than 7-day or 30-day averages — it reacts to changes but doesn't overreact to single-day spikes." },
  { term: "Trend (Holt trend)", desc: "Estimated change in DSR per day. Positive = demand rising. Capped to ±2% of level per day to prevent runaway extrapolation. If demand was 10/day yesterday and trend is +0.05, the model expects ~10.05 today." },
  { term: "Trend damping (φ phi)", desc: "Trend slowly fades over the forecast horizon (φ=0.88). A trend of +0.05/day doesn't mean +18 units after a year — it means about +2-3 units, because we don't trust trends to continue indefinitely." },
  { term: "Hampel filter", desc: "Outlier detection using rolling median + MAD (median absolute deviation). Single-day spikes (3× more than neighbors) get replaced with the local median, so a Black Friday day doesn't permanently inflate the forecast." },
  { term: "σ_LT (sigma LT)", desc: "Standard deviation of demand during lead time. Measures how much actual sales bounced around in the past during a window equal to your lead time. Higher σ_LT → more volatile → more safety stock needed." },
  { term: "Z (service-level multiplier)", desc: "How many standard deviations of buffer you want. 95% service = Z=1.65, 97% = Z=1.88, 99% = Z=2.33. Higher Z = more cushion = less stockout risk = more cash tied up. ABC class A items use higher Z than C." },
  { term: "Safety Stock", desc: "Z × σ_LT. Statistical buffer added on top of forecasted demand. Grows automatically when demand is volatile, shrinks when it's stable. NOT a fixed % markup — it's based on actual variability." },
  { term: "Tracking Signal", desc: "Sum of forecast errors ÷ MAD over the last 14 days. |TS| > 4 means the forecast is biased — actual demand is consistently above or below forecast. When triggered, trend gets gated to zero (we stop extrapolating) until the bias clears." },
  { term: "Recent regime shift (fast)", desc: "Triggers if the last 30 days average less than 75% of Holt level. Replaces the level with the recent average and zeros out trend. Catches sudden drops (product getting unlisted, competitor entry, market shift)." },
  { term: "Slow regime shift", desc: "Triggers if last 90 days average more than 15% below the prior 90 days. Same effect as fast regime: replace level with recent, trend = 0. Catches gradual decline that fast regime misses." },
  { term: "YoY sanity cap", desc: "If forecast > 1.5× same period last year, cap it. Prevents the engine from projecting wild growth that wasn't seen historically. Only applies when prior-year history exists." },

  // ─── BLOCK 3: DEMAND REGIME ─────────────────────
  { term: "—— DEMAND REGIME ——", desc: "" },
  { term: "Regime: continuous", desc: "Bundle that sells almost every day. Forecast uses Holt + seasonal (the engine described above). Most bundles fall here. No special badge in the UI." },
  { term: "Regime: intermittent", desc: "Bundle that sells sporadically — more than 50% of days have ZERO sales. If you sold 4 units in 30 days, the real rate is 0.13/day, NOT 4/day. Holt would overestimate because it filters out zero days. The intermittent path uses (total units ÷ total days) including zeros, so a single sales day doesn't inflate the recommendation. Marked with a sky-blue ~ badge." },
  { term: "Regime: new_or_sparse", desc: "Bundle with less than 30 days of history. Impossible to forecast reliably. Falls back to the sheet DSR with a conservative cap (max 1 unit/day). Always review manually before purchasing. Marked with a violet N badge." },
  { term: "Zero-day ratio", desc: "% of the last 365 days with no sales. If above 50%, the bundle is classified as intermittent. This is the trigger that switches calculation method — visible in the regime badge tooltip." },
  { term: "Rate per day (intermittent)", desc: "For intermittent bundles: total units sold ÷ total days in window (zeros included). Different from the sheet DSR, which filters out zero-sale days and therefore overstates real demand for sporadic items." },
  { term: "Avg when selling (intermittent)", desc: "For intermittent bundles: average units sold ONLY on days with sales. Used as a heuristic safety stock (1 average sale of cushion). If you typically sell 4 at a time, carry 4 extra." },

  // ─── BLOCK 4: EFFECTIVE DSR & DEMAND ─────────────────────────
  { term: "—— EFFECTIVE DSR ——", desc: "" },
  { term: "effDSR (Effective DSR)", desc: "The single rate of decision used everywhere in the v3 engine. Defined as: coverageDemand ÷ targetDoc. Guarantees consistency across the waterfall, the DOC calculation, and the buy decision. If buyNeed > 0 ⟺ DOC < targetDoc, no exceptions. For continuous bundles, effDSR ≈ Holt level adjusted by seasonal/safety. For intermittent, effDSR = real rate." },
  { term: "coverageDemand", desc: "Total demand projected over the targetDoc horizon. Includes Holt level + trend + seasonal adjustment + safety stock for continuous bundles. For intermittent: rate × targetDoc. This is the goal post — the inventory level we want to reach." },
  { term: "ltDemand (lead-time demand)", desc: "Forecast level × lead time. The amount we expect to sell during the time it takes a new order to arrive. Used to flag URGENT bundles where current available inventory < ltDemand (would stock out before next PO arrives)." },
  { term: "buyNeed", desc: "Final purchase need per bundle: max(0, coverageDemand − totalAvailable). If totalAvailable already covers coverageDemand, buyNeed is zero — no purchase needed. Otherwise, buyNeed fills the gap exactly." },

  // ─── BLOCK 5: WATERFALL ALLOCATION ────────────────────────────
  { term: "—— WATERFALL ——", desc: "" },
  { term: "Waterfall (raw allocation)", desc: "Algorithm that distributes a core's raw inventory among the bundles that use it. Bundles are SOURCE OF TRUTH — cores are aggregated from bundle needs. The waterfall happens BEFORE buy needs are calculated, ensuring raw on-hand gets credited correctly." },
  { term: "Waterfall Phase A (urgency)", desc: "Fills bundles up to the replenFloorDOC (default 80 days). Most urgent bundles (lowest current DOC) get raw first. Prevents stockouts before equalization." },
  { term: "Waterfall Phase B (leveling)", desc: "After urgency is satisfied, bundles get topped up in 10-day increments toward targetDOC. Bundles with the lowest current coverage get filled first at each increment, so no single bundle gets overstocked while others remain under." },
  { term: "Assigned inventory", desc: "Inventory that's already committed to a specific bundle and CANNOT be reallocated by the waterfall. Includes: FIB Inventory, Pre-processed (PPRC), JFN, Batched Raw, Batched PPRC, and Inbound 7f marked as bundle. The waterfall only touches raw core stock and pending core inbound." },
  { term: "Total available", desc: "Sum of assignedInv + rawAssignedFromWaterfall. The bundle's total stock position after the waterfall has run. Used to compute current DOC and buyNeed." },

  // ─── BLOCK 6: BUY MODE ────────────────────────────────────────
  { term: "—— BUY MODE ——", desc: "" },
  { term: "Buy mode: core", desc: "Bundle's need will be purchased as raw core material from the vendor, then assembled in-house. Default when the vendor has never delivered this bundle pre-assembled (per 7f history)." },
  { term: "Buy mode: bundle", desc: "Bundle's need will be purchased as finished units directly from the vendor (drop-in, no assembly required). Triggered when 7f history shows the vendor previously delivered this bundle finished." },
  { term: "Mix (auto)", desc: "Default vendor view. Each bundle uses its own buy mode (bundle or core) based on 7f history. The system decides per-bundle." },
  { term: "Force Cores", desc: "Override: every bundle is bought as raw core material, regardless of 7f history. Use when the vendor temporarily can't or won't assemble. Quantities should match Mix exactly — only the FORM changes, not the numbers." },
  { term: "Force Bundles", desc: "Override: every bundle is bought as finished units, regardless of 7f history. Use when you want to skip in-house assembly. Quantities should match Mix exactly." },
  { term: "Mix vs Force consistency", desc: "Mix, Force Cores, and Force Bundles MUST produce the same total unit need — only the buy mode (form) changes. If you see different unit totals between modes, that's a bug. Costs may differ legitimately if assembled-bundle pricing differs from sum-of-components pricing." },
  { term: "MOQ credit cross-mode", desc: "If a bundle is purchased in 'bundle' mode, the cores it would have used get credit toward their own MOQ. Prevents the vendor's core MOQ from being inflated by needs that are already being purchased as finished bundles." },

  // ─── BLOCK 7: MOQ HANDLING ────────────────────────────────────
  { term: "—— MOQ ——", desc: "" },
  { term: "Vendor MOQ ($)", desc: "Minimum dollar value the vendor requires per order. Below this, they refuse the order or charge premium. The PO badge shows ✓ when met, ! when below." },
  { term: "Core MOQ (units)", desc: "Per-core minimum unit quantity from the vendor. If real need is below MOQ, the recommender forces qty up to MOQ. Casepack rounding applied on top." },
  { term: "Bundle MOQ (override)", desc: "Per-bundle minimum unit quantity for bundles bought in bundle mode. Set in the BdlMOQ field per vendor. If need < MOQ, the engine decides: buy MOQ if urgent, buy MOQ if extra is ≤30 days, otherwise flag as 'excess' for manual review." },
  { term: "MOQ inflated", desc: "When the vendor's MOQ forces buying more than 1.5× the real need (configurable threshold). Triggers the orange $ badge. The Need column shows '450→1000' meaning real need 450, MOQ-forced 1000. Excess is shown in pcs and dollars." },
  { term: "MOQ inflation ratio", desc: "finalQty ÷ realNeed. If 1.0, no inflation. If 2.0, you're buying twice what you need. Threshold of 1.5 (configurable) triggers the inflated flag." },
  { term: "Excess from MOQ", desc: "finalQty − realNeed. The number of pieces you'd buy beyond the actual need solely because of MOQ. Multiplied by unit cost gives the dollar excess — shown in tooltip and at the vendor header." },
  { term: "Bundle MOQ status: meets_moq", desc: "Bundle's natural need is already at or above the bundle MOQ. No special action — just buy the need." },
  { term: "Bundle MOQ status: inflated_urgent", desc: "Need is below MOQ but the bundle is urgent (would stock out during lead time). Buying MOQ anyway to avoid stockout. Red ⚠ badge." },
  { term: "Bundle MOQ status: inflated_ok", desc: "Need is below MOQ and not urgent, but the extra DOC from buying MOQ is ≤30 days (acceptable overhead). Orange $ badge — go ahead." },
  { term: "Bundle MOQ status: inflated_excess", desc: "Need is below MOQ, not urgent, AND extra DOC from buying MOQ exceeds 30 days. Red ⚠ MOQ excess badge — review before ordering, may want to wait for accumulated demand." },

  // ─── BLOCK 8: FLAGS & BADGES ──────────────────────────────────
  { term: "—— FLAGS & BADGES ——", desc: "" },
  { term: "Flag: OOS (⚠)", desc: "Stockout risk — at least one bundle using this core would run out BEFORE the next PO arrives. Must be in the next order. Red badge." },
  { term: "Flag: INV (≠)", desc: "Inventory mismatch — sheet DOC and recalculated DOC (allIn ÷ DSR) differ by more than 20%. Numbers don't reconcile. Recheck stock manually. Amber badge." },
  { term: "Flag: MOQ ($)", desc: "MOQ inflated — see MOQ section. Orange badge." },
  { term: "Flag: INTERMIT (~)", desc: "Bundle classified as intermittent demand. Tooltip shows the zero-day ratio and the real rate per day. Sky-blue badge." },
  { term: "Flag: NEW (N)", desc: "Bundle has less than 30 days of history. Forecast capped at 1 unit/day. Review manually. Violet badge." },
  { term: "(Nb) suffix", desc: "Number of bundles driving this core's need. E.g. '(3b)' means 3 bundles use this core and contribute to its purchase need. Click 📊 to see the breakdown by bundle." },
  { term: "Spike (⚡)", desc: "7-day DSR is at least 1.25× the composite DSR. VISUAL ONLY — does not affect calculations. Threshold configurable in Settings." },

  // ─── BLOCK 9: ANOMALY DETECTION ───────────────────────────────
  { term: "—— ANOMALY DETECTION ——", desc: "" },
  { term: "Inventory anomaly", desc: "When a core's raw on-hand exceeds anomalyMultiplier × historic average (default 3×) within the lookback window (default 7 days), the engine treats the recent inflow as 'pending verification' rather than usable stock. Prevents buying decisions based on counts that haven't been confirmed." },
  { term: "Core already covered", desc: "Sanity check after waterfall: if a core's standalone DOC (raw + pp + inb + fba ÷ DSR) exceeds 1.2× targetDoc, its bundle-driven need is zeroed out. Prevents over-buying when the core is independently overstocked." },

  // ─── BLOCK 10: PRICING & VENDOR ──────────────────────────────
  { term: "—— PRICING ——", desc: "" },
  { term: "Price source: 7g-history", desc: "Unit cost taken from the most recent purchase history (7g sheet) for this vendor + core combination. Includes material price only (not inbound shipping or tariffs)." },
  { term: "Price source: sheet-cost", desc: "Unit cost taken from the cores sheet (the static 'cost' column). Used when no 7g history exists for this vendor + core combination." },
  { term: "Price source: partial-history", desc: "For bundles in bundle mode: some component cores have 7g history, others don't. Mixed sources — review CPP carefully." },
  { term: "CPP (Cost Per Piece)", desc: "Total landed cost ÷ pieces, including material + inbound shipping + tariffs. Shown in the History panel. Differs from sheet cost (material only) — CPP is the real economic cost." },
  { term: "CPP benchmark", desc: "Comparison of current vendor's CPP vs an alternate source (China container price or named domestic vendor). Shown as ±% under the cost column. Negative % = current vendor is cheaper. Calculated from total-cost CPP, not just material." },

  // ─── BLOCK 11: BRIDGE TAB (NEW) ───────────────────────────────
  { term: "—— BRIDGE TAB ——", desc: "" },
  { term: "Bridge Cover (Classic)", desc: "USA bridge buy that covers the gap between current non-inbound stock and when the next China shipment goes FBA-live (China ETA + pipeline_days). Triggered when non-inbound DOC < China ETA + pipeline." },
  { term: "Pipeline Days", desc: "Setting for the Bridge Tab. Days from when a China shipment arrives at the warehouse to when it's actually sellable on Amazon (processing + shipping to FBA). Default 25." },
  { term: "Bridge flag: VIABLE 🟢", desc: "USA vendor exists with prior history of this core, and the vendor's lead time fits within the most-urgent bundle's current DOC. Order USA now." },
  { term: "Bridge flag: NO_USA_HISTORY 🔴", desc: "No USA vendor has ever delivered this core. Bridge is structurally not available. Mitigation: raise Amazon price to throttle demand until China lands." },
  { term: "Bridge flag: BRIDGE_TOO_LATE 🔴", desc: "USA vendor exists but lead time exceeds the most-urgent bundle's current DOC. Even if you order now, USA won't arrive in time. Mitigation: raise Amazon price." },
  { term: "Bridge: throttle target", desc: "When bridge is infeasible, the throttle target is the DSR you'd need to slow down to in order to survive until China is FBA-live. Computed as non_inbound_pieces / days_until_china_live." },
  { term: "Bridge: bundle group / INCOMPLETE_BRIDGE", desc: "When a bundle requires multiple cores and at least one has NO_USA_HISTORY or BRIDGE_TOO_LATE, the bundle's bridge is structurally incomplete — buying only the available cores will not prevent stockout. Visible as a red meta-flag in the bundle group expansion." },

  // ─── BLOCK 12: SETTINGS (TUNABLE) ─────────────────────────────
  { term: "—— TUNABLE SETTINGS ——", desc: "" },
  { term: "spikeThreshold", desc: "Multiplier for the spike (⚡) flag. Default 1.25. If 7d DSR ≥ this × composite DSR, mark as spike. Visual only." },
  { term: "moqInflationThreshold", desc: "Ratio above which MOQ is considered inflated. Default 1.5 (i.e., buying 1.5× real need). Triggers the orange $ badge." },
  { term: "moqExtraDocThreshold", desc: "For bundle MOQ override — max acceptable extra days of coverage when forced to buy MOQ. Default 30. Above this, flag as 'inflated_excess' for review." },
  { term: "domesticDoc / intlDoc", desc: "Default target DOC per vendor type. 90 days for domestic (US), 180 for international (China). Vendor-specific override possible via vendor record." },
  { term: "replenFloorDoc", desc: "Minimum DOC the waterfall fills to before equalizing. Default 80. Bundles below this floor get raw inventory urgency-first." },
  { term: "holtAlpha / holtBeta", desc: "Smoothing parameters for Holt's method. Alpha (default 0.2) controls how much weight new observations get for the level. Beta (default 0.1) controls trend smoothing. Lower = smoother but slower to react." },
  { term: "hampelWindow / hampelThreshold", desc: "Outlier detection: window=7 days on each side, threshold=3× MAD. A point is replaced if its deviation from local median exceeds threshold × MAD." },
  { term: "serviceLevelA / serviceLevelOther", desc: "Target service level per ABC class. A items default 97% (Z=1.88), others 95% (Z=1.65). Higher = more safety stock." },
  { term: "inventoryAnomalyMultiplier / anomalyLookbackDays", desc: "Anomaly detection: if raw on-hand > N× recent avg within M days, treat excess as pending. Defaults: 3×, 7 days." },
  { term: "pipeline_days", desc: "Bridge Tab setting. Days from China warehouse arrival to FBA-live. Default 25. Used only in BridgeTab, does not affect v3 recommender." },

  // ─── BLOCK 13: TROUBLESHOOTING ────────────────────────────────
  { term: "—— TROUBLESHOOTING ——", desc: "" },
  { term: "Why did the recommendation change a lot vs yesterday?", desc: "Click the '+X% vs MM-DD' badge at the vendor header for the breakdown by contributor (level change, trend change, inventory change, safety stock change, new bundle). Snapshots are saved once per day per vendor in browser localStorage, last 14 days. Big changes from 0.0 → something usually mean the snapshot was saved before data finished loading — NOT a real demand change." },
  { term: "Why does Force Cores give different $ than Mix?", desc: "Total UNITS should match. Total $ may legitimately differ if assembled-bundle pricing ≠ sum of component pricing. If unit totals don't match, that's a bug — file it." },
  { term: "Why is buyNeed 0 even when DOC < target?", desc: "Either (1) the waterfall already filled coverage from raw on-hand, or (2) the core sanity check zeroed it (core has independent DOC > 1.2× target). Open Calc Breakdown 📊 to verify." },
  { term: "Why is the forecast much higher than my gut?", desc: "Check the regime badge. If continuous, look at fromTrend in demandBreakdown — runaway trend gets capped but can still be aggressive. If no badge, but recently shifted, check 'recentRegimeApplied' in flags — you may want to manually override." },
  { term: "Bridge tab shows no recommendations?", desc: "Either no bundles have a gap (China shipments cover demand), or the bridge data isn't being detected. Check that bundles have China inbound info (inboundPieces + daysBeforeArrival) — the tab only analyzes bundles with active China shipments. Preventive bridge candidates appear in the 'Other actions' section below." },
];

function GlossTab() {
  const [gl, setGl] = useState(() => { try { const s = localStorage.getItem('fba_glossary'); if (s) return JSON.parse(s) } catch { } return DEFAULT_GL });
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [nT, setNT] = useState(""); const [nD, setND] = useState("");
  const save = (arr) => { setGl(arr); try { localStorage.setItem('fba_glossary', JSON.stringify(arr)) } catch { } };
  const add = () => { if (nT.trim()) { save([...gl, { term: nT.trim(), desc: nD.trim() }]); setNT(""); setND("") } };
  const del = i => save(gl.filter((_, j) => j !== i));
  const upd = (i, field, val) => { const n = [...gl]; n[i] = { ...n[i], [field]: val }; save(n) };
  const reset = () => { if (confirm('Reset glossary to defaults? Your custom entries will be lost.')) save(DEFAULT_GL); };

  const filtered = useMemo(() => {
    if (!search.trim()) return gl.map((g, i) => ({ ...g, _idx: i }));
    const q = search.toLowerCase();
    return gl
      .map((g, i) => ({ ...g, _idx: i }))
      .filter(g => g.desc === "" || g.term.toLowerCase().includes(q) || g.desc.toLowerCase().includes(q));
  }, [gl, search]);

  return <div className="p-4 max-w-4xl mx-auto">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold text-white">Glossary</h2>
      <div className="flex items-center gap-3">
        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 w-48" />
        <button onClick={reset} className="text-xs text-gray-500 hover:text-white">Reset to defaults</button>
      </div>
    </div>
    <p className="text-xs text-gray-500 mb-3">Concepts and terms used across the dashboard. Hover any term in the app for a quick tooltip; come here for the full explanation. Click ✎ to edit, ✕ to remove. Add custom entries at the bottom.</p>
    {filtered.map((g) => {
      const i = g._idx;
      if (g.desc === "") {
        return <div key={i} className="mt-5 mb-1 px-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-800 pb-1">
          <span className="flex-1">{g.term.replace(/^—— /, '').replace(/ ——$/, '')}</span>
        </div>;
      }
      return <div key={i} className={`flex gap-4 py-2.5 px-4 rounded-lg ${i % 2 === 0 ? "bg-gray-900/50" : ""}`}>
        {editing === i ? (
          <>
            <input value={g.term} onChange={e => upd(i, 'term', e.target.value)} className="bg-gray-800 text-blue-400 font-mono text-sm rounded px-2 py-1 w-40" />
            <textarea value={g.desc} onChange={e => upd(i, 'desc', e.target.value)} rows={3} className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 flex-1" />
            <button onClick={() => setEditing(null)} className="text-emerald-400 text-xs self-start">✓</button>
          </>
        ) : (
          <>
            <span className="text-blue-400 font-mono font-semibold text-sm min-w-[160px] flex-shrink-0">{g.term}</span>
            <span className="text-gray-300 text-sm flex-1 leading-relaxed">{g.desc}</span>
            <button onClick={() => setEditing(i)} className="text-gray-500 hover:text-white text-xs flex-shrink-0">✎</button>
            <button onClick={() => del(i)} className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0">✕</button>
          </>
        )}
      </div>;
    })}
    {filtered.length === 0 && <p className="text-gray-500 text-sm py-8 text-center">No matches for "{search}"</p>}
    <div className="flex gap-2 mt-6 pt-4 border-t border-gray-800">
      <input value={nT} onChange={e => setNT(e.target.value)} placeholder="New term" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 w-40" />
      <input value={nD} onChange={e => setND(e.target.value)} placeholder="Description" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 flex-1" />
      <button onClick={add} className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded">Add</button>
    </div>
  </div>;
}

const TABS = [
  { id: "dashboard", l: "Dashboard" },
  { id: "purchasing", l: "Purchasing" },
  { id: "bridge", l: "Bridge" },
  { id: "core", l: "Core Detail" },
  { id: "bundle", l: "Bundle Detail" },
  { id: "segments", l: "Segments" },
  { id: "orders", l: "Orders" },
  { id: "vendors", l: "Vendors" },
  { id: "performance", l: "Performance" },
  { id: "glossary", l: "Glossary" }
];

const EMPTY_DATA = {
  cores: [], bundles: [], vendors: [], sales: [], fees: [], inbound: [],
  abcA: [], abcT: [], abcSub: '', restock: [], priceComp: [], agedInv: [],
  killMgmt: [], workflow: [], receiving: [], replenRec: [], receivingFull: [],
  vendorComments: [], priceCompFull: [], coreInv: [], bundleInv: [],
  bundleSales: [], priceHist: [], coreDays: [], bundleDays: [], coreDaysForecast: [], bundleDaysForecast: []
};

const DEFAULT_SETTINGS = {
  buyer: '',
  domesticDoc: 90,
  intlDoc: 180,
  replenFloorDoc: 80,
  spikeThreshold: 1.25,
  moqInflationThreshold: 1.5,
  moqExtraDocThreshold: 30,
  fA: "yes", fI: "blank", fV: "yes",
  holtAlpha: 0.2,
  holtBeta: 0.1,
  hampelWindow: 7,
  hampelThreshold: 3,
  serviceLevelA: 97,
  serviceLevelOther: 95,
  inventoryAnomalyMultiplier: 3,
  anomalyLookbackDays: 7,
  baseWindowDays: 60,
  pipeline_days: 25,
};

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initCore = urlParams.get('core');
  const initBundle = urlParams.get('bundle');
  const initVendorParam = urlParams.get('vendor');
  const initTab = urlParams.get('tab');

  const [, startTransition] = useTransition();

  const [tab, setTab] = useState(initCore ? "core" : initBundle ? "bundle" : initVendorParam ? "purchasing" : initTab || "dashboard");
  const [showS, setShowS] = useState(false);
  const [stg, setStg] = useState(() => {
    try {
      const saved = localStorage.getItem('fba_stg_v1');
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try { localStorage.setItem('fba_stg_v1', JSON.stringify(stg)); } catch {}
  }, [stg]);

  const [coreId, setCoreId] = useState(initCore || null);
  const [bundleId, setBundleId] = useState(initBundle || null);

  const [data, setData] = useState(EMPTY_DATA);

  const [liveStatus, setLiveStatus] = useState({ loading: true, error: null, version: null });
  const [historyStatus, setHistoryStatus] = useState({ loading: true, error: null, version: null, fromCache: false });
  const [historyProgress, setHistoryProgress] = useState({ done: 0, total: 0 });
  const [refreshingHistory, setRefreshingHistory] = useState(false);

  const [ov, setOv] = useState({});
  const [initV, setInitV] = useState(initVendorParam || null);
  const [prevTab, setPrevTab] = useState(null);
  const [panelCoreId, setPanelCoreId] = useState(null);
  const [panelBundleId, setPanelBundleId] = useState(null);
  const [sumCells, setSumCells] = useState([]);
  const addCell = useCallback((v, remove) => { if (remove) setSumCells(p => p.filter(x => x !== v)); else setSumCells(p => [...p, v]) }, []);
  const clearSum = useCallback(() => setSumCells([]), []);

  const scrollPositions = useRef({});
  const savedScrollBeforePanel = useRef(null);

  const openPanelCore = useCallback((id) => {
    savedScrollBeforePanel.current = window.scrollY;
    setPanelCoreId(id);
    setPanelBundleId(null);
    clearSum();
  }, [clearSum]);

  const openPanelBundle = useCallback((id) => {
    if (savedScrollBeforePanel.current === null) {
      savedScrollBeforePanel.current = window.scrollY;
    }
    setPanelBundleId(id);
    clearSum();
  }, [clearSum]);

  const closePanel = useCallback(() => {
    setPanelCoreId(null);
    setPanelBundleId(null);
    clearSum();
    const target = savedScrollBeforePanel.current;
    savedScrollBeforePanel.current = null;
    if (target !== null && target !== undefined) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: target, behavior: 'instant' });
      });
    }
  }, [clearSum]);

  const changeTab = useCallback((newTab) => {
    scrollPositions.current[tab] = window.scrollY;
    startTransition(() => {
      setPrevTab(tab);
      setTab(newTab);
      if (newTab !== "core") setCoreId(null);
      if (newTab !== "bundle") setBundleId(null);
      clearSum();
    });
    requestAnimationFrame(() => {
      const saved = scrollPositions.current[newTab] || 0;
      window.scrollTo({ top: saved, behavior: 'instant' });
    });
  }, [tab, clearSum]);

  const loadLive = useCallback(async ({ forceRefresh = false } = {}) => {
    setLiveStatus({ loading: true, error: null, version: null });
    try {
      const live = await fetchLive(null, { forceRefresh });
      setData(prev => ({
        ...prev,
        cores: live.cores || [],
        bundles: live.bundles || [],
        vendors: live.vendors || [],
        sales: live.sales || [],
        fees: live.fees || [],
        inbound: live.inbound || [],
        abcA: live.abcA || [],
        abcT: live.abcT || [],
        abcSub: live.abcSub || '',
        restock: live.restock || [],
        priceComp: live.priceComp || [],
        agedInv: live.agedInv || [],
        killMgmt: live.killMgmt || [],
        workflow: live.workflow || [],
        receiving: live.receiving || [],
        replenRec: live.replenRec || [],
        vendorComments: live.vendorComments || [],
        coreDays: live.coreDays || [],
        bundleDays: live.bundleDays || []
      }));
      setLiveStatus({ loading: false, error: null, version: live.version || null, partial: live.partial || false });
    } catch (e) {
      console.error('Live load failed:', e);
      setLiveStatus({ loading: false, error: e.message, version: null });
    }
  }, []);

  const loadHistory = useCallback(async ({ forceRefresh = false } = {}) => {
    setHistoryStatus(prev => ({ ...prev, loading: true, error: null }));
    setHistoryProgress({ done: 0, total: 0 });
    try {
      const history = await fetchHistory({
        forceRefresh,
        onProgress: (done, total) => setHistoryProgress({ done, total }),
      });
      setData(prev => ({
        ...prev,
        receivingFull: history.receivingFull || [],
        priceCompFull: history.priceCompFull || [],
        bundleSales: history.bundleSales || [],
        priceHist: history.priceHist || [],
        coreInv: history.coreInv || [],
        bundleInv: history.bundleInv || [],
        coreDaysForecast: history.coreDaysForecast || [],
        bundleDaysForecast: history.bundleDaysForecast || []
      }));
      setHistoryStatus({
        loading: false,
        error: null,
        version: history.version || null,
        fromCache: !!history._cachedAt && !forceRefresh
      });
    } catch (e) {
      console.error('History load failed:', e);
      setHistoryStatus({ loading: false, error: e.message, version: null, fromCache: false });
    }
  }, []);

  const forceServerHistoryRefresh = useCallback(async () => {
    if (refreshingHistory) return;
    setRefreshingHistory(true);
    try {
      await refreshHistoryOnServer();
      await loadHistory({ forceRefresh: true });
    } catch (e) {
      alert('History server refresh failed: ' + e.message);
    } finally {
      setRefreshingHistory(false);
    }
  }, [refreshingHistory, loadHistory]);

  useEffect(() => {
    loadLive();
    loadHistory();
  }, [loadLive, loadHistory]);

  const dataH = useMemo(() => ({
    ...data,
    _coreInv: data.coreInv,
    _coreDays: data.coreDays,
    _bundleSales: data.bundleSales
  }), [data]);

  const activeBundleCores = useMemo(() => {
    const set = new Set();
    const activeBundleJLS = new Set();
    const bI = stg.bI || "blank";
    (data.bundles || []).filter(b => {
      if (b.active !== "Yes") return false;
      if (bI === "blank" && !!b.ignoreUntil) return false;
      if (bI === "set" && !b.ignoreUntil) return false;
      return true;
    }).forEach(b => {
      if (b.core1) set.add(b.core1);
      if (b.core2) set.add(b.core2);
      if (b.core3) set.add(b.core3);
      activeBundleJLS.add(b.j.trim().toLowerCase());
    });
    (data.cores || []).forEach(c => {
      if (set.has(c.id)) return;
      const raw = (c.jlsList || "").split(/[,;\n\r]+/).map(j => j.trim().toLowerCase()).filter(Boolean);
      if (raw.some(j => activeBundleJLS.has(j))) set.add(c.id);
    });
    return set;
  }, [data.bundles, data.cores, stg]);

  const replenMap = useMemo(() => {
    const m = {};
    (data.replenRec || []).forEach(r => { m[r.j] = r });
    return m;
  }, [data.replenRec]);

  const missingMap = useMemo(() => {
    const m = {};
    (data.receiving || []).forEach(r => {
      if (r.piecesMissing > 0) {
        const k = (r.core || "").trim();
        m[k] = (m[k] || 0) + r.piecesMissing;
      }
    });
    return m;
  }, [data.receiving]);

  const purchFreqMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => { m[v.name] = calcPurchaseFrequency(v.name, data.receivingFull || []) });
    return m;
  }, [data.vendors, data.receivingFull]);

  const seasonalProfiles = useMemo(() => {
    if (!data.bundles?.length) return {};
    const t0 = performance.now();
    const cache = {};
    for (const b of data.bundles) {
      if (!b || !b.j || cache[b.j]) continue;
      try { cache[b.j] = calcBundleSeasonalProfile(b.j, data.bundleSales || []); }
      catch { cache[b.j] = DEFAULT_PROFILE; }
    }
    const t1 = performance.now();
    if (DEV) console.log(`[PERF] seasonalProfiles took ${(t1-t0).toFixed(0)}ms for ${Object.keys(cache).length} bundles`);
    return cache;
  }, [data.bundles, data.bundleSales]);

  // ── Segment classification (auto) ──
  // Re-run when bundles or daily series change. Read-only in PR 2:
  // the recommender does NOT consume segments yet (PR 4 wires that).
  const autoSegmentMap = useMemo(() => {
    if (!data.bundles?.length) return {};
    const t0 = performance.now();
    const out = batchClassifySegments({
      bundles: data.bundles,
      bundleDays: data.bundleDaysForecast || data.bundleDays || [],
      bundleSales: data.bundleSales || [],
    });
    const t1 = performance.now();
    if (DEV) {
      const counts = {};
      for (const r of Object.values(out)) counts[r.segment] = (counts[r.segment] || 0) + 1;
      console.log(`[PERF] segments classified in ${(t1-t0).toFixed(0)}ms`, counts);
    }
    return out;
  }, [data.bundles, data.bundleDaysForecast, data.bundleDays, data.bundleSales]);

  const [overrides, setOverrides] = useState(() => {
    try { return loadOverrides(); } catch { return {}; }
  });
  const refreshOverrides = useCallback(() => {
    try { setOverrides(loadOverrides()); } catch {}
  }, []);
  const segmentSetOverride = useCallback((bundleId, segment) => {
    if (!bundleId) return;
    setSegmentOverridePersist(bundleId, segment);
    setOverrides(loadOverrides());
  }, []);

  const effectiveSegmentMap = useMemo(
    () => buildEffectiveMap(autoSegmentMap, overrides),
    [autoSegmentMap, overrides]
  );

  const segmentCtxValue = useMemo(() => ({
    autoMap: autoSegmentMap,
    overrides,
    effectiveMap: effectiveSegmentMap,
    setOverride: segmentSetOverride,
    refreshOverrides,
  }), [autoSegmentMap, overrides, effectiveSegmentMap, segmentSetOverride, refreshOverrides]);

  const dataIndexes = useMemo(() => {
    const t0 = performance.now();
    const ix = buildAllIndexes({
      priceCompFull: data.priceCompFull,
      priceComp: data.priceComp,
      receivingFull: data.receivingFull,
      bundleDays: data.bundleDaysForecast,
    });
    const t1 = performance.now();
    if (DEV) console.log(`[PERF] dataIndexes built in ${(t1-t0).toFixed(0)}ms (${ix.price.countIndexed} priced rows over ${ix.price.pricesByCoreLower.size} cores)`);
    return ix;
  }, [data.priceCompFull, data.priceComp, data.receivingFull, data.bundleDaysForecast]);

  const segmentMapForEngine = useMemo(() => {
    const m = {};
    for (const [bid, rec] of Object.entries(effectiveSegmentMap)) {
      m[bid] = rec.effective;
    }
    return m;
  }, [effectiveSegmentMap]);

  const vendorRecs = useMemo(() => {
    if (!data.vendors?.length) return {};
    const t0 = performance.now();
    const result = batchVendorRecommendationsV4({
      vendors: data.vendors,
      cores: data.cores || [],
      bundles: data.bundles || [],
      bundleSales: data.bundleSales || [],
      bundleDays: data.bundleDaysForecast || [],
      coreDays: data.coreDaysForecast || [],
      abcA: data.abcA || [],
      receivingFull: data.receivingFull || [],
      replenMap,
      missingMap,
      priceCompFull: (data.priceCompFull?.length ? data.priceCompFull : data.priceComp) || [],
      priceIndex: dataIndexes.price,
      segmentMap: segmentMapForEngine,
      settings: stg,
    });
    const t1 = performance.now();
    if (DEV) console.log(`[PERF] vendorRecs (v4) took ${(t1-t0).toFixed(0)}ms for ${Object.keys(result).length} vendors`);
    return result;
  }, [data.vendors, data.cores, data.bundles, data.bundleSales, data.bundleDaysForecast, data.coreDaysForecast, data.abcA, data.receivingFull, replenMap, missingMap, data.priceCompFull, data.priceComp, dataIndexes, segmentMapForEngine, stg]);


  const sc = useMemo(() => {
    const c = { critical: 0, warning: 0, healthy: 0 };
    (data.cores || []).forEach(x => {
      if (stg.fA === "yes" && x.active !== "Yes") return;
      if (stg.fA === "no" && x.active === "Yes") return;
      if (stg.fV === "yes" && x.visible !== "Yes") return;
      if (stg.fV === "no" && x.visible === "Yes") return;
      if (stg.fI === "blank" && !!x.ignoreUntil) return;
      if (stg.fI === "set" && !x.ignoreUntil) return;
      const v = (data.vendors || []).find(v => v.name === x.ven); c[gS(x.doc, v?.lt || 30, x.buf || 14, stg)]++
    });
    return c;
  }, [data, stg]);

  const goCore = useCallback(id => {
    if (tab === "purchasing") { openPanelCore(id); }
    else { setPrevTab(tab); setCoreId(id); setTab("core"); clearSum(); }
  }, [tab, openPanelCore, clearSum]);

  const goBundle = useCallback(id => {
    if (tab === "purchasing" || panelCoreId) { openPanelBundle(id); }
    else { setPrevTab(tab); setBundleId(id); setTab("bundle"); clearSum(); }
  }, [tab, panelCoreId, openPanelBundle, clearSum]);

  const goVendor = useCallback(n => { window.open(window.location.pathname + '?vendor=' + encodeURIComponent(n), '_blank') }, []);
  const clearIV = useCallback(() => setInitV(null), []);
  const handleBackFromCore = useCallback(() => setTab("purchasing"), []);
  const handleBackFromBundle = useCallback(() => { if (prevTab === "core" && coreId) setTab("core"); else setTab("purchasing") }, [prevTab, coreId]);

  const saveWorkflow = useCallback(async (note) => {
    try {
      await apiPost({ action: 'saveNote', ...note });
      setData(prev => { const wf = [...(prev.workflow || [])]; const idx = wf.findIndex(w => w.id === note.id); const entry = { id: note.id, type: note.type, status: note.status, note: note.note, ignoreUntil: note.ignoreUntil, lastOrder: note.lastOrder || '', updatedBy: note.updatedBy, updatedAt: new Date().toISOString() }; if (idx >= 0) wf[idx] = entry; else wf.push(entry); return { ...prev, workflow: wf } });
    } catch (e) { console.error('Workflow save error:', e); alert('Failed to save workflow note: ' + e.message); }
  }, []);

  const deleteWorkflow = useCallback(async ({ id }) => {
    try { await apiPost({ action: 'deleteNote', id }); setData(prev => ({ ...prev, workflow: (prev.workflow || []).filter(w => w.id !== id) })) } catch (e) { console.error('Workflow delete error:', e); alert('Failed to delete workflow note: ' + e.message); }
  }, []);

  const saveVendorComment = useCallback(async (comment) => {
    try {
      await apiPost({ action: 'saveVendorComment', ...comment });
      setData(prev => ({ ...prev, vendorComments: [...(prev.vendorComments || []), { vendor: comment.vendor, date: new Date().toISOString().split('T')[0], author: comment.author, category: comment.category, comment: comment.comment }] }));
    } catch (e) { console.error('Vendor comment save error:', e); alert('Failed to save vendor comment: ' + e.message); }
  }, []);

  if (liveStatus.loading && !data.cores.length) {
    return <div className="min-h-screen bg-gray-950"><Loader text="Loading live data..." /></div>;
  }

  if (liveStatus.error && !data.cores.length) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <p className="text-red-400 mb-2 font-semibold">Failed to load live data</p>
        <p className="text-gray-400 text-sm mb-4">{liveStatus.error}</p>
        <button onClick={loadLive} className="bg-blue-600 text-white px-6 py-2 rounded-lg">Retry</button>
      </div>
    </div>;
  }

  const fmtVersion = (v) => {
    if (!v) return '—';
    try {
      const d = new Date(v);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return v; }
  };

  const liveAgeMin = liveStatus.version ? Math.round((Date.now() - new Date(liveStatus.version).getTime()) / 60000) : null;
  const liveColor = liveStatus.error ? "text-red-400" : liveAgeMin == null ? "text-gray-500" : liveAgeMin > 30 ? "text-amber-400" : "text-emerald-400";
  const histColor = historyStatus.error ? "text-red-400" : historyStatus.loading ? "text-gray-500" : "text-emerald-400";

  return <SegmentCtx.Provider value={segmentCtxValue}><SumCtx.Provider value={{ addCell }}>
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-white font-bold text-lg">FBA Dashboard <span className="text-xs text-blue-400">V3</span></h1>
            <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded font-medium">LIVE — {data.cores.length}</span>
            {stg.buyer && <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{stg.buyer}</span>}

            <div className="flex items-center gap-2 text-xs">
              <span className={liveColor} title={`Live data version: ${fmtVersion(liveStatus.version)}`}>
                ● Live {liveAgeMin != null ? `${liveAgeMin}m` : '—'}
              </span>
              <span className={histColor} title={`History version: ${fmtVersion(historyStatus.version)}${historyStatus.fromCache ? ' (from browser cache)' : ''}`}>
                ● Hist {historyStatus.loading ? '…' : historyStatus.fromCache ? 'cache' : 'fresh'}
              </span>
              {(liveStatus.error || historyStatus.error) && (
                <span className="text-red-400 font-semibold" title={(liveStatus.error || '') + ' ' + (historyStatus.error || '')}>
                  ⚠ ERROR
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{sc.critical}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{sc.warning}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{sc.healthy}</span>
            </div>
            <button onClick={loadLive} className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800" title="Refresh live data">↻</button>
            <button onClick={forceServerHistoryRefresh} disabled={refreshingHistory} className={`text-xs px-2 py-1 rounded ${refreshingHistory ? 'bg-amber-600/30 text-amber-300' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`} title="Force history rebuild on server (~3 min)">
              {refreshingHistory ? '⏳ Hist…' : '↻ Hist'}
            </button>
            <button onClick={() => setShowS(true)} className="text-gray-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-gray-800">⚙️</button>
          </div>
        </div>

        {historyStatus.error && !historyStatus.loading && (
          <div className="max-w-7xl mx-auto mt-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
            ⚠ History data failed to load: {historyStatus.error}. Some charts and seasonal calculations may be empty. <button onClick={() => loadHistory({ forceRefresh: true })} className="underline ml-1">Retry</button>
          </div>
        )}
        {historyStatus.loading && !data.coreInv?.length && (
          <HistoryProgressBanner
            pct={historyProgress.total > 0 ? (historyProgress.done / historyProgress.total) * 100 : null}
            message={historyProgress.total > 0
              ? `Loading history data… ${historyProgress.done}/${historyProgress.total} chunks`
              : 'Loading history data in background. Seasonal calculations will be available shortly.'}
          />
        )}
      </header>

      <nav className="bg-gray-900/50 border-b border-gray-800 px-4 sticky top-[53px] z-30">
        <div className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  window.open(window.location.pathname + '?tab=' + t.id, '_blank');
                  return;
                }
                changeTab(t.id);
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto">
        {historyStatus.loading && !data.coreInv?.length && tab !== "glossary" && tab !== "orders" && tab !== "vendors" && tab !== "performance" && (
          <SkeletonHero />
        )}
        <div style={{ display: tab === "dashboard" ? "block" : "none" }}>
          <ErrorBoundary label="Dashboard" compact>
            <DashboardSummary data={dataH} stg={stg} vendorRecs={vendorRecs} goVendor={goVendor} workflow={data.workflow} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} vendorComments={data.vendorComments} saveVendorComment={saveVendorComment} onEnterPurchasing={() => setTab("purchasing")} activeBundleCores={activeBundleCores} />
          </ErrorBoundary>
        </div>
        <div style={{ display: tab === "purchasing" ? "block" : "none" }}>
          <ErrorBoundary label="Purchasing" compact>
            <PurchTab data={dataH} stg={stg} vendorRecs={vendorRecs} goCore={goCore} goBundle={goBundle} goVendor={goVendor} ov={ov} setOv={setOv} initV={initV} clearIV={clearIV} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} saveVendorComment={saveVendorComment} activeBundleCores={activeBundleCores} />
          </ErrorBoundary>
        </div>
        {tab === "bridge" && <ErrorBoundary label="Bridge" compact><BridgeTab data={dataH} stg={stg} vendorRecs={vendorRecs} goCore={goCore} goBundle={goBundle} /></ErrorBoundary>}
        {tab === "core" && <ErrorBoundary label="Core" compact><CoreTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} coreId={coreId} onBack={handleBackFromCore} goBundle={goBundle} /></ErrorBoundary>}
        {tab === "bundle" && <ErrorBoundary label="Bundle" compact><BundleTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, bundleInv: data.bundleInv, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} bundleId={bundleId} onBack={handleBackFromBundle} goCore={goCore} /></ErrorBoundary>}
        {tab === "segments" && <ErrorBoundary label="Segments" compact><SegmentsTab data={data} vendorRecs={vendorRecs} goBundle={goBundle} /></ErrorBoundary>}
        {tab === "orders" && <ErrorBoundary label="Orders" compact><OrdersTab data={data} /></ErrorBoundary>}
        {tab === "vendors" && <ErrorBoundary label="Vendors" compact><VendorsTab data={data} stg={stg} goVendor={goVendor} workflow={data.workflow} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} vendorComments={data.vendorComments} saveVendorComment={saveVendorComment} /></ErrorBoundary>}
        {tab === "performance" && <ErrorBoundary label="Performance" compact><PerformanceTab /></ErrorBoundary>}
        {tab === "glossary" && <ErrorBoundary label="Glossary" compact><GlossTab /></ErrorBoundary>}
      </main>

      {showS && <Stg s={stg} setS={setStg} onClose={() => setShowS(false)} />}
      <SlidePanel open={!!(panelCoreId || panelBundleId)} onClose={closePanel}>
        {panelBundleId ? <BundleTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, bundleInv: data.bundleInv, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} bundleId={panelBundleId} onBack={() => { setPanelBundleId(null); if (!panelCoreId) closePanel(); }} goCore={id => { setPanelBundleId(null); setPanelCoreId(id) }} />
        : panelCoreId ? <CoreTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} coreId={panelCoreId} onBack={closePanel} goBundle={id => setPanelBundleId(id)} />
        : null}
      </SlidePanel>
      <QuickSum cells={sumCells} onClear={clearSum} />
    </div>
  </SumCtx.Provider></SegmentCtx.Provider>;
}
