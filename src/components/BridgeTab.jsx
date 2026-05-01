// src/components/BridgeTab.jsx
// Bridge Tab UI — primary core-level table + breakdown modal + "other actions".
// This file is the React COMPONENT. The algorithm lives in src/lib/bridge.js.

import React, { useState, useMemo } from "react";
import { computeBridgeRecommendations } from "../lib/bridge";
import { CopyableId } from "./Shared";

const fmtN = (n) => (n == null || isNaN(n)) ? "—" : Math.round(n).toLocaleString("en-US");
const fmt$ = (n) => (n == null || isNaN(n)) ? "—" : "$" + Math.round(n).toLocaleString("en-US");
const fmt$3 = (n) => (n == null || isNaN(n)) ? "—" : "$" + Number(n).toFixed(3);
const fmtPct = (n) => (n == null || isNaN(n)) ? "—" : (n > 0 ? "+" : "") + Math.round(n) + "%";
const fmt1 = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(1);
const fmtPP = (n) => (n == null || isNaN(n)) ? "—" : (n > 0 ? "−" : n < 0 ? "+" : "") + Math.abs(n).toFixed(1) + "pp";
const marginDropColor = (pp) => {
  if (pp == null) return "text-gray-500";
  if (pp <= 0) return "text-emerald-300";   // negative drop = USA cheaper = improvement
  if (pp < 5) return "text-gray-300";
  if (pp < 15) return "text-amber-300";
  return "text-red-300";
};

