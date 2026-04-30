import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceDot } from "recharts";
import { R, D1, $, $2, P, MN, YC, TTP, BL, TL, gS, cAI, cNQ, cOQ, cDA, gTD, dc, fE, fD, cMo, gY, cSeas } from "../lib/utils";
import { Dot, TH, SumCtx } from "./Shared";
import { batchProfiles, calcCoverageNeed, calcPurchaseFrequency, DEFAULT_PROFILE } from "../lib/seasonal";
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

function BundlesTable({ cB, core, stg, ven, replenMap, missingMap, agedMap, killMap, goBundle, vendorRec, allCores }) {
  const [editVals, setEditVals] = React.useState({});
  const restockTarget = ven && (ven.country || "").toLowerCase().trim().match(/^(us|usa|united states)?$/) ? (stg.domesticDoc || 90) : (stg.intlDoc || 180);
  const replenByJ = React.useMemo(() => { const m = {}; (replenMap || []).forEach(r => { m[r.j] = r }); return m }, [replenMap]);

  // Bundle details map from v2 recommender (authoritative — same numbers as PurchTab)
  const bundleDetailsMap = React.useMemo(() => {
    const m = {};
    (vendorRec?.bundleDetails || []).forEach(bd => { m[bd.bundleId] = bd; });
    return m;
  }, [vendorRec]);

  // Map of core ID → raw available (from full data.cores)
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

  // Remaining raw after user's Edit-column allocations
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
        <h3 className="text-white font-semibold text-sm">Bundles ({cB.length})</h3>
        <div className="text-xs text-gray-400">
          Core Raw: <span className="text-white font-semibold">{R(core?.raw || 0)}</span> ·
          Available: <span className={`font-semibold ${rawAvailable < 0 ? "text-red-400" : "text-emerald-400"}`}>{R(rawAvailable)}</span>
          {!vendorRec && <span className="ml-2 text-amber-400">⚠ no recommender data for this vendor</span>}
        </div>
      </div>
      {cB.length > 0 ? (
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 uppercase">
            <th className="py-2 px-1 text-left">JLS#</th>
            <th className="py-2 px-1 text-left">Name</th>
            <TH tip="FIB DOC" className="py-2 px-1 text-right">FIB DOC</TH>
            <TH tip="Effective DOC after v2 waterfall (consistent with PurchTab)" className="py-2 px-1 text-right">Eff DOC</TH>
            <TH tip="Complete DSR" className="py-2 px-1 text-right">C.DSR</TH>
            <TH tip="Gross Profit" className="py-2 px-1 text-right">GP</TH>
            <TH tip="All-In COGS" className="py-2 px-1 text-right">AICOGS</TH>
            <TH tip="Margin %" className="py-2 px-1 text-right">Margin</TH>
            <TH tip="Raw Units" className="py-2 px-1 text-right">Raw</TH>
            <TH tip="Batched" className="py-2 px-1 text-right">Batch</TH>
            <TH tip="SC Inventory" className="py-2 px-1 text-right">SC Inv</TH>
            <TH tip="PPRCD Units" className="py-2 px-1 text-right">PPRCD</TH>
            <TH tip="7f Inbound" className="py-2 px-1 text-right">7f Inb</TH>
            <TH tip={"Recommended bundle units to reach " + restockTarget + "d target (from v2 recommender)"} className="py-2 px-1 text-right">Restock</TH>
            <TH tip="Buy mode chosen by recommender (bundle vs core form)" className="py-2 px-1 text-center">Mode</TH>
            <TH tip="Editable allocation (consumes raw from all cores used)" className="py-2 px-1 text-center">Edit</TH>
            <TH tip="Potential = min(remaining of each core ÷ qty per bundle)" className="py-2 px-1 text-right">Potential</TH>
            <th className="py-2 px-1 w-8" />
          </tr></thead>
          <tbody>
            {cB.map(b => {
              const f = b.fee;
              const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0;
              const aged = agedMap[b.j]; const kill = killMap[b.j];
              const rp = replenByJ[b.j];
              const inb7f = missingMap[b.j] || 0;
              const editVal = editVals[b.j] || 0;

              const bd = bundleDetailsMap[b.j];
              const restockRec = bd?.buyNeed || 0;
              const effDOC = bd?.currentCoverDOC;
              const buyMode = bd?.buyMode;
              const isUrgent = bd?.urgent;

              const bCores = getBundleCores(b);
              let potential = 0;
              let constraintCore = null;
              if (bCores.length > 0) {
                potential = Infinity;
                bCores.forEach(({ id, qty }) => {
                  const rem = coreRemaining[id] != null ? coreRemaining[id] : (coreRawMap[id] || 0);
                  const possible = qty > 0 ? Math.floor(rem / qty) : 0;
                  if (possible < potential) { potential = possible; constraintCore = id; }
                });
                if (potential === Infinity) potential = 0;
                if (potential < 0) potential = 0;
              }

              return (
                <tr key={b.j} className={`border-t border-gray-800/50 hover:bg-gray-800/20 ${isUrgent ? "bg-red-900/10" : ""}`}>
                  <td className="py-1.5 px-1 text-blue-400 font-mono">{b.j}</td>
                  <td className="py-1.5 px-1 text-gray-200 truncate max-w-[130px]">
                    {b.t}
                    {isUrgent && <span className="ml-1 text-red-400 font-bold text-[10px]" title="Will stockout before LT arrives">⚠OOS</span>}
                    {aged && aged.fbaHealth !== "Healthy" && (
                      <span className={`ml-1 ${aged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{aged.fbaHealth}</span>
                    )}
                    {aged && aged.storageLtsf > 0 && <span className="ml-1 text-red-300">${aged.storageLtsf.toFixed(0)}</span>}
                    {kill && kill.forKill === "Yes" && <span className="ml-1 text-red-400 font-bold">KILL</span>}
                    {kill && kill.sellEval && kill.sellEval.toLowerCase().includes('sell') && <span className="ml-1 text-amber-400 font-bold">ST</span>}
                  </td>
                  <td className="py-1.5 px-1 text-right">{R(b.fibDoc)}</td>
                  <td className={`py-1.5 px-1 text-right font-semibold ${effDOC == null ? "text-gray-600" : effDOC <= 30 ? "text-red-400" : effDOC <= 60 ? "text-amber-400" : "text-emerald-400"}`}>{effDOC != null ? R(effDOC) : "—"}</td>
                  <td className="py-1.5 px-1 text-right">{D1(b.cd)}</td>
                  <td className="py-1.5 px-1 text-right text-emerald-400">{f ? $2(f.gp) : "—"}</td>
                  <td className="py-1.5 px-1 text-right">{f ? $2(f.aicogs) : "—"}</td>
                  <td className="py-1.5 px-1 text-right">{margin > 0 ? P(margin) : "—"}</td>
                  <td className="py-1.5 px-1 text-right">{R(rp?.rawUnits || 0)}</td>
                  <td className="py-1.5 px-1 text-right">{R(rp?.batched || 0)}</td>
                  <td className="py-1.5 px-1 text-right">{R(b.scInv)}</td>
                  <td className="py-1.5 px-1 text-right">{R(rp?.pprcUnits || 0)}</td>
                  <td className={`py-1.5 px-1 text-right ${inb7f > 0 ? "text-red-400" : "text-gray-600"}`}>{inb7f > 0 ? R(inb7f) : "—"}</td>
                  <td className={`py-1.5 px-1 text-right font-semibold ${restockRec > 0 ? "text-amber-300" : "text-gray-600"}`}>{restockRec > 0 ? R(restockRec) : "—"}</td>
                  <td className={`py-1.5 px-1 text-center text-[10px] font-semibold ${buyMode === 'bundle' ? "text-cyan-400" : buyMode === 'core' ? "text-purple-400" : "text-gray-600"}`}>{buyMode || "—"}</td>
                  <td className="py-1 px-1 text-center">
                    <input type="number" min="0" value={editVal || ""}
                      onChange={e => { const v = parseInt(e.target.value) || 0; setEditVals(p => ({ ...p, [b.j]: v })); }}
                      className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-1 py-0.5 w-16 text-center" placeholder="0" />
                  </td>
                  <td className={`py-1.5 px-1 text-right font-semibold ${potential > 0 ? "text-cyan-300" : "text-gray-600"}`} title={constraintCore ? "Limited by " + constraintCore : ""}>{R(potential)}</td>
                  <td className="py-1.5 px-1">
                    <button onClick={() => goBundle(b.j)} className="text-blue-400 px-0.5 bg-blue-400/10 rounded">V</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="text-gray-500 text-sm">No bundles.</p>}
    </div>
  );
}

export default function CoreTab({ data, stg, hist, daily, coreId, onBack, goBundle }) {
  const [s, setS] = useState("");
  const [sel, setSel] = useState(coreId || null);
  useEffect(() => { if (coreId) setSel(coreId) }, [coreId]);

  const core = sel ? (data.cores || []).find(c => c.id === sel) : null;
  const ven = core ? (data.vendors || []).find(v => v.name === core.ven) : null;
  const lt = ven?.lt || 30; const tg = gTD(ven, stg);
  const feM = useMemo(() => { const m = {}; (data.fees || []).forEach(f => m[f.j] = f); return m }, [data.fees]);
  const saM = useMemo(() => { const m = {}; (data.sales || []).forEach(s => m[s.j] = s); return m }, [data.sales]);
  const cH = useMemo(() => (hist?.coreInv || []).filter(h => h.core === sel), [hist, sel]);
  const cHF = cH;
  const yrs = useMemo(() => gY(cHF), [cHF]);

  // Monthly DSR chart data
  const dsrCh = useMemo(() => MN.map((m, i) => {
    const r = { month: m };
    yrs.forEach(y => {
      const h = cHF.find(x => x.y === y && x.m === i + 1);
      r["d_" + y] = h?.units > 0 ? h.units : null;
      r["oos_" + y] = (h?.oosDays && h.oosDays > 0) ? h.oosDays : null;
    });
    return r;
  }), [cHF, yrs]);

  // Sequential DSR timeline
  const dsrTimeline = useMemo(() => {
    return cHF.filter(h => h.avgDsr > 0 || h.units > 0).map(h => {
      const dsr = h.avgDsr > 0 ? h.avgDsr : (h.dataDays > 0 ? Math.round(h.units / h.dataDays * 10) / 10 : 0);
      return { date: h.y + '-' + String(h.m).padStart(2, '0'), dsr, units: h.units || 0, oos: h.oosDays || 0 };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [cHF]);

  // Bundles that reference this core
  const bA = stg.bA || "yes"; const bI = stg.bI || "blank";
  const bundleFilter = b => {
    if (bA === "yes" && b.active !== "Yes") return false;
    if (bA === "no" && b.active === "Yes") return false;
    if (bI === "blank" && !!b.ignoreUntil) return false;
    if (bI === "set" && !b.ignoreUntil) return false;
    return true;
  };
  const cBA = useMemo(() => {
    if (!core) return [];
    return (data.bundles || []).filter(b => {
      if (!bundleFilter(b)) return false;
      for (let i = 1; i <= 20; i++) if (b['core' + i] === sel) return true;
      return false;
    });
  }, [core, sel, data.bundles, stg]);

  const bIds = useMemo(() => cBA.map(b => b.j), [cBA]);
  const inbS = useMemo(() => {
    if (!sel || !data.inbound) return [];
    const ids = new Set([sel, ...bIds].map(x => (x || "").trim().toLowerCase()));
    return data.inbound.filter(s => ids.has((s.core || "").trim().toLowerCase()));
  }, [data.inbound, sel, bIds]);

  const ai = core ? cAI(core) : 0;
  const status = core ? gS(core.doc, lt, core.buf || 14, stg) : "healthy";
  const seas = core ? cSeas(core.id, hist?.coreInv || []) : null;

  // Legacy core-level profile (kept for the reference line at the bottom)
  const profile = useMemo(() => {
    if (!core) return DEFAULT_PROFILE;
    const p = batchProfiles([core], hist?.coreInv || [], daily?.coreDays || []);
    return p[core.id] || DEFAULT_PROFILE;
  }, [core, hist, daily]);
  const pf = useMemo(() => core ? calcPurchaseFrequency(core.ven, data.receivingFull || []) : null, [core, data.receivingFull]);

  // === MAPS for the v2 recommender (keyed by bundle j) ===
  const replenMapByJ = useMemo(() => {
    const m = {};
    (data.replenRec || []).forEach(r => { if (r.j) m[r.j] = r });
    return m;
  }, [data.replenRec]);

  const missingMapByJ = useMemo(() => {
    const m = {};
    (data.receiving || []).forEach(r => {
      if (r.piecesMissing > 0) {
        const k = (r.core || "").trim();
        m[k] = (m[k] || 0) + r.piecesMissing;
      }
    });
    return m;
  }, [data.receiving]);

  // === V2 VENDOR RECOMMENDATION — same source as PurchTab ===
  const vendorRec = useMemo(() => {
    if (!core || !ven) return null;
    return calcVendorRecommendation({
      vendor: ven,
      cores: data.cores || [],
      bundles: data.bundles || [],
      bundleSales: hist?.bundleSales || data._bundleSales || [],
      receivingFull: data.receivingFull || [],
      replenMap: replenMapByJ,
      missingMap: missingMapByJ,
      priceCompFull: (data.priceCompFull?.length ? data.priceCompFull : data.priceComp) || [],
      settings: stg,
      purchFreqSafety: pf?.safetyMultiplier || 1.0,
    });
  }, [core, ven, data.cores, data.bundles, hist, data.receivingFull, replenMapByJ, missingMapByJ, data.priceCompFull, stg, pf]);

  // Per-core detail from recommender
  const coreDetail = useMemo(() => {
    if (!vendorRec || !core) return null;
    return vendorRec.coreDetails?.find(x => x.coreId === core.id) || null;
  }, [vendorRec, core]);

  // Recommender numbers (authoritative)
  const sNeed = coreDetail?.needPieces || 0;
  const sOq = coreDetail?.finalQty || 0;
  const sCost = coreDetail?.cost || 0;
  const sDa = core && core.dsr > 0 ? Math.round((ai + sOq) / core.dsr) : 0;
  const moqInflated = coreDetail?.moqInflated || false;
  const moqRatio = coreDetail?.moqInflationRatio || 1;
  const excessMoq = coreDetail?.excessFromMoq || 0;
  const excessMoqCost = coreDetail?.excessCostFromMoq || 0;
  const bundlesAffected = coreDetail?.bundlesAffected || 0;
  const bundlesAffectedIds = coreDetail?.bundlesAffectedIds || [];
  const recUrgent = coreDetail?.urgent || false;

  // Legacy flat (for CV/freq display only — no longer shown as comparison)

  const minPurchase = useMemo(() => {
    if (!core || !data.receivingFull) return null;
    const recs = (data.receivingFull || []).filter(r =>
      (r.core || "").trim().toLowerCase() === core.id.toLowerCase() && r.pcs > 0 && r.vendor === core.ven
    );
    if (recs.length < 1) return null;
    const min = Math.min(...recs.map(r => r.pcs));
    return { min, count: recs.length };
  }, [core, data.receivingFull]);

  const pipe = core ? [
    { l: "Raw", v: core.raw }, { l: "Inb", v: core.inb }, { l: "PP", v: core.pp },
    { l: "JFN", v: core.jfn }, { l: "PQ", v: core.pq }, { l: "JI", v: core.ji }, { l: "FBA", v: core.fba }
  ] : [];
  const mxP = Math.max(...pipe.map(p => p.v), 1);

  const tBD = useMemo(() => cBA.reduce((s, b) => s + (b.cd || 0), 0), [cBA]);
  const agedMap = useMemo(() => { const m = {}; (data.agedInv || []).forEach(r => m[r.j] = r); return m }, [data.agedInv]);
  const killMap = useMemo(() => { const m = {}; (data.killMgmt || []).forEach(r => m[r.j] = r); return m }, [data.killMgmt]);

  const cB = useMemo(() => {
    const totL28 = cBA.reduce((s, b) => { const sa = saM[b.j]; return s + (sa?.l28U || 0) }, 0);
    return cBA.map(b => {
      const sa = saM[b.j]; const f = feM[b.j]; const l28 = sa?.l28U || 0;
      return {
        ...b, fee: f, sale: sa,
        pct: tBD > 0 ? +((b.cd / tBD) * 100).toFixed(1) : 0,
        l28pct: totL28 > 0 ? +((l28 / totL28) * 100).toFixed(1) : 0, l28
      };
    }).sort((a, b) => (a.fibDoc || 0) - (b.fibDoc || 0));
  }, [cBA, feM, saM, tBD]);

  const etaT = useMemo(() => inbS.filter(s => s.eta).map(s => fE(s.eta)).join(", "), [inbS]);
  const cDays = useMemo(() => (daily?.coreDays || []).filter(d => d.core === sel).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14), [daily, sel]);


  // === SEARCH VIEW ===
  if (!core) return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Back</button>
        <input type="text" placeholder="Search core..." value={s} onChange={e => setS(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 max-w-md text-sm" />
      </div>
      {s.length >= 2 ? (
        <div className="space-y-1">
          {(data.cores || []).filter(c => {
            const q = s.toLowerCase();
            return c.id.toLowerCase().includes(q) || c.ti.toLowerCase().includes(q);
          }).slice(0, 12).map(c => (
            <button key={c.id} onClick={() => setSel(c.id)}
              className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3">
              <Dot status={gS(c.doc, (data.vendors || []).find(v => v.name === c.ven)?.lt || 30, c.buf, stg)} />
              <span className="text-blue-400 font-mono text-sm">{c.id}</span>
              <span className="text-gray-300 text-sm truncate">{c.ti}</span>
            </button>
          ))}
        </div>
      ) : <p className="text-gray-500 text-sm">Type 2+ chars</p>}
    </div>
  );

  // === DETAIL VIEW ===
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <button onClick={() => { if (coreId) onBack(); else setSel(null); }} className="text-gray-400 hover:text-white text-sm mb-4">← Back</button>

      {/* Header */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="text-xl font-bold text-white">{core.id}</span>
          <Dot status={status} />
          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${status === "critical" ? "bg-red-500/20 text-red-400" : status === "warning" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
            {status.toUpperCase()}
          </span>
          {recUrgent && <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold border border-red-500/40" title="At least one bundle using this core will run out of stock before the next PO arrives. See 📊 breakdown for which bundles.">⚠ Stockout risk (bundle)</span>}
          {seas && <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-semibold">SEASONAL {seas.peak}</span>}
        </div>
        <p className="text-gray-300 text-sm mb-1">{core.ti}</p>
        <p className="text-gray-500 text-xs">{core.ven} · VSKU:{core.vsku || "—"} · {$2(core.cost)} · LT:{lt}d · Buf:{core.buf || 14}d · Tgt:{tg}d</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { l: "C.DSR", v: D1(core.dsr) },
          { l: "7D", v: D1(core.d7) },
          { l: "All-In Own Pcs", v: R(ai) },
          { l: "DOC", v: R(core.doc), c: dc(core.doc, lt, lt + (core.buf || 14)) },
          { l: "All-In Own/CDSR", v: core.dsr > 0 ? R(Math.round(ai / core.dsr)) : "—" },
        ].map(k => (
          <div key={k.l} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
            <div className="text-gray-500 text-xs mb-1">{k.l}</div>
            <div className={`text-lg font-bold ${k.c || "text-white"}`}>{k.v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { l: "Inbound (sheet)", v: R(core.inb) },
          { l: "Inbound 7f", v: R(inbS.reduce((s, i) => s + (i.pieces || 0), 0)), sub: etaT },
        ].map(k => (
          <div key={k.l} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
            <div className="text-gray-500 text-xs mb-1">{k.l}</div>
            <div className={`text-lg font-bold ${k.c || "text-white"}`}>{k.v}</div>
            {k.sub && <div className="text-emerald-400 text-xs mt-1">ETA: {k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Inbound Shipments */}
      {inbS.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-3">Inbound Shipments</h3>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 uppercase">
              <th className="py-1 px-2 text-left">Order#</th>
              <th className="py-1 px-2 text-left">Core#</th>
              <th className="py-1 px-2 text-left">Title</th>
              <th className="py-1 px-2 text-left">Vendor</th>
              <th className="py-1 px-2 text-right">Pcs</th>
              <th className="py-1 px-2 text-right">Missing</th>
              <th className="py-1 px-2 text-right">ETA</th>
            </tr></thead>
            <tbody>{inbS.map((s, i) => {
              const daysLeft = s.eta ? Math.ceil((new Date(s.eta) - new Date()) / 86400000) : null;
              return (
                <tr key={i}>
                  <td className="py-1.5 px-2 text-gray-300">{s.orderNum}</td>
                  <td className="py-1.5 px-2 font-mono"><span className={s.core.startsWith('Core') ? 'text-blue-400' : 'text-indigo-400'}>{s.core}</span>{s.core.startsWith('JLS') && <span className="ml-1 text-gray-600 text-[9px]">bundle</span>}</td>
                  <td className="py-1.5 px-2 text-gray-300 truncate max-w-[140px]">{s.shortTitle || "—"}</td>
                  <td className="py-1.5 px-2 text-gray-400">{s.vendor}</td>
                  <td className="py-1.5 px-2 text-right text-white">{R(s.pieces)}</td>
                  <td className="py-1.5 px-2 text-right text-red-400">{s.piecesMissing > 0 ? R(s.piecesMissing) : "—"}</td>
                  <td className="py-1.5 px-2 text-right text-emerald-400">{s.eta ? fE(s.eta) : "—"}{daysLeft != null && <span className="ml-1 text-gray-500 text-[10px]">({daysLeft}d)</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {/* DOC Alert */}
      {cDays.length >= 3 && (() => {
        const alerts = [];
        for (let i = 0; i < Math.min(cDays.length - 1, 10); i++) {
          const d = cDays[i];
          const p = cDays[i + 1];
          if (!d || !p || p.own <= 0) continue;
          const ownDrop = p.own - d.own;
          const expectedSales = d.dsr || core.dsr || 1;
          if (ownDrop > expectedSales * 3) {
            const pctDrop = ((d.doc - p.doc) / p.doc * 100);
            alerts.push({ date: d.date, from: p.own, to: d.own, drop: ownDrop, docFrom: p.doc, docTo: d.doc, pctDrop, dsr: expectedSales, ratio: Math.round(ownDrop / expectedSales) });
          }
        }
        if (alerts.length === 0) return null;
        return <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
          <div className="text-red-400 text-sm font-semibold mb-2">⚠ Unusual inventory changes detected</div>
          <div className="space-y-1">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-gray-400">{fD(a.date)}</span>
                <span className="text-white">Own: {R(a.from)} → {R(a.to)}</span>
                <span className="text-red-400 font-semibold">{a.drop > 0 ? "−" : "+"}{R(Math.abs(a.drop))} pcs</span>
                <span className="text-gray-500">({R(a.ratio)}× daily sales)</span>
                <span className="text-gray-500">DOC: {R(a.docFrom)} → {R(a.docTo)}</span>
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-[10px] mt-2">Changes larger than 3× daily sales usually indicate data issues. Recheck before ordering.</p>
        </div>;
      })()}

      {/* Daily */}
      {cDays.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-3">Daily ({cDays.length}d)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 uppercase">
                <th className="py-1 px-1 text-left">Date</th><th className="py-1 px-1 text-right">DSR</th>
                <th className="py-1 px-1 text-right">1D</th><th className="py-1 px-1 text-right">3D</th>
                <th className="py-1 px-1 text-right">7D</th><th className="py-1 px-1 text-right">DOC</th>
                <th className="py-1 px-1 text-right">Δ#</th><th className="py-1 px-1 text-right">Δ%</th>
                <th className="py-1 px-1 text-right">Cash</th><th className="py-1 px-1 text-right">Own</th>
                <th className="py-1 px-1 text-right">Raw</th><th className="py-1 px-1 text-right">Inb</th>
                <th className="py-1 px-1 text-right">PP</th><th className="py-1 px-1 text-right">JFN</th>
                <th className="py-1 px-1 text-right">PQ</th><th className="py-1 px-1 text-right">JI</th>
                <th className="py-1 px-1 text-right">FBA</th>
              </tr></thead>
              <tbody>{cDays.map((d, i) => {
                const p = cDays[i + 1];
                const dC = p ? d.doc - p.doc : null;
                const dP = p && p.doc > 0 ? ((d.doc - p.doc) / p.doc * 100) : null;
                const bigChange = dP != null && Math.abs(dP) > 10;
                return (
                  <tr key={d.date} className={i % 2 === 0 ? "bg-gray-800/30" : ""}>
                    <td className="py-1 px-1 text-gray-300 whitespace-nowrap">{fD(d.date)}</td>
                    <td className="py-1 px-1 text-right text-white font-semibold">{D1(d.dsr)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{D1(d.d1)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{D1(d.d3)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{D1(d.d7)}</td>
                    <td className={`py-1 px-1 text-right font-semibold ${dc(d.doc, lt, lt + (core.buf || 14))}`}>{R(d.doc)}</td>
                    <td className={`py-1 px-1 text-right ${bigChange ? (dC > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold") : "text-gray-500"}`}>
                      {dC != null ? (dC > 0 ? "+" : "") + Math.round(dC) : "—"}
                    </td>
                    <td className={`py-1 px-1 text-right ${bigChange ? (dP > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold") : "text-gray-500"}`}>
                      {dP != null ? (dP > 0 ? "+" : "") + dP.toFixed(1) + "%" : "—"}
                    </td>
                    <td className="py-1 px-1 text-right text-gray-500">{$(d.cash)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.own)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.raw)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.inb)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.pp)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.jfn)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.pq)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.ji)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.fba)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

{/* Monthly DSR (YoY) */}
      {cHF.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-2">Monthly 1-Day DSR (YoY)</h3>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-w-0">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dsrCh}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  {/* OOS markers — for any (year, month) with oosDays > 0, draw a red dot at y=0 */}
                  {yrs.flatMap(y => dsrCh
                    .filter(r => r["oos_" + y] > 0)
                    .map(r => <ReferenceDot key={`oos-${y}-${r.month}`} x={r.month} y={0} r={5} fill="#ef4444" stroke="#fff" strokeWidth={1} isFront label={{ value: `${r["oos_" + y]}d`, position: 'bottom', fill: '#ef4444', fontSize: 9 }} />)
                  )}
                  <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={v => v >= 1000 ? Math.round(v / 1000) + 'K' : v} />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px", fontSize: 12 }} formatter={(v) => v != null ? Math.round(v).toLocaleString('en-US') : '—'} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {yrs.map(y => (
                    <Line key={y} dataKey={"d_" + y}
                      stroke={YC[y] || "#6b7280"} strokeWidth={2.5}
                      dot={{ r: 3, fill: YC[y] || "#6b7280", strokeWidth: 0 }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
                      connectNulls name={String(y)} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="lg:w-80 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-700">
                  <th className="py-1.5 px-1 text-left">Mo</th>
                  {yrs.map(y => (
                    <th key={y} className="py-1.5 px-2 text-right font-semibold" style={{ color: YC[y] || "#6b7280" }}>{y}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {dsrCh.map((r, i) => {
                    const hasOos = yrs.some(y => r["oos_" + y] > 0);
                    return (
                      <tr key={i} className={`${i % 2 === 0 ? "bg-gray-800/20" : ""} ${hasOos ? "border-l-2 border-red-500/60" : ""}`}>
                        <td className="py-0.5 px-1 text-gray-400">{r.month}</td>
                        {yrs.map((y, yi) => {
                          const oos = r["oos_" + y] || 0;
                          const val = r["d_" + y];
                          const prevY = yrs[yi - 1];
                          const prevVal = prevY != null ? r["d_" + prevY] : null;
                          const isCurrentYear = yi === yrs.length - 1;
                          const showPct = isCurrentYear && val != null && prevVal != null && prevVal > 0;
                          const pct = showPct ? ((val - prevVal) / prevVal * 100) : null;
                          return (
                            <SC key={y} v={val} className="py-0.5 px-2 text-right">
                              <span className="text-white">{val != null ? R(val) : ""}</span>
                              {pct != null && <span className={`ml-1 text-[9px] ${pct >= 0 ? "text-emerald-400" : "text-red-400"}`} title={`vs ${prevY}: ${prevVal}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(0)}%</span>}
                              {oos > 0 && <span className="ml-1 text-red-400 text-[9px]" title={oos + " OOS days"}>●</span>}
                            </SC>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="border-t border-gray-600 font-semibold">
                    <td className="py-1.5 px-1 text-gray-300">Avg</td>
                    {yrs.map(y => {
                      const vals = cHF.filter(h => h.y === y && h.units > 0);
                      const avg = vals.length > 0
                        ? vals.reduce((s, x) => s + (x.units || 0), 0) / vals.length
                        : 0;
                      return (
                        <SC key={y} v={avg} className="py-1.5 px-2 text-right text-white">
                          {avg > 0 ? R(avg) : ""}
                        </SC>
                      );
                    })}
                  </tr>
                  <tr className="border-t border-gray-700/50">
                    <td className="py-1 px-1 text-gray-400">Total</td>
                    {yrs.map(y => {
                      const tot = cHF.filter(h => h.y === y).reduce((s, x) => s + (x.units || 0), 0);
                      return (
                        <SC key={y} v={tot} className="py-1 px-2 text-right text-gray-300">
                          {tot > 0 ? R(tot) : ""}
                        </SC>
                      );
                    })}
                  </tr>
                  {cHF.some(x => x.oosDays > 0) && (
                    <tr className="border-t border-gray-700/50">
                      <td className="py-1 px-1 text-red-400 text-[10px]">OOS</td>
                      {yrs.map(y => {
                        const tot = cHF.filter(h => h.y === y).reduce((s, x) => s + (x.oosDays || 0), 0);
                        return (
                          <td key={y} className="py-1 px-2 text-right text-red-400 text-[10px]">
                            {tot > 0 ? tot + "d" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DSR Timeline */}
      {dsrTimeline.length > 3 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-2">DSR Trend (all time)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dsrTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} interval={Math.max(0, Math.floor(dsrTimeline.length / 12))} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px", fontSize: 12 }} formatter={(v) => v != null ? v.toFixed(1) : '—'} />
              <Line dataKey="dsr" stroke="#3b82f6" strokeWidth={2} dot={false} name="Avg DSR" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pipeline */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
        <h3 className="text-white font-semibold text-sm mb-3">Pipeline</h3>
        <div className="flex items-end gap-2 h-28">
          {pipe.map((p, i) => (
            <div key={p.l} className="flex-1 flex flex-col items-center">
              <span className="text-white text-xs font-semibold mb-1">{R(p.v)}</span>
              <div className="w-full rounded-t-md"
                style={{
                  height: Math.max((p.v / mxP) * 70, 4) + "px",
                  backgroundColor: i === pipe.length - 1 ? BL : i === 0 ? TL : "#6b7280"
                }} />
              <span className="text-gray-500 text-xs mt-1">{p.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bundles */}
      <BundlesTable
        cB={cB} core={core} stg={stg} ven={ven}
        replenMap={data.replenRec || []}
        missingMap={(() => { const m = {}; (data.receiving || []).forEach(r => { if (r.piecesMissing > 0) { const k = (r.core || "").trim(); m[k] = (m[k] || 0) + r.piecesMissing } }); return m })()}
        agedMap={agedMap} killMap={killMap} goBundle={goBundle}
        vendorRec={vendorRec} allCores={data.cores || []}
      />

      {/* Purchase Rec (v2 — bundle-driven) */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h3 className="text-white font-semibold text-sm mb-3">
          Purchase Rec
          <span className="ml-2 text-[10px] text-gray-500 font-normal">v2 · bundle-driven · consistent with Purchasing tab</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-3">
          {[
            { l: "DOC", v: R(core.doc), c: dc(core.doc, lt, lt + (core.buf || 14)) },
            { l: "Need (" + tg + "d target)", v: sNeed > 0 ? R(sNeed) : "—", c: moqInflated ? "text-orange-300" : "text-white" },
            { l: "Order(MOQ:" + R(core.moq) + ")", v: sOq > 0 ? R(sOq) : "—" },
            { l: "Cost", v: sCost > 0 ? $(sCost) : "—", c: "text-amber-300" },
            { l: "After DOC", v: sOq > 0 ? R(sDa) : "—", c: "text-emerald-400" }
          ].map(k => (
            <div key={k.l}>
              <div className="text-gray-500 text-xs">{k.l}</div>
              <div className={`text-lg font-bold ${k.c || "text-white"}`}>{k.v}</div>
            </div>
          ))}
        </div>

       {moqInflated && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2 mb-2 text-xs">
            <div className="text-orange-300 font-semibold mb-1">⚠ MOQ is inflating this order</div>
            <div className="text-gray-300">
              You actually need <span className="text-white font-semibold">{R(sNeed)}</span> pcs, but the vendor's MOQ/casepack
              forces you to buy <span className="text-white font-semibold">{R(sOq)}</span> pcs
              (<span className="text-orange-300">{Math.round(moqRatio * 100)}%</span> of real need).
              That's <span className="text-white font-semibold">{R(excessMoq)}</span> pcs extra sitting in inventory
              (<span className="text-amber-300">${Math.round(excessMoqCost).toLocaleString()}</span> in excess capital).
            </div>
          </div>
        )}

        {bundlesAffected > 0 && (
          <div className="text-xs text-gray-400 mb-2">
            <span className="text-gray-500">Driven by </span>
            <span className="text-white font-semibold">{bundlesAffected}</span>
            <span className="text-gray-500"> bundle{bundlesAffected > 1 ? "s" : ""}: </span>
            <span className="text-blue-300 font-mono">{bundlesAffectedIds.slice(0, 6).join(", ")}</span>
            {bundlesAffectedIds.length > 6 && <span className="text-gray-500"> +{bundlesAffectedIds.length - 6} more</span>}
          </div>
        )}

      <div className="flex flex-wrap gap-4 text-xs border-t border-gray-700 pt-2">
          {profile.hasHistory && <span className="text-purple-400">CV: {profile.cv?.toFixed(2)}</span>}
          {pf && <span className="text-gray-500">Freq: {pf.ordersPerYear}/yr · ×{pf.safetyMultiplier}</span>}
          {minPurchase && <span className="text-gray-500">Min purchase: <span className="text-amber-300 font-semibold">{R(minPurchase.min)} pcs</span> ({minPurchase.count} orders)</span>}
        </div>
      </div>
    </div>
  );
}
