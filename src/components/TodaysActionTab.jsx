// src/components/TodaysActionTab.jsx
// ============================================================
// Today's Action — the new dashboard home.
// Hero (counts + cost), KPI strip, optional Q4 alert widget,
// and a vendor list grouped by urgency. From here a single
// click opens the Critical PO flow modal to walk vendor by
// vendor and emit POs / clipboard rows using the existing
// helpers (genPO, cp7f, cp7g) — with a draft-mode fallback
// when the helpers fail (e.g. popup blocked).
// ============================================================

import React, { useContext, useMemo, useState } from "react";
import { R, D1, gS, fSl, genPO, genRFQ, cp7f, cp7g } from "../lib/utils";
import { Dot, WorkflowChip, VendorNotes } from "./Shared";
import { getEffectiveWfStatus } from "./Shared";
import { SegmentCtx, WhyBuyCtx } from "../App";
import { SegmentBadge } from "./SegmentBadges";

const fmt0 = (n) => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
const dollar = (n) => n == null || !Number.isFinite(n) ? '—' : '$' + Math.round(n).toLocaleString('en-US');

// Compute a vendor's urgency from its recommendation.
function vendorUrgency(rec) {
  if (!rec) return { tier: 'none', count: 0, urgent: 0, cost: 0 };
  const itemsWithBuy = (rec.items || []).filter(i => (i.finalQty || 0) > 0);
  if (itemsWithBuy.length === 0) return { tier: 'none', count: 0, urgent: 0, cost: 0 };
  const urgent = itemsWithBuy.filter(i => i.urgent).length;
  const tier = urgent > 0 ? 'critical' : 'warning';
  const cost = itemsWithBuy.reduce((s, i) => s + (i.cost || 0), 0);
  return { tier, count: itemsWithBuy.length, urgent, cost };
}

function buildPoNumber(buyer) {
  const stamp = new Date();
  const yy = String(stamp.getFullYear()).slice(2);
  const mm = String(stamp.getMonth() + 1).padStart(2, '0');
  const dd = String(stamp.getDate()).padStart(2, '0');
  const hh = String(stamp.getHours()).padStart(2, '0');
  const mi = String(stamp.getMinutes()).padStart(2, '0');
  return `${(buyer || 'PO').toUpperCase()}-${yy}${mm}${dd}-${hh}${mi}`;
}

