// src/components/WhyBuyPanel.jsx
// ============================================================
// CANONICAL BREAKDOWN UI · single source of truth = v4 waterfall.
// Reads the structured forecast object the v4 engine attaches to
// every bundleDetail (forecast.inputs / formula / reasoning /
// projection.monthly). No re-computation here — the panel just
// renders what the engine already said.
//
// If you find yourself building another breakdown surface, please
// route through this component instead. CalcBreakdownV2 / the
// legacy `getCalcBreakdown` helper from seasonal.js were removed
// in Sprint 2 — they computed numbers that drifted from the engine.
//
// Three levels (collapsible):
//   1. Verdict + segment + formula (always visible)
//   2. Step-by-step (numbered list with concrete numbers)
//   3. Raw inputs / projection table / monthly numbers
// ============================================================

import React, { useMemo, useState } from "react";
import { SegmentBadge, ConfidenceBadge } from "./SegmentsTab";

const fmt0 = (n) => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
const fmt1 = (n) => n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(1);
const fmt2 = (n) => n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(2);
const fmtPct = (n) => n == null || !Number.isFinite(n) ? '—' : (Number(n) * 100).toFixed(1) + '%';
const dollar = (n) => n == null || !Number.isFinite(n) ? '—' : '$' + Math.round(n).toLocaleString('en-US');

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function Section({ title, children, defaultOpen = false, accent }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-lg border ${accent || 'border-gray-800'} mb-3 overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-3 py-2 flex items-center justify-between bg-gray-900/60 hover:bg-gray-900"
      >
        <span className="text-white font-semibold text-sm">{title}</span>
        <span className="text-gray-500 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 py-3 bg-gray-950/60 text-xs text-gray-200">{children}</div>}
    </div>
  );
}

