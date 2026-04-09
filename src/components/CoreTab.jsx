import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { R, D1, $, $2, P, MN, YC, TTP, BL, TL, gS, cAI, cNQ, cOQ, cDA, gTD, dc, fE, fD, cMo, gY, cSeas } from "../lib/utils";
import { Dot, TH, SumCtx } from "./Shared";
import { batchProfiles, batchBundleProfiles, calcCoverageNeed, calcPurchaseFrequency, DEFAULT_PROFILE } from "../lib/seasonal";
import { calcVendorRecommendation } from "../lib/recommender";

// Clickable cell for Quick Sum
function SC({ v, children, className }) {
  const { addCell } = React.useContext(SumCtx);
  const [sel, setSel] = React.useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

function BundlesTable({ cB, core, stg, ven, replenMap, missingMap, agedMap, killMap, goBundle, bT, saM, vendorRec, allCores }) {
  const [editVals, setEditVals] = React.useState({});
  const restockTarget = ven && (ven.country || "").toLowerCase().trim().match(/^(us|usa|united states)?$/) ? (stg.domesticDoc || 90) : (stg.intlDoc || 180);

  // Bundle details from vendor rec (authoritative — same source as PurchTab)
  const bundleDetailsMap = React.useMemo(() => {
    const m = {};
    (vendorRec?.bundleDetails || []).forEach(bd => { m[bd.bundleId] = bd; });
    return m;
  }, [vendorRec]);

  // Map of core ID → raw available
  const coreRawMap = React.useMemo(() => {
    const m = {};
    (allCores || []).forEach(c => { m[c.id] = c.raw || 0 });
    return m;
  }, [allCores]);

  const getBundleCores = (b) => {
    const cores = [];
    for (let i = 1; i <= 20; i++) {
      const cid = b['core' + i];
      const qty = b['qty' + i];
      if (cid && qty > 0) cores.push({ id: cid, qty });
    }
    return cores;
  };

  // Remaining raw after user's allocation in Edit column
  const coreRemaining = React.useMemo(() => {
    const remaining = { ...coreRawMap };
    cB.forEach(b => {
      const v = editVals[b.j] || 0;
      if (v <= 0) return;
      getBundleCores(b).forEach(({ id, qty }) => {
        if (remaining[id] != null) remaining[id] -= v * qty;
      });
    });
    return remaining;
  }, [editVals, cB, coreRawMap]);

  const rawAvailable = coreRemaining[core?.id] != null ? coreRemaining[core.id] : (core?.raw || 0);

  return (
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">
          Bundles ({cB.length})
        </h3>
        <div className="text-xs text-gray-400">
          Core Raw: <span className="text-white font-semibold">{R(core?.raw || 0)}</span> ·
          Available: <span className={`font-semibold ${rawAvailable < 0 ? "text-red-400" : "text-emerald-400"}`}>{R(rawAvailable)}</span>
        </div>
      </div>
      {cB.length > 0 ? (
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 uppercase">
            <th className="py-2 px-1 text-left">JLS#</th>
            <th className="py-2 px-1 text-left">Name</th>
            <TH tip="FIB DOC" className="py-2 px-1 text-right">FIB DOC</TH>
            <TH tip="Current cover DOC (v2 waterfall)" className="py-2 px-1 text-right">Eff DOC</TH>
            <TH tip="Complete DSR" className="py-2 px-1 text-right">C.DSR</TH>
            <TH tip="Gross Profit" className="py-2 px-1 text-right">GP</TH>
            <TH tip="Margin %" className="py-2 px-1 text-right">Margin</TH>
            <TH tip="Raw Units" className="py-2 px-1 text-right">Raw</TH>
            <TH tip="Batched" className="py-2 px-1 text-right">Batch</TH>
            <TH tip="SC Inventory" className="py-2 px-1 text-right">SC Inv</TH>
            <TH tip="PPRCD Units" className="py-2 px-1 text-right">PPRCD</TH>
            <TH tip="7f Inbound" className="py-2 px-1 text-right">7f Inb</TH>
            <TH tip={"Restock need to reach " + restockTarget + "d (from v2 recommender)"} className="py-2 px-1 text-right">Restock</TH>
            <TH tip="Buy mode chosen by recommender" className="py-2 px-1 text-center">Mode</TH>
            <TH tip="Editable allocation (consumes raw from all cores used)" className="py-2 px-1 text-center">Edit</TH>
            <TH tip="Potential = min(remaining of each core ÷ qty per bundle)" className="py-2 px-1 text-right">Potential</TH>
            <th className="py-2 px-1 w-8" />
          </tr></thead>
          <tbody>
            {cB.map(b => {
              const f = b.fee;
              const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0;
              const aged = agedMap[b.j]; const kill = killMap[b.j];
              const rp = replenMap.find ? replenMap.find(r => r.j === b.j) : replenMap[b.j];
              const inb7f = missingMap[b.j] || 0;
              const editVal = editVals[b.j] || 0;

              const bd = bundleDetailsMap[b.j];
              const restockRec = bd?.buyNeed || 0;
              const effDOC = bd?.currentCoverDOC || 0;
              const buyMode = bd?.buyMode || '—';
              const isUrgent = bd?.urgent;

              const bCores = getBundleCores(b);
              let potential = 0;
              let constraintCore = null;
              if (bCores.length > 0) {
                potential = Infinity;
                bCores.forEach(({ id, qty }) => {
                  const rem = coreRemaining[id] != null ? coreRemaining[id] : (coreRawMap[id] || 0);
                  const possible = qty > 0 ? Math.floor(rem / qty) : 0;
                  if (possible < potential) {
                    potential = possible;
                    constraintCore = id;
                  }
                });
                if (potential === Infinity) potential = 0;
                if (potential < 0) potential = 0;
              }

              return (
                <tr key={b.j} className={`border-t border-gray-800/50 hover:bg-gray-800/20 ${isUrgent ? "bg-red-900/10" : ""}`}>
                  <td className="py-1.5 px-1 text-blue-400 font-mono">{b.j}</td>
                  <td className="py-1.5 px-1 text-gray-200 truncate max-w-[130px]">
                    {b.t}
                    {isUrgent && <span className="ml-1 text-red-400 font-bold text-[10px]">⚠OOS</span>}
                    {aged && aged.fbaHealth !== "Healthy" && (
                      <span className={`ml-1 ${aged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{aged.fbaHealth}</span>
                    )}
                    {aged && aged.storageLtsf > 0 && <span className="ml-1 text-red-300">${aged.storageLtsf.toFixed(0)}