// ─── Critical PO Modal ──────────────────────────────────────
function CriticalPOModal({ open, vendors, vendorRecs, vMap, stg, onClose, onComplete }) {
  const [step, setStep] = useState(0);
  const [generated, setGenerated] = useState([]); // [{vendor, poNumber, totalCost, mode, items}]
  const [draftMode, setDraftMode] = useState({});

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setGenerated([]);
      setDraftMode({});
    }
  }, [open]);

  if (!open) return null;
  const totalSteps = vendors.length;
  const v = vendors[step];
  const rec = v ? vendorRecs[v.name] : null;
  if (!v || !rec) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
          <p className="text-white">No critical vendors to review.</p>
          <button onClick={onClose} className="mt-3 bg-blue-600 text-white rounded px-4 py-2 text-sm">Close</button>
        </div>
      </div>
    );
  }
  const items = (rec.items || []).filter(i => (i.finalQty || 0) > 0);
  const totalCost = items.reduce((s, i) => s + (i.cost || 0), 0);

  const tryGenerate = () => {
    const buyer = stg?.buyer || '';
    const poNumber = buildPoNumber(buyer);
    const today = new Date();
    let ok = true;
    let mode = 'po';
    try {
      // Items shape expected by genPO: { id, ti, vsku, qty, cost, cp, isCoreItem, inbS }
      const fullItems = items.map(i => ({
        id: i.id,
        ti: i.id, // we don't carry a title in items[]; keep id
        vsku: i.id,
        qty: i.finalQty,
        cost: i.pricePerPiece,
        cp: 1,
        isCoreItem: i.mode === 'core',
        inbS: 0,
      }));
      genPO(v, fullItems, poNumber, buyer, today);
      // also clip 7f
      try { cp7f(v, fullItems, poNumber, buyer, ''); } catch {}
      try { cp7g(v, fullItems, poNumber, buyer); } catch {}
    } catch (err) {
      ok = false;
      mode = 'draft';
      setDraftMode(prev => ({ ...prev, [v.name]: String(err?.message || err) }));
    }
    setGenerated(prev => [...prev, { vendor: v.name, poNumber, totalCost, mode, items }]);
    if (step + 1 < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete && onComplete([...generated, { vendor: v.name, poNumber, totalCost, mode, items }]);
    }
  };

  const skip = () => {
    if (step + 1 < totalSteps) setStep(step + 1);
    else onComplete && onComplete(generated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-gray-800 px-5 py-3 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-white font-bold text-lg">Generate Critical POs</h2>
            <p className="text-xs text-gray-400">
              Vendor {step + 1} of {totalSteps}: <span className="text-white">{v.name}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-5">
          <div className="bg-gray-800/40 border border-gray-800 rounded-lg p-3 mb-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Vendor</div>
                <div className="text-white font-semibold">{v.name}</div>
                {v.country && <div className="text-gray-500 text-xs">{v.country}</div>}
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Items</div>
                <div className="text-white font-semibold">{items.length}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Total cost</div>
                <div className="text-amber-300 font-bold">{dollar(totalCost)}</div>
              </div>
            </div>
            {rec.vendorMoqDollar > 0 && (
              <p className="mt-2 text-[11px]">
                Vendor MOQ: {dollar(rec.vendorMoqDollar)} —{' '}
                {rec.meetsVendorMoq
                  ? <span className="text-emerald-400">✓ met</span>
                  : <span className="text-red-300">! gap {dollar(rec.vendorMoqGap)}</span>}
              </p>
            )}
          </div>

          <table className="w-full text-xs border border-gray-800">
            <thead className="bg-gray-800/60 text-gray-400 uppercase">
              <tr>
                <th className="px-2 py-1 text-left">Item</th>
                <th className="px-2 py-1 text-left">Mode</th>
                <th className="px-2 py-1 text-right">Need</th>
                <th className="px-2 py-1 text-right">Final</th>
                <th className="px-2 py-1 text-right">$/u</th>
                <th className="px-2 py-1 text-right">Cost</th>
                <th className="px-2 py-1 text-center">Flags</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id + '-' + i.mode} className="border-t border-gray-800/60">
                  <td className="px-2 py-1 font-mono text-blue-400">{i.id}</td>
                  <td className="px-2 py-1 text-gray-300">{i.mode}</td>
                  <td className="px-2 py-1 text-right">{fmt0(i.needPieces)}</td>
                  <td className={`px-2 py-1 text-right font-semibold ${i.moqInflated ? 'text-orange-300' : 'text-white'}`}>{fmt0(i.finalQty)}</td>
                  <td className="px-2 py-1 text-right text-gray-300">{i.pricePerPiece?.toFixed(3)}</td>
                  <td className="px-2 py-1 text-right text-amber-200">{dollar(i.cost)}</td>
                  <td className="px-2 py-1 text-center">
                    {i.urgent && <span className="text-[10px] text-red-300 mr-1">URG</span>}
                    {i.moqInflated && <span className="text-[10px] text-orange-300">MOQ</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {draftMode[v.name] && (
            <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded p-2 text-xs text-amber-200">
              ⚠ PO window failed to open ({draftMode[v.name]}). The vendor and items above are
              the draft — copy/send manually.
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <button
              onClick={tryGenerate}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded py-2 font-semibold"
            >
              {step + 1 < totalSteps ? 'Generate & next →' : 'Generate & finish'}
            </button>
            <button onClick={skip} className="bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 text-sm">
              Skip
            </button>
            <button onClick={onClose} className="bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vendor Card ─────────────────────────────────────────────
function VendorCard({ vendor, rec, urgency, segMap, onReview, onWhyBuy, workflow, saveWorkflow, deleteWorkflow, buyer }) {
  const [expanded, setExpanded] = useState(false);
  const items = (rec?.items || []).filter(i => (i.finalQty || 0) > 0);
  const segCounts = {};
  for (const bd of (rec?.bundleDetails || [])) {
    if ((bd.buyNeed || 0) <= 0) continue;
    const seg = segMap?.[bd.bundleId]?.effective || bd.segment || 'STABLE';
    segCounts[seg] = (segCounts[seg] || 0) + 1;
  }

  const dotCls = urgency.tier === 'critical'
    ? 'bg-red-500 animate-pulse'
    : urgency.tier === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-3 px-4 py-3 hover:bg-gray-800/30 text-left"
        >
          <span className={`inline-block w-3 h-3 rounded-full ${dotCls}`} />
          <span className="text-white font-semibold">{vendor.name}</span>
          <span className="text-xs text-gray-500">LT {vendor.lt}d</span>
          <span className="text-xs text-gray-500">{urgency.count} items</span>
          <span className="text-xs text-amber-300 ml-auto">{dollar(urgency.cost)}</span>
          <span className="text-gray-400 text-sm">{expanded ? '▾' : '▸'}</span>
        </button>
        {saveWorkflow && (
          <div className="pr-3">
            <WorkflowChip
              id={vendor.name}
              type="vendor"
              workflow={workflow || []}
              onSave={saveWorkflow}
              onDelete={deleteWorkflow}
              buyer={buyer || ''}
              country={vendor.country || ''}
            />
          </div>
        )}
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-gray-800">
          {Object.keys(segCounts).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {Object.entries(segCounts).map(([seg, n]) => (
                <span key={seg}>
                  <SegmentBadge segment={seg} small />
                  <span className="text-[10px] text-gray-500 ml-1">{n}</span>
                </span>
              ))}
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="text-gray-500 uppercase">
              <tr>
                <th className="py-1 text-left">Item</th>
                <th className="py-1 text-left">Mode</th>
                <th className="py-1 text-right">Need</th>
                <th className="py-1 text-right">Final</th>
                <th className="py-1 text-right">Cost</th>
                <th className="py-1 text-right">Why?</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id + '-' + i.mode} className="border-t border-gray-800/40">
                  <td className="py-1 font-mono text-blue-400">{i.id}</td>
                  <td className="py-1 text-gray-300">{i.mode}</td>
                  <td className="py-1 text-right">{fmt0(i.needPieces)}</td>
                  <td className={`py-1 text-right font-semibold ${i.moqInflated ? 'text-orange-300' : 'text-white'}`}>{fmt0(i.finalQty)}</td>
                  <td className="py-1 text-right text-amber-200">{dollar(i.cost)}</td>
                  <td className="py-1 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); onWhyBuy({ ...(i.mode === 'bundle' ? { bundleId: i.id } : { coreId: i.id }), vendorName: vendor.name }); }}
                      className="text-emerald-400 hover:text-emerald-300 text-xs"
                    >📊</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 mt-2">
            <button
              onClick={onReview}
              className="text-xs bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-200 rounded px-3 py-1"
            >Review in Purchasing tab →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Q4 Widget ────────────────────────────────────────────────
function Q4Widget({ data, vendorRecs, segMap, vMap, onReview }) {
  const issues = useMemo(() => {
    const out = [];
    for (const rec of Object.values(vendorRecs || {})) {
      if (!rec) continue;
      const v = vMap[rec.vendor];
      const lt = rec.leadTime || v?.lt || 30;
      for (const bd of (rec.bundleDetails || [])) {
        const seg = segMap?.[bd.bundleId]?.effective || bd.segment;
        if (seg !== 'SEASONAL_PEAKED') continue;
        const inputs = bd.forecast?.inputs || {};
        const dtp = inputs.daysUntilPeak;
        if (dtp == null) continue;
        const window = lt + 30;
        if (dtp <= window && dtp >= 0) {
          // Already covered if buyNeed === 0 and inventory > coverageDemand
          const covered = bd.buyNeed === 0;
          if (!covered) {
            out.push({
              vendor: rec.vendor, bundleId: bd.bundleId,
              daysUntilPeak: dtp, leadTime: lt, buyNeed: bd.buyNeed,
            });
          }
        }
      }
    }
    return out;
  }, [vendorRecs, segMap, vMap]);

  if (issues.length === 0) return null;
  const vendors = [...new Set(issues.map(i => i.vendor))];
  return (
    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-purple-300 text-lg">⚠</span>
        <div className="flex-1">
          <h3 className="text-purple-200 font-semibold text-sm">Q4 / peak prep</h3>
          <p className="text-xs text-gray-300">
            {issues.length} seasonal-peaked bundles across {vendors.length} vendors need POs now to land before their peak.
          </p>
          <div className="text-[11px] text-gray-400 mt-1">
            Closest peaks: {issues.slice(0, 3).map(i => `${i.bundleId} (${i.daysUntilPeak}d)`).join(', ')}
            {issues.length > 3 ? `, +${issues.length - 3} more` : ''}.
          </div>
          <button
            onClick={() => onReview && onReview(vendors)}
            className="mt-2 text-xs bg-purple-600 text-white rounded px-3 py-1 hover:bg-purple-500"
          >
            Review peak SKUs →
          </button>
        </div>
      </div>
    </div>
  );
}

function isUSVendor(v) {
  const c = (v?.country || '').toLowerCase().trim();
  return c === '' || c === 'us' || c === 'usa' || c === 'united states';
}

// ─── Main tab ─────────────────────────────────────────────────
export default function TodaysActionTab({
  data, stg, vendorRecs, goVendor, workflow,
  saveWorkflow, deleteWorkflow, vendorComments, saveVendorComment,
  onEnterPurchasing,
}) {
  const segCtx = useContext(SegmentCtx);
  const whyBuy = useContext(WhyBuyCtx);
  const [originFilter, setOriginFilter] = useState('all'); // 'all' | 'us' | 'intl'
  const [workflowFilter, setWorkflowFilter] = useState('all'); // 'all' | 'untriaged' | 'Buy' | 'Reviewing' | 'Done' | 'Ignore'

  const vMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => m[v.name] = v);
    return m;
  }, [data.vendors]);

  const vendorList = useMemo(() => {
    const out = [];
    for (const v of (data.vendors || [])) {
      // Apply origin filter
      const us = isUSVendor(v);
      if (originFilter === 'us' && !us) continue;
      if (originFilter === 'intl' && us) continue;
      const rec = vendorRecs?.[v.name];
      const u = vendorUrgency(rec);
      if (u.tier === 'none') continue;
      out.push({ vendor: v, rec, urgency: u });
    }
    out.sort((a, b) => {
      // critical first, then warning, then by cost desc
      const ta = a.urgency.tier === 'critical' ? 0 : 1;
      const tb = b.urgency.tier === 'critical' ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return b.urgency.cost - a.urgency.cost;
    });
    return out;
  }, [data.vendors, vendorRecs, originFilter]);

  const totals = useMemo(() => {
    const t = { critical: 0, warning: 0, cost: 0 };
    for (const v of vendorList) {
      if (v.urgency.tier === 'critical') t.critical++;
      else if (v.urgency.tier === 'warning') t.warning++;
      t.cost += v.urgency.cost;
    }
    return t;
  }, [vendorList]);

  // KPIs
  const stockoutFreeStreak = useMemo(() => {
    // Approx: days since last day where any A bundle had 0 sales while expected to.
    // We don't have stockout history; show "—" for now.
    return null;
  }, []);

  const nextLanding = useMemo(() => {
    let earliest = null;
    for (const r of (data.inbound || [])) {
      const eta = r.eta;
      if (!eta) continue;
      const d = new Date(eta);
      if (!isNaN(d.getTime()) && d > new Date()) {
        if (!earliest || d < earliest) earliest = d;
      }
    }
    return earliest;
  }, [data.inbound]);

  const [poFlowOpen, setPoFlowOpen] = useState(false);
  const [poFlowVendors, setPoFlowVendors] = useState([]);
  const [poSummary, setPoSummary] = useState(null);

  const startPoFlow = (which = 'critical') => {
    const list = vendorList
      .filter(v => which === 'all' || v.urgency.tier === which)
      .map(v => v.vendor);
    if (!list.length) return;
    setPoFlowVendors(list);
    setPoFlowOpen(true);
    setPoSummary(null);
  };

  const handlePoFlowComplete = (generated) => {
    const total = generated.reduce((s, g) => s + (g.totalCost || 0), 0);
    setPoSummary({ count: generated.length, total, drafts: generated.filter(g => g.mode === 'draft').length });
    setPoFlowOpen(false);
  };

  return (
    <div className="p-4">
      {/* Hero */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex-1">
            <h1 className="text-white font-bold text-2xl">
              {totals.critical + totals.warning > 0
                ? <>{totals.critical + totals.warning} vendors need POs today</>
                : <>No vendor needs a PO today</>
              }
              <span className="text-amber-300 ml-3 text-xl">{dollar(totals.cost)} total</span>
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {totals.critical} critical · {totals.warning} warning
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {totals.critical > 0 && (
                <button
                  onClick={() => startPoFlow('critical')}
                  className="bg-red-600 hover:bg-red-500 text-white rounded px-4 py-2 text-sm font-semibold"
                >
                  Generate Critical POs ({totals.critical})
                </button>
              )}
              {totals.critical + totals.warning > 0 && (
                <button
                  onClick={() => startPoFlow('all')}
                  className="bg-amber-600 hover:bg-amber-500 text-white rounded px-4 py-2 text-sm font-semibold"
                >
                  Include Warning ({totals.critical + totals.warning})
                </button>
              )}
              <button
                onClick={onEnterPurchasing}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 rounded px-4 py-2 text-sm"
              >
                Open Purchasing tab →
              </button>
              <select
                value={originFilter}
                onChange={e => setOriginFilter(e.target.value)}
                title="Filter vendors by origin"
                className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2"
              >
                <option value="all">All origins</option>
                <option value="us">US only</option>
                <option value="intl">International only</option>
              </select>
              <select
                value={workflowFilter}
                onChange={e => setWorkflowFilter(e.target.value)}
                title="Filter vendors by workflow status"
                className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-3 py-2"
              >
                <option value="all">All status</option>
                <option value="untriaged">Untriaged</option>
                <option value="Buy">Buy</option>
                <option value="Reviewing">Reviewing</option>
                <option value="Done">Done</option>
                <option value="Ignore">Ignore</option>
              </select>
            </div>
          </div>
          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-3 flex-shrink-0">
            <div className="bg-gray-950 border border-gray-800 rounded p-3 min-w-[110px]">
              <div className="text-gray-500 text-[10px] uppercase">Stockout-free</div>
              <div className="text-white font-bold text-lg">{stockoutFreeStreak == null ? '—' : `${stockoutFreeStreak}d`}</div>
              <div className="text-gray-600 text-[10px]">A items</div>
            </div>
            <div className="bg-gray-950 border border-gray-800 rounded p-3 min-w-[110px]">
              <div className="text-gray-500 text-[10px] uppercase">Next landing</div>
              <div className="text-white font-bold text-lg">
                {nextLanding ? fSl(nextLanding.toISOString().slice(0, 10)) : '—'}
              </div>
              <div className="text-gray-600 text-[10px]">7f ETA</div>
            </div>
            <div className="bg-gray-950 border border-gray-800 rounded p-3 min-w-[110px]">
              <div className="text-gray-500 text-[10px] uppercase">Forecast acc.</div>
              <div className="text-white font-bold text-lg">—</div>
              <div className="text-gray-600 text-[10px]">MAPE 30d</div>
            </div>
          </div>
        </div>
      </div>

      {/* Q4 widget */}
      <Q4Widget
        data={data}
        vendorRecs={vendorRecs}
        segMap={segCtx.effectiveMap}
        vMap={vMap}
        onReview={(vs) => { if (vs[0]) goVendor && goVendor(vs[0]); }}
      />

      {/* Recent run summary */}
      {poSummary && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-3 mb-3 text-xs text-emerald-200">
          ✓ {poSummary.count} POs generated · {dollar(poSummary.total)} total committed
          {poSummary.drafts > 0 && (
            <span className="ml-2 text-amber-200">({poSummary.drafts} draft due to popup-blocker)</span>
          )}
          <button onClick={() => setPoSummary(null)} className="ml-3 text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Vendor list */}
      {vendorList.length === 0 ? (
        <p className="text-gray-500 text-sm py-12 text-center">
          Nothing needs ordering today. Check Purchasing tab for healthy items.
        </p>
      ) : (
        <div className="space-y-2">
          {vendorList
            .filter(({ vendor }) => {
              if (workflowFilter === 'all') return true;
              if (workflowFilter === 'untriaged') {
                const s = getEffectiveWfStatus(workflow || [], vendor.name);
                return !s;
              }
              const s = getEffectiveWfStatus(workflow || [], vendor.name);
              return s === workflowFilter;
            })
            .map(({ vendor, rec, urgency }) => (
              <VendorCard
                key={vendor.name}
                vendor={vendor}
                rec={rec}
                urgency={urgency}
                segMap={segCtx.effectiveMap}
                onReview={() => { goVendor && goVendor(vendor.name); }}
                onWhyBuy={(anchor) => whyBuy.open(anchor)}
                workflow={workflow}
                saveWorkflow={saveWorkflow}
                deleteWorkflow={deleteWorkflow}
                buyer={stg?.buyer}
              />
            ))}
        </div>
      )}

      {/* Critical PO flow modal */}
      <CriticalPOModal
        open={poFlowOpen}
        vendors={poFlowVendors}
        vendorRecs={vendorRecs || {}}
        vMap={vMap}
        stg={stg}
        onClose={() => setPoFlowOpen(false)}
        onComplete={handlePoFlowComplete}
      />
    </div>
  );
}