function BundleAuditCard({ bundle, segRec, vendor, vendorRec }) {
  const fc = bundle.forecast || {};
  const inputs = fc.inputs || {};
  const projection = fc.projection || { monthly: [], total: 0 };
  const total = bundle.coverageDemand;
  const safety = bundle.safetyStock?.amount ?? Math.round(fc.safetyStock || 0);
  const totalAvail = bundle.totalAvailable ?? 0;
  const buyNeed = bundle.buyNeed ?? 0;

  // Build a verdict sentence
  const verdictParts = [];
  if (buyNeed > 0) {
    verdictParts.push(`Buy ${fmt0(buyNeed)} ${bundle.buyMode === 'bundle' ? 'bundles' : 'units'}.`);
  } else {
    verdictParts.push(`No buy needed today.`);
  }
  verdictParts.push(`Coverage demand: ${fmt0(total)} u over ${inputs.targetDoc || bundle.targetDOC || 180}d.`);
  verdictParts.push(`Available: ${fmt0(totalAvail)} u.`);

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 mb-3">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-blue-400">{bundle.bundleId}</span>
            {segRec && (
              <SegmentBadge
                segment={segRec.segment || bundle.segment || fc.segment}
                override={segRec?.override !== segRec?.segment ? segRec?.override : null}
                small
              />
            )}
            {segRec?.confidence && <ConfidenceBadge confidence={segRec.confidence} />}
            {bundle.urgent && <span className="text-[10px] bg-red-500/25 text-red-300 px-1.5 py-0.5 rounded">URGENT (LT shortage)</span>}
          </div>
          <p className="text-xs text-gray-300 mt-1">{verdictParts.join(' ')}</p>
          {fc.formula && (
            <p className="text-[11px] text-emerald-300/80 mt-1 font-mono">{fc.formula}</p>
          )}
        </div>
      </div>

      {/* Level 1 numbers */}
      <div className="grid grid-cols-4 gap-2 mb-2">
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Need</div>
          <div className="text-white font-bold">{fmt0(buyNeed)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Coverage demand</div>
          <div className="text-white font-bold">{fmt0(total)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Safety stock</div>
          <div className="text-white font-bold">{fmt0(safety)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Available</div>
          <div className="text-white font-bold">{fmt0(totalAvail)}</div>
        </div>
      </div>

      {/* Level 2: Step-by-step */}
      <Section title="Step-by-step (how this number was built)" defaultOpen={true} accent="border-emerald-500/30">
        <ol className="list-decimal list-inside space-y-2">
          <li>
            <b>Segment classification.</b>{' '}
            <span className="text-gray-300">
              {segRec?.segment || fc.segment || 'STABLE'} (confidence {segRec?.confidence || 'medium'})
            </span>
            {segRec?.reason && (
              <div className="ml-5 text-gray-400 text-[11px]">— {segRec.reason}</div>
            )}
          </li>

          {fc.reasoning && fc.reasoning.length > 0 && (
            <li>
              <b>Forecast reasoning.</b>
              <ul className="ml-5 list-disc text-gray-300 text-[11px] space-y-0.5">
                {fc.reasoning.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </li>
          )}

          {projection.monthly && projection.monthly.length > 0 && (
            <li>
              <b>Per-month projection.</b>
              <table className="w-full mt-1 text-[11px] border border-gray-800">
                <thead className="bg-gray-900 text-gray-500 uppercase">
                  <tr>
                    <th className="px-2 py-1 text-left">Month</th>
                    <th className="px-2 py-1 text-right">Days</th>
                    <th className="px-2 py-1 text-right">Proj DSR</th>
                    <th className="px-2 py-1 text-right">Factor</th>
                    <th className="px-2 py-1 text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.monthly.map((m, i) => (
                    <tr key={i} className="border-t border-gray-800/60">
                      <td className="px-2 py-0.5 text-gray-300">{MO[m.month - 1]} {m.year}</td>
                      <td className="px-2 py-0.5 text-right">{m.days}</td>
                      <td className="px-2 py-0.5 text-right">{fmt2(m.projDsr)}</td>
                      <td className="px-2 py-0.5 text-right">{fmt2(m.avgFactor || 1)}</td>
                      <td className="px-2 py-0.5 text-right text-white">{fmt0(m.units)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-700 font-semibold">
                    <td className="px-2 py-0.5">Total</td>
                    <td className="px-2 py-0.5 text-right">
                      {projection.monthly.reduce((s, m) => s + m.days, 0)}
                    </td>
                    <td className="px-2 py-0.5" />
                    <td className="px-2 py-0.5" />
                    <td className="px-2 py-0.5 text-right text-white">{fmt0(projection.total)}</td>
                  </tr>
                </tbody>
              </table>
            </li>
          )}

          <li>
            <b>Safety stock.</b>{' '}
            <span className="text-gray-300">
              {fc.Z != null && fc.sigmaLT != null
                ? `Z(${fmt2(fc.Z)}) × σ_LT(${fmt1(fc.sigmaLT)}) = ${fmt0(safety)} u`
                : `${fmt0(safety)} u`}
            </span>
            {bundle.safetyStock?.fallback && (
              <span className="ml-2 text-[10px] text-amber-400">(fallback — limited history)</span>
            )}
          </li>

          <li>
            <b>Coverage demand (total).</b>{' '}
            <span className="text-gray-300">{fmt0(projection.total)} + {fmt0(safety)} = {fmt0(total)} u</span>
          </li>

          <li>
            <b>Inventory available (after waterfall).</b>
            <ul className="ml-5 text-gray-300 text-[11px] space-y-0.5">
              <li>Assigned (FIB+PPRC+JFN+Inb 7f): {fmt0(bundle.assignedInv)}</li>
              <li>Raw assigned from waterfall: {fmt0(bundle.rawAssignedFromWaterfall)}</li>
              <li>Total available: <b className="text-white">{fmt0(totalAvail)}</b></li>
            </ul>
          </li>

          <li>
            <b>Buy need.</b>{' '}
            <span className="text-gray-300">max(0, {fmt0(total)} − {fmt0(totalAvail)}) = {fmt0(buyNeed)} u</span>
          </li>

          {bundle.buyModeReason && (
            <li>
              <b>Buy mode.</b>{' '}
              <span className="text-gray-300">
                {bundle.buyMode}
                {' — '}
                {bundle.buyModeReason === 'bundle-history' && 'this exact bundle has receiving history with the vendor as a finished bundle'}
                {bundle.buyModeReason === 'vendor-fallback' && 'no bundle-specific history, but the vendor has historically delivered other bundles as finished — treating as bundle vendor'}
                {bundle.buyModeReason === 'core-default' && 'no evidence the vendor ships finished bundles → buy as raw cores and assemble in-house'}
                {bundle.buyModeReason === 'force-bundles' && 'forced by user (Force Bundles)'}
                {bundle.buyModeReason === 'force-cores' && 'forced by user (Force Cores)'}
              </span>
            </li>
          )}

          {bundle.bundleMoqStatus && bundle.bundleMoqStatus !== 'meets_moq' && (
            <li>
              <b>Bundle MOQ adjustment.</b>{' '}
              <span className="text-gray-300">
                {bundle.bundleMoqOriginalNeed} → {bundle.buyNeed} ({bundle.bundleMoqStatus.replace(/_/g, ' ')}, +{bundle.bundleMoqExtraDOC}d)
              </span>
              {bundle.bundleMoqOptions && (
                <div className="ml-5 mt-1 text-[11px] text-gray-300 space-y-1">
                  <div className="text-amber-300">Need ({fmt0(bundle.bundleMoqOriginalNeed)}) is below the bundle MOQ. Three options — recommender does NOT pick one automatically:</div>
                  <div className="bg-gray-900/60 border border-gray-800 rounded px-2 py-1">
                    <b className="text-emerald-300">(a) Buy MOQ anyway:</b>{' '}
                    qty {fmt0(bundle.bundleMoqOptions.a_buyMoq?.qty)}, adds ~{bundle.bundleMoqOptions.a_buyMoq?.extraDOC}d of extra cover.
                  </div>
                  <div className="bg-gray-900/60 border border-gray-800 rounded px-2 py-1">
                    <b className="text-blue-300">(b) Switch to core mode:</b>{' '}
                    use Force Cores in the Purchasing tab — buys the components as raw and assembles in-house.
                  </div>
                  <div className="bg-gray-900/60 border border-gray-800 rounded px-2 py-1">
                    <b className="text-purple-300">(c) Throttle demand:</b>{' '}
                    raise the Amazon price for this bundle until demand catches up. Gap: {fmt0(bundle.bundleMoqOptions.c_throttle?.gapUnits)} units.
                  </div>
                </div>
              )}
            </li>
          )}
        </ol>
      </Section>

      {/* Level 3: Raw data */}
      <Section title="Raw inputs (what the formula consumed)" defaultOpen={false} accent="border-blue-500/30">
        <pre className="text-[10px] text-gray-300 whitespace-pre-wrap break-words bg-gray-950 border border-gray-800 rounded p-2 overflow-x-auto">
{JSON.stringify(inputs, null, 2)}
        </pre>
      </Section>
    </div>
  );
}

function CoreAuditCard({ core, vendor, vendorRec }) {
  if (!core) return null;
  const ratio = core.moqInflationRatio || 1;
  const inflated = core.moqInflated || ratio >= 1.5;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-blue-400">{core.coreId}</span>
        {core.urgent && <span className="text-[10px] bg-red-500/25 text-red-300 px-1.5 py-0.5 rounded">URGENT</span>}
        {inflated && <span className="text-[10px] bg-orange-500/25 text-orange-300 px-1.5 py-0.5 rounded">MOQ INFLATED ×{ratio.toFixed(2)}</span>}
        {core.intermittentExcess && <span className="text-[10px] bg-red-500/25 text-red-300 px-1.5 py-0.5 rounded">INTERMITTENT EXCESS</span>}
      </div>
      <div className="grid grid-cols-4 gap-2 mb-2">
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Real need</div>
          <div className="text-white font-bold">{fmt0(core.needPieces)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Final qty (w/ MOQ)</div>
          <div className={`font-bold ${inflated ? 'text-orange-300' : 'text-white'}`}>{fmt0(core.finalQty)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Cost</div>
          <div className="text-amber-300 font-bold">{dollar(core.cost)}</div>
        </div>
        <div className="bg-gray-900 rounded p-2">
          <div className="text-gray-500 text-[10px] uppercase">Bundles driving</div>
          <div className="text-white font-bold">{core.bundlesAffected || 0}</div>
        </div>
      </div>
      {inflated && (
        <p className="text-[11px] text-orange-300 mb-1">
          MOQ forces buying {fmt0(core.excessFromMoq)} u above real need ({dollar(core.excessCostFromMoq)} excess).
          MOQ {fmt0(core.moqOriginal)}, credit from bundles {fmt0(core.moqCredit || 0)}, effective {fmt0(core.moqEffective || 0)}.
        </p>
      )}
      {core.bundlesAffectedIds && core.bundlesAffectedIds.length > 0 && (
        <p className="text-[11px] text-gray-400">
          Driving bundles: <span className="font-mono">{core.bundlesAffectedIds.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

export default function WhyBuyPanel({ open, onClose, anchor, vendorRecs, segmentMap, data }) {
  if (!open || !anchor) return null;

  // anchor: { coreId?, bundleId?, vendorName? }
  //
  // Resolution order (each step falls through if it misses):
  //   1. Exact vendorName match in vendorRecs
  //   2. Case-insensitive trimmed vendorName match (handles "Co., Ltd"
  //      style names that get mangled by naive `.split(',')[0]` callers
  //      in BundleTab and elsewhere)
  //   3. Content scan: first vendorRec that contains this bundleId or
  //      coreId. This is the safety net that prevents the modal from
  //      rendering "No recommendation found" when the caller passed a
  //      vendor name that doesn't exactly match a vendorRecs key.
  const vendorRec = useMemo(() => {
    const recs = vendorRecs || {};
    if (anchor.vendorName) {
      if (recs[anchor.vendorName]) return recs[anchor.vendorName];
      const target = anchor.vendorName.toLowerCase().trim();
      for (const [k, v] of Object.entries(recs)) {
        if (v && k.toLowerCase().trim() === target) return v;
      }
    }
    for (const rec of Object.values(recs)) {
      if (!rec) continue;
      if (anchor.bundleId && rec.bundleDetails?.some(bd => bd.bundleId === anchor.bundleId)) return rec;
      if (anchor.coreId && rec.coreDetails?.some(cd => cd.coreId === anchor.coreId)) return rec;
    }
    return null;
  }, [vendorRecs, anchor]);

  const bundles = useMemo(() => {
    if (!vendorRec) return [];
    if (anchor.bundleId) {
      const bd = vendorRec.bundleDetails?.find(b => b.bundleId === anchor.bundleId);
      return bd ? [bd] : [];
    }
    if (anchor.coreId) {
      return (vendorRec.bundleDetails || []).filter(bd =>
        (bd.coresUsed || []).some(c => c.coreId === anchor.coreId)
      );
    }
    return [];
  }, [vendorRec, anchor]);

  const core = useMemo(() => {
    if (!vendorRec || !anchor.coreId) return null;
    return vendorRec.coreDetails?.find(c => c.coreId === anchor.coreId) || null;
  }, [vendorRec, anchor]);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative ml-auto w-full max-w-3xl bg-gray-950 border-l border-gray-800 overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="text-white font-bold text-lg">Why buy?</span>
            <span className="text-xs text-gray-500">
              {anchor.coreId ? `Core ${anchor.coreId}` : ''}
              {anchor.bundleId ? `Bundle ${anchor.bundleId}` : ''}
              {anchor.vendorName ? ` · ${anchor.vendorName}` : ''}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-4">
          {!vendorRec && (
            <p className="text-gray-400 text-sm">
              No recommendation found for this {anchor.bundleId ? 'bundle' : 'core'}.
              The engine may still be calculating — try again in a moment.
            </p>
          )}

          {core && <CoreAuditCard core={core} vendor={anchor.vendorName} vendorRec={vendorRec} />}

          {bundles.length === 0 && vendorRec && !core && (
            <p className="text-gray-400 text-sm">No bundle details available.</p>
          )}

          {bundles.map(bd => (
            <BundleAuditCard
              key={bd.bundleId}
              bundle={bd}
              segRec={segmentMap?.[bd.bundleId] || null}
              vendor={anchor.vendorName}
              vendorRec={vendorRec}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