const FLAG_META = {
  VIABLE: { icon: "🟢", label: "Viable", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  NO_USA_HISTORY: { icon: "🔴", label: "No USA history", color: "text-red-400", bg: "bg-red-500/15", border: "border-red-500/30" },
  BRIDGE_TOO_LATE: { icon: "🔴", label: "Bridge too late", color: "text-red-400", bg: "bg-red-500/15", border: "border-red-500/30" },
};

const ACTION_TEXT = {
  VIABLE: "Order USA now",
  NO_USA_HISTORY: "Raise Amazon price — no USA source",
  BRIDGE_TOO_LATE: "Raise Amazon price — bridge cannot arrive in time",
};

const deltaColor = (pct) => {
  if (pct == null) return "text-gray-500";
  if (pct > 20) return "text-red-400";
  if (pct > 0) return "text-amber-400";
  return "text-emerald-400";
};

function BridgeBreakdownModal({ rec, settings, onClose }) {
  if (!rec) return null;
  const meta = FLAG_META[rec.flag];
  const pipeline_days = settings.pipeline_days ?? 25;

  const totalCost = rec.pieces_to_buy && rec.usa_vendor
    ? rec.pieces_to_buy * rec.usa_vendor.last_price : null;
  const chinaCost = rec.pieces_to_buy && rec.price_comparison.last_china_price
    ? rec.pieces_to_buy * rec.price_comparison.last_china_price : null;
  const premiumPaid = totalCost && chinaCost ? totalCost - chinaCost : null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Bridge for {rec.core_id} — Why this recommendation?</h2>
            <p className="text-gray-400 text-sm mt-1">{rec.core_name}</p>
            {rec.usa_vendor && (
              <p className="text-gray-500 text-xs mt-1">
                {rec.usa_vendor.name} · LT {rec.usa_vendor.lt}d · MOQ {fmtN(rec.usa_vendor.moq)} pcs · Last price {fmt$3(rec.usa_vendor.last_price)}/pc
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className={`rounded-lg p-3 mb-4 ${meta.bg} border ${meta.border}`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">{meta.icon}</span>
            <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
            <span className="text-gray-400 text-sm ml-2">— {ACTION_TEXT[rec.flag]}</span>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4 mb-3">
          <h3 className="text-sm font-semibold text-white mb-2">Step 1 — Bundle gap analysis</h3>
          <p className="text-gray-400 text-xs mb-3">For each bundle using this core, the gap is the pieces needed to cover until China is FBA-live (China ETA + {pipeline_days} pipeline days), minus current non-inbound stock.</p>
          <div className="overflow-x-auto">
           <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="py-1.5 text-left">Bundle</th>
                  <th className="py-1.5 text-right">effDSR</th>
                  <th className="py-1.5 text-right">Non-inb stock</th>
                  <th className="py-1.5 text-right">Curr DOC</th>
                  <th className="py-1.5 text-right">China ETA</th>
                  <th className="py-1.5 text-right">Cover need</th>
                  <th className="py-1.5 text-right">Gap (pcs)</th>
                  <th className="py-1.5 text-right">Gap (DOC)</th>
                  <th className="py-1.5 text-right">Core qty</th>
                  <th className="py-1.5 text-right border-l border-gray-700 pl-3">Margin now</th>
                  <th className="py-1.5 text-right">Margin USA</th>
                  <th className="py-1.5 text-right" title="Drop = margin loss in percentage points if this core is bridged USA. Green = USA is cheaper (improvement).">Δ pp</th>
                </tr>
              </thead>
              <tbody>
                {rec.contributing_bundles.map(b => (
                  <tr key={b.bundle_id} className="border-t border-gray-800/40">
                    <td className="py-1.5 text-blue-300 font-mono">{b.bundle_id}</td>
                    <td className="py-1.5 text-right text-gray-300">{fmt1(b.effDSR)}</td>
                    <td className="py-1.5 text-right text-gray-300">{fmtN(b.non_inbound_pieces)}</td>
                    <td className="py-1.5 text-right text-gray-300">{fmtN(b.current_DOC)}d</td>
                    <td className="py-1.5 text-right text-gray-300">{fmtN(b.china_eta)}d</td>
                    <td className="py-1.5 text-right text-gray-300">{fmtN(b.total_cover_needed_DOC)}d</td>
                    <td className="py-1.5 text-right text-amber-300 font-semibold">{fmtN(b.gap_pieces)}</td>
                    <td className="py-1.5 text-right text-amber-300">{fmtN(b.gap_DOC)}d</td>
                    <td className="py-1.5 text-right text-cyan-300 font-semibold">{fmtN(b.pieces_contributed)}</td>
                    <td className="py-1.5 text-right text-gray-300 border-l border-gray-800 pl-3">{b.margin_actual != null ? fmt1(b.margin_actual) + "%" : "—"}</td>
                    <td className="py-1.5 text-right text-gray-300">{b.margin_usa != null ? fmt1(b.margin_usa) + "%" : "—"}</td>
                    <td className={`py-1.5 text-right font-semibold ${marginDropColor(b.margin_drop_pp)}`}>{fmtPP(b.margin_drop_pp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4 mb-3">
          <h3 className="text-sm font-semibold text-white mb-2">Step 2 — Aggregate to core need</h3>
          <p className="text-gray-400 text-xs mb-2">Sum of all (bundle gap × pieces per bundle) for this core.</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Total raw pieces needed:</span>
            <span className="text-white font-bold text-lg">{fmtN(rec.raw_pieces_needed)}</span>
            {rec.needed_DOC != null && (
              <span className="text-gray-500 text-xs ml-2">(≈ {fmtN(rec.needed_DOC)} DOC at combined consumption rate)</span>
            )}
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4 mb-3">
          <h3 className="text-sm font-semibold text-white mb-2">Step 3 — USA vendor selection</h3>
          {rec.usa_vendor ? (
            <div className="text-xs text-gray-300 space-y-1">
              <div>
                <span className="text-gray-500">Selected:</span>{" "}
                <span className="text-white font-semibold">{rec.usa_vendor.name}</span>{" "}
                <span className="text-gray-500">(most recent USA receipt: {rec.usa_vendor.last_purchase_date || "—"})</span>
              </div>
              <div className="text-gray-500">Total USA receipts in history: {rec.usa_vendor.total_history_count}</div>
            </div>
          ) : (
            <div className="text-red-300 text-xs">✗ No USA vendor with historical purchases of this core. Bridge not viable from USA.</div>
          )}
        </div>

        <div className={`rounded-lg p-4 mb-3 ${rec.flag === 'BRIDGE_TOO_LATE' ? "bg-red-500/10 border border-red-500/30" : "bg-gray-800/50"}`}>
          <h3 className="text-sm font-semibold text-white mb-2">Step 4 — Feasibility check (lead time vs urgency)</h3>
          {rec.usa_vendor ? (
            <div className="text-xs space-y-1">
              <div className="text-gray-400">Most-urgent contributing bundle DOC: <span className="text-white font-semibold">{fmtN(rec.urgency_score)}d</span></div>
              <div className="text-gray-400">USA vendor lead time: <span className="text-white font-semibold">{rec.usa_vendor.lt}d</span></div>
              {rec.flag === 'BRIDGE_TOO_LATE' ? (
                <div className="text-red-300 mt-2 font-semibold">✗ {fmtN(rec.urgency_score)}d &lt; {rec.usa_vendor.lt}d — bridge cannot arrive in time. See Step 6.</div>
              ) : (
                <div className="text-emerald-300 mt-2">✓ {fmtN(rec.urgency_score)}d &gt; {rec.usa_vendor.lt}d — bridge can arrive in time.</div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-xs italic">N/A — no USA vendor</div>
          )}
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4 mb-3">
          <h3 className="text-sm font-semibold text-white mb-2">Step 5 — Price comparison</h3>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">Last China price</div>
              <div className="text-white font-bold">{fmt$3(rec.price_comparison.last_china_price)}/pc</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">Last USA price</div>
              <div className="text-white font-bold">{fmt$3(rec.price_comparison.last_usa_price)}/pc</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">Δ vs China</div>
              <div className={`font-bold ${deltaColor(rec.price_comparison.delta_pct)}`}>{fmtPct(rec.price_comparison.delta_pct)}</div>
            </div>
          </div>
          <p className="text-gray-500 text-[10px] mt-2 italic">Positive % = USA more expensive than China. Informational only — judge case by case.</p>
        </div>

        {rec.flag === 'VIABLE' ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-emerald-300 mb-2">Step 6 — MOQ applied & final order</h3>
            <div className="grid grid-cols-4 gap-3 text-center text-xs mb-3">
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Raw need</div>
                <div className="text-white font-bold text-base">{fmtN(rec.raw_pieces_needed)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">USA MOQ</div>
                <div className="text-gray-300 font-bold text-base">{fmtN(rec.usa_vendor.moq)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Casepack</div>
                <div className="text-gray-300 font-bold text-base">{fmtN(rec.usa_vendor.casePack || 1)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Final order</div>
                <div className={`font-bold text-base ${rec.moq_inflated ? "text-orange-300" : "text-emerald-400"}`}>{fmtN(rec.pieces_to_buy)}</div>
              </div>
            </div>
            {rec.moq_inflated && (
              <div className="text-orange-300 text-xs mb-2">
                ⚠ MOQ inflated — buying {Math.round(rec.inflation_ratio * 100)}% of real need · excess {fmtN(rec.excess_pieces)} pcs (~{fmtN(rec.excess_DOC_overhead)} extra DOC)
              </div>
            )}
            <div className="border-t border-emerald-500/20 pt-3 mt-3">
              <p className="text-gray-300 text-sm leading-relaxed">
                <span className="text-emerald-300 font-semibold">FINAL RECOMMENDATION: </span>
                Buy <span className="text-white font-bold">{fmtN(rec.pieces_to_buy)} units</span> of <span className="text-blue-300 font-mono">{rec.core_id}</span> from <span className="text-white font-bold">{rec.usa_vendor.name}</span>.
              </p>
              <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                <div className="text-gray-400">Bridge DOC added: <span className="text-emerald-300 font-bold">~{fmtN(rec.bridge_DOC_added)}d</span></div>
                <div className="text-gray-400">Cost: <span className="text-amber-300 font-bold">{fmt$(totalCost)}</span></div>
                {premiumPaid != null && (
                  <div className="text-gray-400">Premium vs China: <span className={premiumPaid > 0 ? "text-red-300 font-bold" : "text-emerald-300 font-bold"}>{premiumPaid > 0 ? "+" : ""}{fmt$(premiumPaid)}</span></div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-red-300 mb-2">Step 6 — Mitigation: Amazon price increase</h3>
            <p className="text-gray-300 text-xs mb-3">Bridge from USA is not feasible. Throttle demand by raising Amazon price until China lands.</p>
            {rec.throttle_suggestion && (
              <div className="bg-gray-900 rounded p-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500 text-[10px] uppercase">Days until China FBA-live</div>
                    <div className="text-white font-bold">{fmtN(rec.throttle_suggestion.days_until_china_live)}d</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px] uppercase">Worst-case bundle</div>
                    <div className="text-blue-300 font-mono text-sm">{rec.throttle_suggestion.worst_bundle}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px] uppercase">Current effDSR</div>
                    <div className="text-white font-bold">{fmt1(rec.throttle_suggestion.current_DSR)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-[10px] uppercase">Target DSR (to survive)</div>
                    <div className="text-emerald-300 font-bold">{fmt1(rec.throttle_suggestion.target_DSR)}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-700 text-sm text-red-200">
                  → Raise Amazon price to reduce DSR by ~<span className="font-bold">{Math.round(rec.throttle_suggestion.reduction_pct)}%</span> until China is FBA-live.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BridgeTab({ data, stg, vendorRecs, goCore, goBundle }) {
  const analysis = useMemo(() => computeBridgeRecommendations({
    vendors: data.vendors || [],
    cores: data.cores || [],
    bundles: data.bundles || [],
    vendorRecs: vendorRecs || {},
    receivingFull: data.receivingFull || [],
    inbound: data.inbound || [],
    fees: data.fees || [],
    settings: stg,
  }), [data.vendors, data.cores, data.bundles, vendorRecs, data.receivingFull, data.inbound, data.fees, stg]);

  const [breakdown, setBreakdown] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [onlyViable, setOnlyViable] = useState(false);
  const [diagQuery, setDiagQuery] = useState('');
  const [diagResult, setDiagResult] = useState(null);

  const runDiagnostic = (q) => {
    const query = String(q || '').trim().toLowerCase();
    if (!query) { setDiagResult(null); return; }
    const recs = analysis.primary_recommendations || [];
    const snaps = analysis.all_bundle_snapshots || [];

    // First try exact core match in recommendations
    const inRec = recs.find(r => (r.core_id || '').toLowerCase() === query);
    if (inRec) {
      setDiagResult({
        kind: 'in-bridge',
        coreId: inRec.core_id,
        message: `Core ${inRec.core_id} IS in the bridge (${inRec.flag}). See row below — buy ${fmtN(inRec.pieces_to_buy)} pcs from ${inRec.usa_vendor?.name || 'USA vendor'}.`,
      });
      // also expand its row
      setExpanded(prev => { const n = new Set(prev); n.add(inRec.core_id); return n; });
      return;
    }

    // Try bundle search — find bundle snapshot
    const bundleSnaps = snaps.filter(s => (s.bundleId || '').toLowerCase() === query);
    if (bundleSnaps.length > 0) {
      const ss = bundleSnaps[0];
      const reasons = [];
      if (ss.effDSR < 0.05) reasons.push(`Bundle has effectively zero DSR (${ss.effDSR.toFixed(3)}). The bridge tab only analyzes bundles with active demand.`);
      if (ss.china_eta == null || ss.china_eta <= 0) reasons.push('No active China inbound for this bundle. Bridge tab only analyzes items with China shipments arriving soon.');
      if (ss.inbound_pieces <= 0) reasons.push('China inbound count is zero — no shipment to bridge against.');
      const td = stg.intlDoc || 180;
      if (ss.current_DOC != null && ss.current_DOC >= td) reasons.push(`DOC is sufficient (${Math.round(ss.current_DOC)}d, target ${td}d). No bridge needed.`);
      if (reasons.length === 0) reasons.push('Bundle was analyzed but did not match any "needs bridge" rule. Check the preventive list below.');
      setDiagResult({
        kind: 'bundle-not-in-bridge',
        bundleId: ss.bundleId,
        bundleName: ss.bundleName,
        snapshot: ss,
        reasons,
      });
      return;
    }

    // Try core ID against snapshots' bundles
    const referencingSnaps = snaps.filter(s => {
      const cores = s.bd?.coresUsed || [];
      return cores.some(c => (c.coreId || '').toLowerCase() === query);
    });
    if (referencingSnaps.length > 0) {
      const reasons = [];
      const td = stg.intlDoc || 180;
      const allCovered = referencingSnaps.every(s => s.current_DOC != null && s.current_DOC >= td);
      const noChina = referencingSnaps.every(s => s.china_eta == null || s.china_eta <= 0);
      if (allCovered) reasons.push(`All bundles using core ${query} have sufficient DOC. No bridge needed.`);
      else if (noChina) reasons.push(`No China inbound for any bundle using this core.`);
      else reasons.push(`Bundles using this core were analyzed but didn't trigger bridge — check the preventive list.`);
      setDiagResult({
        kind: 'core-not-in-bridge',
        coreId: query,
        bundlesAffected: referencingSnaps.map(s => s.bundleId),
        reasons,
      });
      return;
    }

    setDiagResult({
      kind: 'not-found',
      query,
      message: `No bundle or core matching "${q}" was found in the live snapshot. Check the spelling.`,
    });
  };

  const toggleRow = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const recs = useMemo(() => {
    if (!onlyViable) return analysis.primary_recommendations;
    return analysis.primary_recommendations.filter(r => r.flag === 'VIABLE');
  }, [analysis.primary_recommendations, onlyViable]);

  const s = analysis.summary;

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Bridge Tab <span className="text-xs text-blue-400 ml-2">classic bridge</span></h2>
          <p className="text-xs text-gray-500 mt-1">USA bridge buys to cover the gap until China shipments land in FBA. Pipeline = {analysis.settings_used.pipeline_days} days · {analysis.generated_at.split('T')[0]}</p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={diagQuery}
            onChange={(e) => setDiagQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runDiagnostic(diagQuery); }}
            placeholder="Search core/bundle to diagnose…"
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-3 py-1.5 w-64"
          />
          <button
            onClick={() => runDiagnostic(diagQuery)}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            Diagnose
          </button>
          <button onClick={() => setOnlyViable(!onlyViable)} className={`text-xs px-3 py-1.5 rounded ${onlyViable ? "bg-emerald-600 text-white" : "bg-gray-800 border border-gray-700 text-gray-400"}`}>
            {onlyViable ? "Viable only ✓" : "Show all"}
          </button>
        </div>
      </div>

      {diagResult && (
        <div className={`mb-4 rounded-lg p-3 border ${
          diagResult.kind === 'in-bridge' ? 'bg-emerald-500/10 border-emerald-500/30' :
          diagResult.kind === 'not-found' ? 'bg-red-500/10 border-red-500/30' :
          'bg-amber-500/10 border-amber-500/30'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-white font-semibold text-sm mb-1">
                Diagnostic: {diagResult.coreId || diagResult.bundleId || diagResult.query}
                {diagResult.bundleName && <span className="text-gray-400 font-normal ml-2 text-xs">{diagResult.bundleName}</span>}
              </div>
              {diagResult.message && <p className="text-xs text-gray-200">{diagResult.message}</p>}
              {diagResult.reasons && diagResult.reasons.length > 0 && (
                <div className="text-xs text-gray-200">
                  <p className="text-gray-300 mb-1">
                    {diagResult.coreId
                      ? `Core ${diagResult.coreId} is NOT a bridge candidate because:`
                      : `Bundle ${diagResult.bundleId} is NOT a bridge candidate because:`}
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {diagResult.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {diagResult.snapshot && (
                <div className="mt-2 text-[11px] text-gray-400 grid grid-cols-2 gap-x-4 gap-y-0.5 max-w-md">
                  <span>effDSR: <span className="text-white">{fmt1(diagResult.snapshot.effDSR)}</span></span>
                  <span>Non-inbound pcs: <span className="text-white">{fmtN(diagResult.snapshot.non_inbound_pieces)}</span></span>
                  <span>Inbound pcs: <span className="text-white">{fmtN(diagResult.snapshot.inbound_pieces)}</span></span>
                  <span>China ETA (d): <span className="text-white">{diagResult.snapshot.china_eta ?? '—'}</span></span>
                  <span>Current DOC: <span className="text-white">{fmtN(diagResult.snapshot.current_DOC)}</span></span>
                </div>
              )}
              {diagResult.bundlesAffected && diagResult.bundlesAffected.length > 0 && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Bundles using this core: {diagResult.bundlesAffected.slice(0, 5).map(id => (
                    <button key={id} onClick={() => goBundle && goBundle(id)} className="font-mono text-blue-400 hover:underline mr-2">{id}</button>
                  ))}
                  {diagResult.bundlesAffected.length > 5 && <span className="text-gray-500">+{diagResult.bundlesAffected.length - 5} more</span>}
                </p>
              )}
            </div>
            <button
              onClick={() => { setDiagResult(null); setDiagQuery(''); }}
              className="text-gray-400 hover:text-white text-sm flex-shrink-0"
            >✕</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-3 mb-5">
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-gray-500">Bundles in gap</div>
          <div className="text-2xl font-bold text-white">{s.bundles_in_gap}</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-gray-500">Cores viable</div>
          <div className="text-2xl font-bold text-emerald-400">{s.cores_viable}</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-gray-500">Cores blocked</div>
          <div className="text-2xl font-bold text-red-400">{s.cores_blocked}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{s.cores_no_history} no hist · {s.cores_too_late} too late</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-gray-500">Total pieces</div>
          <div className="text-2xl font-bold text-blue-400">{fmtN(s.total_bridge_pieces)}</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase text-gray-500">Total cost</div>
          <div className="text-2xl font-bold text-amber-400">{fmt$(s.total_bridge_cost)}</div>
        </div>
      </div>

      {recs.length === 0 ? (
        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">
            {analysis.primary_recommendations.length === 0
              ? "✓ No bundles currently have a bridge gap. China shipments cover demand within the pipeline window."
              : "No recommendations match the current filter."}
          </p>
        </div>
      ) : (
        <div className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 border-b border-gray-700">
                <tr className="text-gray-500 uppercase">
                  <th className="py-2 px-3 text-left">Flag</th>
                  <th className="py-2 px-3 text-left">Core</th>
                  <th className="py-2 px-3 text-right">Buy (pcs)</th>
                  <th className="py-2 px-3 text-right">DOC added</th>
                  <th className="py-2 px-3 text-left">USA vendor</th>
                  <th className="py-2 px-3 text-right">Δ vs China</th>
                  <th className="py-2 px-3 text-center">Bundles</th>
                  <th className="py-2 px-3 text-left">Action</th>
                  <th className="py-2 px-3 text-center">Why?</th>
                </tr>
              </thead>
              <tbody>
                {recs.map(r => {
                  const meta = FLAG_META[r.flag];
                  const isOpen = expanded.has(r.core_id);
                  return (
                    <React.Fragment key={r.core_id}>
                      <tr className={`border-t border-gray-800/40 hover:bg-gray-800/30 ${r.flag !== 'VIABLE' ? "bg-red-900/5" : ""}`}>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${meta.bg} ${meta.color} font-semibold`}>{meta.icon} {meta.label}</span>
                        </td>
                        <td className="py-2 px-3">
                          <button onClick={() => goCore && goCore(r.core_id)} className="text-blue-300 font-mono hover:underline">
                            <CopyableId value={r.core_id} />
                          </button>
                          <div className="text-gray-500 text-[10px] truncate max-w-[200px]">{r.core_name}</div>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className={`font-bold text-base ${r.pieces_to_buy ? "text-white" : "text-gray-600"}`}>{fmtN(r.pieces_to_buy)}</span>
                          {r.moq_inflated && (
                            <span className="ml-1 text-[10px] text-orange-400" title={`MOQ inflated ${Math.round(r.inflation_ratio * 100)}% · excess ${fmtN(r.excess_pieces)} pcs`}>⚠$</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className={`font-bold ${r.bridge_DOC_added ? "text-emerald-300" : "text-gray-600"}`}>{r.bridge_DOC_added != null ? `~${fmtN(r.bridge_DOC_added)}d` : "—"}</span>
                        </td>
                        <td className="py-2 px-3">
                          {r.usa_vendor ? (
                            <>
                              <div className="text-white">{r.usa_vendor.name}</div>
                              <div className="text-gray-500 text-[10px]">LT {r.usa_vendor.lt}d · {fmt$3(r.usa_vendor.last_price)}/pc</div>
                            </>
                          ) : (
                            <span className="text-red-400 text-[10px]">no USA history</span>
                          )}
                        </td>
                        <td className={`py-2 px-3 text-right font-semibold ${deltaColor(r.price_comparison.delta_pct)}`}>{fmtPct(r.price_comparison.delta_pct)}</td>
                        <td className="py-2 px-3 text-center">
                          <button onClick={() => toggleRow(r.core_id)} className="text-gray-400 hover:text-white text-xs">{r.contributing_bundles.length} {isOpen ? "▾" : "▸"}</button>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-xs ${r.flag === 'VIABLE' ? "text-emerald-300" : "text-red-300"}`}>{ACTION_TEXT[r.flag]}</span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button onClick={() => setBreakdown(r)} className="text-gray-400 hover:text-white" title="Show breakdown">📊</button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-900/40">
                          <td colSpan={9} className="py-2 px-6">
                            <div className="text-[10px] uppercase text-gray-500 mb-1">Contributing bundles</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500 border-b border-gray-800">
                                  <th className="py-1 text-left">Bundle</th>
                                  <th className="py-1 text-right">effDSR</th>
                                  <th className="py-1 text-right">Curr DOC</th>
                                  <th className="py-1 text-right">China ETA</th>
                                  <th className="py-1 text-right">Gap (pcs)</th>
                                  <th className="py-1 text-right">Qty/bdl</th>
                                  <th className="py-1 text-right">Core pcs</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.contributing_bundles.map(b => (
                                  <tr key={b.bundle_id} className="border-t border-gray-800/30">
                                    <td className="py-1">
                                      <button onClick={() => goBundle && goBundle(b.bundle_id)} className="text-blue-300 font-mono hover:underline">{b.bundle_id}</button>
                                    </td>
                                    <td className="py-1 text-right text-gray-300">{fmt1(b.effDSR)}</td>
                                    <td className="py-1 text-right text-gray-300">{fmtN(b.current_DOC)}d</td>
                                    <td className="py-1 text-right text-gray-300">{fmtN(b.china_eta)}d</td>
                                    <td className="py-1 text-right text-amber-300">{fmtN(b.gap_pieces)}</td>
                                    <td className="py-1 text-right text-gray-500">×{b.qty_per_bundle}</td>
                                    <td className="py-1 text-right text-cyan-300">{fmtN(b.pieces_contributed)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {r.flag !== 'VIABLE' && r.throttle_suggestion && (
                              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs">
                                <span className="text-red-300 font-semibold">Mitigation: </span>
                                <span className="text-gray-300">Raise Amazon price to reduce DSR by ~{Math.round(r.throttle_suggestion.reduction_pct)}% (from {fmt1(r.throttle_suggestion.current_DSR)} to {fmt1(r.throttle_suggestion.target_DSR)} units/day) for {fmtN(r.throttle_suggestion.days_until_china_live)} days until China FBA-live.</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8">
        <h3 className="text-lg font-bold text-white mb-2">Other actions to consider</h3>
        <p className="text-xs text-gray-500 mb-4">Situations outside the classic-bridge case (no China inbound yet, AGL acceleration, etc.).</p>

        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 mb-3">
          <h4 className="text-sm font-semibold text-amber-300 mb-2">Preventive bridge candidates ({analysis.other_actions.preventive.length})</h4>
          <p className="text-[11px] text-gray-500 mb-3">Bundles below 90 DOC with NO China inbound yet. Plan a China PO soon — and consider USA bridge proactively if margin allows.</p>
          {analysis.other_actions.preventive.length === 0 ? (
            <p className="text-gray-500 text-xs italic">None — all low-cover bundles already have China inbound.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 uppercase">
                  <tr className="border-b border-gray-800">
                    <th className="py-1.5 text-left">Bundle</th>
                    <th className="py-1.5 text-right">Current DOC</th>
                    <th className="py-1.5 text-right">effDSR</th>
                    <th className="py-1.5 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.other_actions.preventive.slice(0, 15).map(p => (
                    <tr key={p.bundle_id} className="border-t border-gray-800/40">
                      <td className="py-1.5">
                        <button onClick={() => goBundle && goBundle(p.bundle_id)} className="text-blue-300 font-mono hover:underline">{p.bundle_id}</button>
                        <span className="text-gray-500 text-[10px] ml-2">{p.bundle_name}</span>
                      </td>
                      <td className={`py-1.5 text-right font-semibold ${p.current_DOC < 30 ? "text-red-400" : p.current_DOC < 60 ? "text-amber-400" : "text-gray-300"}`}>{fmtN(p.current_DOC)}d</td>
                      <td className="py-1.5 text-right text-gray-300">{fmt1(p.effDSR)}</td>
                      <td className="py-1.5 text-right text-gray-300">{fmtN(p.non_inbound_pieces)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analysis.other_actions.preventive.length > 15 && (
                <p className="text-gray-500 text-[10px] mt-2 italic">+ {analysis.other_actions.preventive.length - 15} more</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 mb-3">
          <h4 className="text-sm font-semibold text-cyan-300 mb-1">AGL acceleration</h4>
          <p className="text-[11px] text-gray-500">Phase 2 — If a China shipment is in ocean freight, AGL (Amazon Global Logistics) can shorten the gap. Data integration pending.</p>
        </div>

        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-red-300 mb-1">Buy China + price increase ({analysis.other_actions.no_usa_history.length + analysis.other_actions.bridge_too_late.length})</h4>
          <p className="text-[11px] text-gray-500 mb-2">Cores where USA bridge is structurally infeasible. Place the next China PO now, raise Amazon price to throttle demand.</p>
          {(analysis.other_actions.no_usa_history.length + analysis.other_actions.bridge_too_late.length) === 0 ? (
            <p className="text-gray-500 text-xs italic">None — all gap cores have a viable USA path.</p>
          ) : (
            <div className="text-xs space-y-1">
              {[...analysis.other_actions.no_usa_history, ...analysis.other_actions.bridge_too_late].slice(0, 10).map(r => (
                <div key={r.core_id} className="flex items-center gap-2 bg-gray-900/40 rounded px-2 py-1">
                  <span className="text-blue-300 font-mono">{r.core_id}</span>
                  <span className="text-gray-500 text-[10px]">{r.flag === 'NO_USA_HISTORY' ? "no USA history" : "USA too slow"}</span>
                  {r.throttle_suggestion && (
                    <span className="ml-auto text-red-300 text-[10px]">↓ DSR ~{Math.round(r.throttle_suggestion.reduction_pct)}% for {fmtN(r.throttle_suggestion.days_until_china_live)}d</span>
                  )}
                  <button onClick={() => setBreakdown(r)} className="text-gray-400 hover:text-white" title="Details">📊</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {breakdown && <BridgeBreakdownModal rec={breakdown} settings={stg} onClose={() => setBreakdown(null)} />}
    </div>
  );
}
