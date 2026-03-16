import React, { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import { R, D1, $, $2, $4, P, gS, cAI, cNQ, cOQ, cDA, bNQ, isD, gTD, dc, cSeas, fSl, fMY, fE, fDateUS, effectiveDSR, roundToCasePack, genPO, genRFQ, cp7f, cp7g } from "../lib/utils";
import { Dot, Toast, TH, SS, WorkflowChip, NumInput } from "./Shared";

export default function PurchTab({ data, stg, goCore, goBundle, goVendor, ov, setOv, initV, clearIV, saveWorkflow, deleteWorkflow }) {
  const [vm, setVm] = useState(initV ? "vendor" : "core");
  const [sort, setSort] = useState("status");
  const [vf, setVf] = useState(initV || "");
  const [sf, setSf] = useState("");
  const [nf, setNf] = useState("all");
  const [minD, setMinD] = useState(0);
  const [locF, setLocF] = useState("all");
  const [toast, setToast] = useState(null);
  const [poN, setPoN] = useState("");
  const [poD, setPoD] = useState("");
  const [vendorSub, setVendorSub] = useState("cores");
  const [showRS, setShowRS] = useState(false);
  const [showCosts, setShowCosts] = useState(false);
  const [showPH, setShowPH] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => { if (initV) { setVm("vendor"); setVf(initV); clearIV() } }, [initV, clearIV]);

  // Check if item is ignored via workflow
  const isIgnored = useCallback((id) => {
    const wf = (data.workflow || []).find(w => w.id === id);
    if (!wf || wf.status !== "Ignore") return false;
    if (!wf.ignoreUntil) return true;
    const until = new Date(wf.ignoreUntil);
    return !isNaN(until.getTime()) && until >= new Date(new Date().toDateString());
  }, [data.workflow]);

  // === MAPS ===
  const vMap = useMemo(() => { const m = {}; (data.vendors || []).forEach(v => m[v.name] = v); return m }, [data.vendors]);
  const vNames = useMemo(() => (data.vendors || []).map(v => v.name).sort(), [data.vendors]);
  const rsMap = useMemo(() => { const m = {}; (data.restock || []).forEach(r => { if (!m[r.core]) m[r.core] = []; m[r.core].push(r) }); return m }, [data.restock]);
  const feMap = useMemo(() => { const m = {}; (data.fees || []).forEach(f => m[f.j] = f); return m }, [data.fees]);
  const saMap = useMemo(() => { const m = {}; (data.sales || []).forEach(s => m[s.j] = s); return m }, [data.sales]);
  const pcMap = useMemo(() => {
    const m = {}; (data.priceComp || []).forEach(r => { if (!m[r.core]) m[r.core] = []; m[r.core].push(r) });
    Object.keys(m).forEach(k => { m[k].sort((a, b) => (b.date || "").localeCompare(a.date || "")); m[k] = m[k].slice(0, 4) });
    return m;
  }, [data.priceComp]);
  const agedMap = useMemo(() => { const m = {}; (data.agedInv || []).forEach(r => m[r.j] = r); return m }, [data.agedInv]);
  const killMap = useMemo(() => { const m = {}; (data.killMgmt || []).forEach(r => m[r.j] = r); return m }, [data.killMgmt]);

  // === ENRICHED CORES ===
  const enr = useMemo(() => (data.cores || []).filter(c => {
    if (stg.fA === "yes" && c.active !== "Yes") return false;
    if (stg.fA === "no" && c.active === "Yes") return false;
    if (stg.fV === "yes" && c.visible !== "Yes") return false;
    if (stg.fV === "no" && c.visible === "Yes") return false;
    if (stg.fI === "blank" && !!c.ignoreUntil) return false;
    if (stg.fI === "set" && !c.ignoreUntil) return false;
    return true;
  }).map(c => {
    const v = vMap[c.ven] || {}; const lt = v.lt || 30; const tg = gTD(v, stg);
    const cd = lt; const wd = lt + (c.buf || 14);
    const st = gS(c.doc, lt, c.buf, { critDays: cd, warnDays: wd });
    const ai = cAI(c); const nq = cNQ(c, tg); const oq = cOQ(nq, c.moq, c.casePack);
    const seas = cSeas(c.id, (data._coreInv || []));
    return { ...c, status: st, allIn: ai, needQty: nq, orderQty: oq, needDollar: +(oq * c.cost).toFixed(2), docAfter: cDA(c, oq), lt, critDays: cd, warnDays: wd, targetDoc: tg, vc: v.country || "", seas, isDom: isD(v.country), spike: c.d7 > 0 && c.dsr > 0 && c.d7 >= c.dsr * 1.25 };
  }).filter(c => {
    if (vf && c.ven !== vf) return false;
    if (sf && c.status !== sf) return false;
    if (minD > 0 && c.doc < minD) return false;
    if (nf === "need" && c.needQty <= 0) return false;
    if (nf === "ok" && c.needQty > 0) return false;
    if (locF === "us" && !c.isDom) return false;
    if (locF === "intl" && c.isDom) return false;
    return true;
  }).sort((a, b) => {
    const so = { critical: 0, warning: 1, healthy: 2 };
    if (sort === "status") return so[a.status] - so[b.status];
    if (sort === "doc") return a.doc - b.doc;
    if (sort === "dsr") return b.dsr - a.dsr;
    if (sort === "need$") return b.needDollar - a.needDollar;
    return 0;
  }), [data, stg, vf, sf, sort, vMap, nf, minD, locF]);

  const venBundles = useMemo(() => (data.bundles || []).filter(b => {
    if (b.active !== "Yes") return false;
    if (vf && (b.vendors || "").indexOf(vf) < 0) return false;
    return true;
  }).map(b => { const f = feMap[b.j]; const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0; return { ...b, fee: f, margin } }), [data.bundles, vf, feMap]);

  const sc = useMemo(() => { const c = { critical: 0, warning: 0, healthy: 0 }; enr.forEach(x => c[x.status]++); return c }, [enr]);

  // === OV ACCESS ===
  const gO = id => ov[id] || {};
  const setF = (id, f, v) => setOv(p => ({ ...p, [id]: { ...(p[id] || {}), [f]: v } }));
  const gPcs = id => (gO(id).pcs ?? 0);
  const gCas = id => (gO(id).cas ?? 0);
  const gInbS = id => (gO(id).inbS ?? 0);
  const gCogP = id => (gO(id).cogP ?? 0);
  const gCogC = id => (gO(id).cogC ?? 0);
  const hasCoreOrd = c => (gPcs(c.id) > 0 || gCas(c.id) > 0);
  const coreEffQ = c => gPcs(c.id) || gCas(c.id) * (c.casePack || 1);
  const hasBundleOrd = b => (gPcs(b.j) > 0 || gCas(b.j) > 0);
  const bundleEffQ = b => gPcs(b.j) || gCas(b.j) * 1;
  const aftD = (allIn, q, dsr) => q > 0 && dsr > 0 ? Math.round((allIn + q) / dsr) : null;

  const tot = useMemo(() => { let d = 0, a = 0, n = 0, o = 0, co = 0; enr.forEach(c => { d += c.dsr; a += c.allIn; n += c.needQty; o += c.orderQty; co += c.needDollar }); return { d, a, n, o, co } }, [enr]);

  // === VENDOR GROUPS ===
  const vG = useMemo(() => {
    if (vm !== "vendor") return [];
    const g = {};
    enr.forEach(c => { if (!g[c.ven]) g[c.ven] = { v: vMap[c.ven] || { name: c.ven }, cores: [], bundles: [] }; g[c.ven].cores.push(c) });
    Object.keys(g).forEach(vn => { g[vn].bundles = venBundles.filter(b => (b.vendors || "").indexOf(vn) >= 0) });
    return Object.values(g).filter(grp => showIgnored || !isIgnored(grp.v.name)).sort((a, b) => b.cores.filter(c => c.status === "critical").length - a.cores.filter(c => c.status === "critical").length);
  }, [enr, vm, vMap, venBundles, isIgnored, showIgnored]);

  // === PO ITEMS (cores + bundles) ===
  const getPOI = (cores, bundles) => {
    const items = [];
    cores.filter(c => hasCoreOrd(c)).forEach(c => items.push({ id: c.id, ti: c.ti, vsku: c.vsku, qty: coreEffQ(c), cost: c.cost, cp: c.casePack || 1, inbS: gInbS(c.id), isCoreItem: true }));
    (bundles || []).filter(b => hasBundleOrd(b)).forEach(b => { const f = feMap[b.j]; items.push({ id: b.j, ti: b.t, vsku: b.asin || b.bundleCode, qty: bundleEffQ(b), cost: f?.aicogs || b.aicogs || 0, cp: 1, inbS: gInbS(b.j), isCoreItem: false }) });
    return items;
  };

  const fillR = (cores, bundles, mode) => {
    const u = { ...ov };
    if (mode === "bundles") {
      (bundles || []).forEach(b => {
        const tg = cores[0]?.targetDoc || 90;
        const need = bNQ(b, tg);
        if (need > 0) u[b.j] = { ...(u[b.j] || {}), pcs: need };
      });
    } else if (mode === "mix") {
      const coreMap = {};
      cores.forEach(c => { coreMap[c.id] = c });
      const coreExtras = {}; // pieces from small bundles that go to core
      const coresWithBundleOrders = new Set(); // cores that have bundle orders
      // First pass: calculate bundle needs
      (bundles || []).forEach(b => {
        const tg = cores[0]?.targetDoc || 90;
        const parentCore = coreMap[b.core1];
        if (!parentCore) return;
        const qtyPerBundle = b.qty1 || 1;
        const coreInb = parentCore.inb || 0;
        const extraDoc = b.cd > 0 ? Math.floor(coreInb / qtyPerBundle / b.cd) : 0;
        const effectiveDoc = (b.doc || 0) + extraDoc;
        const need = Math.ceil(Math.max(0, (tg - effectiveDoc) * b.cd));
        if (need <= 0) return;
        const moq = parentCore.moq || 0;
        if (need < moq) {
          // Too small → convert to core pieces
          coreExtras[parentCore.id] = (coreExtras[parentCore.id] || 0) + (need * qtyPerBundle);
        } else {
          u[b.j] = { ...(u[b.j] || {}), pcs: roundToCasePack(need, parentCore.casePack) };
          coresWithBundleOrders.add(parentCore.id);
        }
      });
      // Second pass: cores only get orders for extras from small bundles
      // If a core has bundle orders, don't add its own need (bundles consume the core)
      cores.forEach(c => {
        const extra = coreExtras[c.id] || 0;
        if (extra > 0) {
          u[c.id] = { ...(u[c.id] || {}), pcs: cOQ(extra, c.moq, c.casePack) };
        } else if (!coresWithBundleOrders.has(c.id) && c.needQty > 0) {
          // Core has no bundle orders at all → use normal core logic
          u[c.id] = { ...(u[c.id] || {}), pcs: cOQ(c.needQty, c.moq, c.casePack) };
        }
        // If core has bundle orders and no extras → no core order needed
      });
    } else {
      cores.filter(c => c.needQty > 0).forEach(c => {
        u[c.id] = { ...(u[c.id] || {}), pcs: cOQ(c.needQty, c.moq, c.casePack) };
      });
    }
    setOv(u);
  };
  const clrV = (cores, bundles) => { const u = { ...ov }; cores.forEach(c => { delete u[c.id] }); (bundles || []).forEach(b => { delete u[b.j] }); setOv(u) };
  const getRS = id => (rsMap[id] || [])[0];
  const togPH = id => setShowPH(p => ({ ...p, [id]: !p[id] }));
  const togCollapse = id => setCollapsed(p => ({ ...p, [id]: !p[id] }));
  const togDismiss = id => setDismissed(p => ({ ...p, [id]: !p[id] }));

  // Inbound orders grouped by core (for 7f history)
  const ibMap = useMemo(() => {
    const m = {};
    (data.inbound || []).forEach(r => {
      if (!m[r.core]) m[r.core] = [];
      m[r.core].push(r);
    });
    Object.keys(m).forEach(k => { m[k].sort((a, b) => (b.eta || '').localeCompare(a.eta || '')); m[k] = m[k].slice(0, 4) });
    return m;
  }, [data.inbound]);

  // Last purchase info for a core
  const lastPurch = id => { const rows = pcMap[id]; if (!rows || !rows.length) return null; return rows[0] };

  // === CORE ROW ===
  const CoreRow = ({ c, mixAdj }) => {
    if (dismissed[c.id]) return <tr className="border-t border-gray-800/20 bg-gray-900/30 text-xs opacity-40"><td className="py-1 px-1" colSpan={2}><Dot status={c.status} /></td><td className="py-1 px-1 text-gray-500 font-mono">{c.id}</td><td className="py-1 px-1 text-gray-600 truncate max-w-[110px]">{c.ti}</td><td colSpan={20} className="py-1 px-1 text-right"><button onClick={() => togDismiss(c.id)} className="text-xs text-gray-500 hover:text-white px-1">+</button></td></tr>;
    const eq = coreEffQ(c); const cost = eq * c.cost; const adj = mixAdj || 0;
    const ad = aftD(c.allIn + adj, eq, c.dsr); const rs = getRS(c.id);
    const lp = lastPurch(c.id); const isCol = collapsed[c.id];
    const rsCols = showRS ? 5 : 0;
    const expCols = isCol ? 0 : 5; // expandable: Raw, PPRC, Inbound, FIB DOC(b), FIB Inv(b)

    return <><tr className={`border-t border-gray-800/30 hover:bg-gray-800/20 text-xs ${hasCoreOrd(c) ? "bg-emerald-900/10" : ""}`}>
      <td className="py-1 px-1 sticky left-0 bg-gray-950 z-10"><Dot status={c.status} /></td>
      <td className="py-1 px-1 text-blue-400 font-mono sticky left-5 bg-gray-950 z-10">{c.id}</td>
      <td className="py-1 px-1 text-gray-200 truncate max-w-[140px] sticky left-24 bg-gray-950 z-10">{c.ti}</td>
      <td className="py-1 px-1 text-right">{D1(c.dsr)}</td>
      <td className="py-1 px-1 text-right">{D1(c.d7)}</td>
      <td className="py-1 px-1 text-center">{c.d7 > c.dsr ? <span className={c.spike ? "text-orange-400 font-bold" : "text-emerald-400"}>▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}{c.spike && <span className="text-orange-400 text-xs ml-0.5" title="Spike: 7D DSR 25%+ above DSR">⚡</span>}</td>
      <td className={`py-1 px-1 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</td>
      {/* INV = allIn (without inbound) + inbound shown separately */}
      <td className="py-1 px-1 text-right">{R(c.allIn - (c.inb || 0))}{c.inb > 0 && <span className="text-teal-400 ml-0.5" title="Inbound pieces">+{R(c.inb)}</span>}{adj > 0 && <span className="text-amber-300 ml-0.5" title="Bundle orders covering core">+{adj}</span>}</td>
      <td className="py-1 px-1 text-right text-gray-400">{c.moq > 0 ? R(c.moq) : "—"}</td>
      <td className="py-1 px-1 text-right text-gray-400">{c.casePack > 0 ? R(c.casePack) : "—"}</td>
      <td className="py-1 px-1 text-right text-gray-500 text-xs">{lp ? fMY(lp.date) : "—"}</td>
      <td className="py-1 px-1 text-center">{c.seas && <span className="text-purple-400 font-bold">{c.seas.peak}</span>}</td>
      <td className="py-1 px-1 text-right text-gray-400">{c.orderQty > 0 ? R(c.orderQty) : "—"}</td>
      {!isCol && <>
        <td className="py-1 px-1 text-right">{R(c.raw)}</td>
        <td className="py-1 px-1 text-right">{R(c.pp)}</td>
        <td className="py-1 px-1 text-right">{R(c.inb)}</td>
        <td className="py-1 px-1 text-right text-gray-400">—</td>
        <td className="py-1 px-1 text-right text-gray-400">—</td>
      </>}
      {showRS && <>
        <td className="py-1 px-1 text-right text-cyan-300">{rs ? R(rs.fibPcs) : "—"}</td>
        <td className="py-1 px-1 text-right">{rs ? R(rs.rawPcs) : "—"}</td>
        <td className="py-1 px-1 text-right">{rs ? R(rs.inbPcs) : "—"}</td>
        <td className="py-1 px-1 text-right text-gray-400">{rs ? R(rs.casePack) : "—"}</td>
        <td className="py-1 px-1 text-right text-amber-300">{rs ? R(rs.finalPcsToOrder) : "—"}</td>
      </>}
      <td className="py-1 border-l-2 border-gray-600 px-1" />
      <td className="py-0.5 px-0.5 sticky right-36 bg-gray-950 z-10"><NumInput value={gPcs(c.id)} onChange={v => setF(c.id, 'pcs', v)} /></td>
      <td className="py-0.5 px-0.5 sticky right-24 bg-gray-950 z-10"><NumInput value={gCas(c.id)} onChange={v => setF(c.id, 'cas', v)} /></td>
      {showCosts && <>
        <td className="py-0.5 px-0.5"><NumInput value={gInbS(c.id)} onChange={v => setF(c.id, 'inbS', v)} /></td>
        <td className="py-0.5 px-0.5"><NumInput value={gCogP(c.id)} onChange={v => setF(c.id, 'cogP', v)} /></td>
        <td className="py-0.5 px-0.5"><NumInput value={gCogC(c.id)} onChange={v => setF(c.id, 'cogC', v)} /></td>
      </>}
      <td className="py-1 px-1 text-right text-amber-300 sticky right-12 bg-gray-950 z-10">{cost > 0 ? $(cost) : "—"}</td>
      <td className={`py-1 px-1 text-right sticky right-0 bg-gray-950 z-10 ${ad ? dc(ad, c.critDays, c.warnDays) : "text-gray-500"}`}>{ad ? R(ad) : "—"}</td>
      <td className="py-1 px-0.5 flex gap-0.5">
        <button onClick={() => togCollapse(c.id)} className="text-gray-400 hover:text-white text-xs px-0.5">{isCol ? "+" : "−"}</button>
        <button onClick={() => togDismiss(c.id)} className="text-gray-400 hover:text-red-400 text-xs px-0.5">✕</button>
        {(pcMap[c.id] || ibMap[c.id]) && <button onClick={() => togPH(c.id)} className={`text-xs px-0.5 rounded ${showPH[c.id] ? "text-amber-300" : "text-gray-500"}`}>$</button>}
        <button onClick={() => goCore(c.id)} className="text-blue-400 px-0.5 bg-blue-400/10 rounded text-xs">V</button>
        <div className="relative"><WorkflowChip id={c.id} type="core" workflow={data.workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer} /></div>
      </td>
    </tr>
    {showPH[c.id] && (pcMap[c.id] || ibMap[c.id]) && <tr><td colSpan={40} className="p-0"><div className="bg-gray-800/50 px-4 py-2 space-y-3">
      {/* 7g - What you paid */}
      {pcMap[c.id] && <div><div className="text-gray-500 text-xs font-semibold mb-1">💰 Purchase History (7g)</div><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="py-0.5 text-left">Date</th><th className="py-0.5 text-right">Pcs</th><th className="py-0.5 text-right">Material</th><th className="py-0.5 text-right">Inb Ship</th><th className="py-0.5 text-right">Tariffs</th><th className="py-0.5 text-right">Total</th><th className="py-0.5 text-right">CPP</th></tr></thead><tbody>{pcMap[c.id].map((r, i) => <tr key={i} className="border-t border-gray-700/30"><td className="py-0.5 text-gray-300">{fDateUS(r.date)}</td><td className="py-0.5 text-right">{R(r.pcs)}</td><td className="py-0.5 text-right">{$2(r.matPrice)}</td><td className="py-0.5 text-right text-gray-400">{$2(r.inbShip)}</td><td className="py-0.5 text-right text-gray-400">{$2(r.tariffs)}</td><td className="py-0.5 text-right">{$2(r.totalCost)}</td><td className="py-0.5 text-right text-amber-300">{$2(r.cpp)}</td></tr>)}</tbody></table></div>}
      {/* 7f - What you ordered */}
      {ibMap[c.id] && <div><div className="text-gray-500 text-xs font-semibold mb-1">📦 Orders / Receiving (7f)</div><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="py-0.5 text-left">ETA</th><th className="py-0.5 text-left">Order#</th><th className="py-0.5 text-left">Vendor</th><th className="py-0.5 text-right">Pcs</th><th className="py-0.5 text-right">Cases</th><th className="py-0.5 text-right">Price/pc</th><th className="py-0.5 text-right">Missing</th></tr></thead><tbody>{ibMap[c.id].map((r, i) => <tr key={i} className="border-t border-gray-700/30"><td className="py-0.5 text-gray-300">{fDateUS(r.eta)}</td><td className="py-0.5 text-gray-300">{r.orderNum || "—"}</td><td className="py-0.5 text-gray-400">{r.vendor}</td><td className="py-0.5 text-right">{R(r.pieces)}</td><td className="py-0.5 text-right">{R(r.cases)}</td><td className="py-0.5 text-right text-amber-300">{$2(r.price)}</td><td className={`py-0.5 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-500"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td></tr>)}</tbody></table></div>}
    </div></td></tr>}
    </>;
  };

  // === BUNDLE ROW (aligned to core columns) ===
  const BundleRow = ({ b, indent }) => {
    const f = b.fee || feMap[b.j]; const eq = bundleEffQ(b); const cost = f ? (eq * (f.aicogs || 0)) : 0;
    const aged = agedMap[b.j]; const kill = killMap[b.j];
    const isCol = collapsed[b.j];
    return <tr className={`border-t border-gray-800/20 hover:bg-indigo-900/10 text-xs ${hasBundleOrd(b) ? "bg-emerald-900/10" : "bg-indigo-950/20"}`}>
      <td className="py-1 px-1 sticky left-0 bg-indigo-950/20 z-10" />
      <td className="py-1 px-1 text-indigo-400 font-mono sticky left-5 bg-indigo-950/20 z-10">{indent ? "└ " : ""}{b.j}</td>
      <td className="py-1 px-1 text-indigo-200 truncate max-w-[140px] sticky left-24 bg-indigo-950/20 z-10">
        {b.t}
        {aged && aged.fbaHealth !== "Healthy" && <span className={`ml-1 text-xs ${aged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{aged.fbaHealth}</span>}
        {aged && aged.storageLtsf > 0 && <span className="ml-1 text-xs text-red-300">${aged.storageLtsf.toFixed(0)}</span>}
        {kill && kill.latestEval && kill.latestEval.toLowerCase().includes('kill') && <span className="ml-1 text-xs text-red-400 font-bold">KILL</span>}
        {kill && kill.sellEval && kill.sellEval.toLowerCase().includes('sell') && <span className="ml-1 text-xs text-amber-400 font-bold">ST</span>}
      </td>
      {/* DSR */}<td className="py-1 px-1 text-right text-indigo-300">{D1(b.cd)}</td>
      {/* 7D */}<td className="py-1 px-1 text-right text-indigo-300">{D1(b.d7comp)}</td>
      {/* T */}<td className="py-1 px-1 text-center">{b.d7comp > b.cd ? <span className="text-emerald-400">▲</span> : b.d7comp < b.cd ? <span className="text-red-400">▼</span> : "—"}</td>
      {/* DOC */}<td className="py-1 px-1 text-right text-indigo-300">{R(b.doc)}</td>
      {/* Inv = FIB Inv */}<td className="py-1 px-1 text-right text-indigo-300">{R(b.fibInv)}</td>
      {/* MOQ */}<td className="py-1 px-1 text-gray-600">—</td>
      {/* VCAS */}<td className="py-1 px-1 text-gray-600">—</td>
      {/* LastPO */}<td className="py-1 px-1 text-gray-600">—</td>
      {/* S = replen */}<td className="py-1 px-1 text-center text-indigo-300">{b.replenTag || "—"}</td>
      {/* REC */}<td className="py-1 px-1 text-gray-600">—</td>
      {/* Expandable cols */}{!isCol && <td colSpan={5} />}
      {/* RS cols */}{showRS && <td colSpan={5} />}
      <td className="py-1 border-l-2 border-gray-600 px-1" />
      <td className="py-0.5 px-0.5 sticky right-36 bg-indigo-950/20 z-10"><NumInput value={gPcs(b.j)} onChange={v => setF(b.j, 'pcs', v)} /></td>
      <td className="py-0.5 px-0.5 sticky right-24 bg-indigo-950/20 z-10"><NumInput value={gCas(b.j)} onChange={v => setF(b.j, 'cas', v)} /></td>
      {showCosts && <>
        <td className="py-0.5 px-0.5"><NumInput value={gInbS(b.j)} onChange={v => setF(b.j, 'inbS', v)} /></td>
        <td className="py-0.5 px-0.5"><NumInput value={gCogP(b.j)} onChange={v => setF(b.j, 'cogP', v)} /></td>
        <td className="py-0.5 px-0.5"><NumInput value={gCogC(b.j)} onChange={v => setF(b.j, 'cogC', v)} /></td>
      </>}
      <td className="py-1 px-1 text-right text-amber-300 sticky right-12 bg-indigo-950/20 z-10">{cost > 0 ? $(cost) : "—"}</td>
      <td className="py-1 px-1 text-right sticky right-0 bg-indigo-950/20 z-10">{R(b.doc)}</td>
      <td className="py-1 px-1"><button onClick={() => goBundle(b.j)} className="text-indigo-400 px-0.5 bg-indigo-400/10 rounded text-xs">V</button></td>
    </tr>;
  };

  // === VENDOR TABLE HEADER ===
  const rsToggle = <button onClick={() => setShowRS(!showRS)} className={`text-xs px-1 py-0.5 rounded font-bold ${showRS ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400"}`} title="Toggle Restocker columns">{showRS ? "−" : "+"}RS</button>;
  const costsToggle = <button onClick={() => setShowCosts(!showCosts)} className={`text-xs px-1 py-0.5 rounded font-bold ${showCosts ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-400"}`} title="Toggle InbS/CogP/CogC columns">{showCosts ? "−" : "+"}$</button>;

  const VTH = ({ isCol }) => <tr className="text-gray-500 uppercase bg-gray-900/40 text-xs">
    <th className="py-2 px-1 w-5 sticky left-0 bg-gray-900 z-10" /><TH tip="Core or JLS #" className="py-2 px-1 text-left sticky left-5 bg-gray-900 z-10">ID</TH><th className="py-2 px-1 text-left sticky left-24 bg-gray-900 z-10">Title</th>
    <TH tip="Composite Daily Sales Rate" className="py-2 px-1 text-right">DSR</TH><TH tip="7-Day DSR" className="py-2 px-1 text-right">7D</TH><TH tip="Trend" className="py-2 px-1 text-center">T</TH><TH tip="Days of Coverage" className="py-2 px-1 text-right">DOC</TH>
    <TH tip="Inventory (on hand + inbound shown as +N in teal)" className="py-2 px-1 text-right">Inv</TH><TH tip="MOQ Pieces" className="py-2 px-1 text-right">MOQ</TH><TH tip="Vendor Case Pack" className="py-2 px-1 text-right">VCas</TH><TH tip="Last Purchase Date" className="py-2 px-1 text-right">LastPO</TH>
    <TH tip="Seasonal Peak" className="py-2 px-1 text-center">S</TH><TH tip="Recommended Qty" className="py-2 px-1 text-right">Rec</TH>
    {!isCol && <><TH tip="Raw / Potential Units" className="py-2 px-1 text-right">Raw</TH><TH tip="PPRC Available" className="py-2 px-1 text-right">PPRC</TH><TH tip="Inbound Pieces" className="py-2 px-1 text-right">Inb</TH><TH tip="FIB DOC (bundles)" className="py-2 px-1 text-right">FibD</TH><TH tip="FIB Inventory (bundles)" className="py-2 px-1 text-right">FibI</TH></>}
    {showRS && <><TH tip="FIB Pieces (Restocker)" className="py-2 px-1 text-right text-cyan-400">rFIB</TH><TH tip="Raw Pieces (Restocker)" className="py-2 px-1 text-right text-cyan-400">rRaw</TH><TH tip="Inbound (Restocker)" className="py-2 px-1 text-right text-cyan-400">rInb</TH><TH tip="Case Pack" className="py-2 px-1 text-right text-cyan-400">CPk</TH><TH tip="MOQ Pieces to Order" className="py-2 px-1 text-right text-cyan-400">MOQPcs</TH></>}
    <th className="py-2 border-l-2 border-gray-600 px-1" />
    <TH tip="Pieces to Order" className="py-2 px-1 text-center sticky right-36 bg-gray-900 z-10">Pcs</TH><TH tip="Cases to Order" className="py-2 px-1 text-center sticky right-24 bg-gray-900 z-10">Cas</TH>
    {showCosts && <><TH tip="Inbound Shipping Cost" className="py-2 px-1 text-center">InbS</TH><TH tip="Cost per Piece" className="py-2 px-1 text-center">CogP</TH><TH tip="Cost per Case" className="py-2 px-1 text-center">CogC</TH></>}
    <th className="py-2 px-1 text-right sticky right-12 bg-gray-900 z-10">Cost</th><TH tip="DOC After Order" className="py-2 px-1 text-right sticky right-0 bg-gray-900 z-10">After DOC</TH><th className="py-2 px-1 w-16">{rsToggle} {costsToggle}</th>
  </tr>;

  // === RENDER ===
  return <div className="p-4">{toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <div className="flex bg-gray-800 rounded-lg p-0.5">{["core", "vendor"].map(m => <button key={m} onClick={() => setVm(m)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm === m ? "bg-blue-600 text-white" : "text-gray-400"}`}>{m === "core" ? "By Core" : "By Vendor"}</button>)}</div>
      <SS value={vf} onChange={setVf} options={vNames} />
      <select value={sf} onChange={e => setSf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="">All Status</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>
      <select value={locF} onChange={e => setLocF(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="us">US Only</option><option value="intl">International</option></select>
      <select value={nf} onChange={e => setNf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="need">Needs Buy</option><option value="ok">No Need</option></select>
      {vm === "core" && <><select value={sort} onChange={e => setSort(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="status">Priority</option><option value="doc">DOC</option><option value="dsr">DSR</option><option value="need$">$</option></select><span className="text-gray-500 text-xs">Min:</span><input type="number" value={minD} onChange={e => setMinD(+e.target.value)} className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1 w-14" /></>}
      {vm === "vendor" && <div className="flex bg-gray-800 rounded-lg p-0.5">{[["cores", "Cores"], ["bundles", "Bundles"], ["mix", "Mix"]].map(([k, l]) => <button key={k} onClick={() => setVendorSub(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${vendorSub === k ? "bg-indigo-600 text-white" : "text-gray-400"}`}>{l}</button>)}</div>}
      <div className="flex gap-2 ml-auto text-xs"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{sc.critical}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{sc.warning}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{sc.healthy}</span><span className="text-gray-500">|</span><span className="text-gray-300 font-semibold">{enr.length}</span>
      {vm === "vendor" && <button onClick={() => setShowIgnored(!showIgnored)} className={`ml-2 px-2 py-0.5 rounded text-xs ${showIgnored ? "bg-red-500/20 text-red-400" : "bg-gray-700 text-gray-500"}`}>{showIgnored ? "Hide" : "Show"} Ignored</button>}
      </div>
    </div>
    {vm === "vendor" && <div className="flex flex-wrap gap-3 mb-4 items-center text-sm"><span className="text-gray-500 text-xs">PO#:</span><input type="text" value={poN} onChange={e => setPoN(e.target.value)} placeholder="2637" className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 w-20 text-sm" /><span className="text-gray-500 text-xs">Date:</span><input type="date" value={poD} onChange={e => setPoD(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-sm" /><span className="text-gray-500 text-xs">Buyer:</span><span className="text-white font-semibold">{stg.buyer || <span className="text-red-400">Set in ⚙️</span>}</span></div>}

    {/* === BY CORE VIEW === */}
    {vm === "core" && <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead><tr className="bg-gray-900/80 text-xs text-gray-400 uppercase"><th className="py-3 px-2 w-8" /><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left cursor-pointer hover:text-white" onClick={() => { }}>Vendor</th><th className="py-3 px-2 text-left">Title</th><TH tip="Composite DSR" className="py-3 px-2 text-right">DSR</TH><TH tip="7-Day DSR" className="py-3 px-2 text-right">7D</TH><th className="py-3 px-2 text-center">T</th><TH tip="Days of Coverage" className="py-3 px-2 text-right">DOC</TH><TH tip="All-In Owned Pieces" className="py-3 px-2 text-right">All-In</TH><th className="py-3 px-2 text-right">MOQ</th><th className="py-3 px-2 text-center">S</th><th className="py-3 px-1 border-l-2 border-gray-600" /><th className="py-3 px-2 text-right">Need</th><th className="py-3 px-2 text-right">Order</th><th className="py-3 px-2 text-right">Cost</th><TH tip="DOC After Order" className="py-3 px-2 text-right">After</TH><th className="py-3 px-2 w-10" /></tr></thead>
        <tbody>{enr.map(c => <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 text-sm"><td className="py-2 px-2"><Dot status={c.status} /></td><td className="py-2 px-2 text-blue-400 font-mono text-xs">{c.id}</td><td className="py-2 px-2 text-blue-300 text-xs truncate max-w-[100px] cursor-pointer hover:underline" onClick={() => goVendor(c.ven)}>{c.ven}</td><td className="py-2 px-2 text-gray-200 truncate max-w-[180px]">{c.ti}</td><td className="py-2 px-2 text-right">{D1(c.dsr)}</td><td className="py-2 px-2 text-right">{D1(c.d7)}</td><td className="py-2 px-2 text-center">{c.d7 > c.dsr ? <span className="text-emerald-400">▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}</td><td className={`py-2 px-2 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</td><td className="py-2 px-2 text-right">{R(c.allIn)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{c.moq > 0 ? R(c.moq) : "—"}</td><td className="py-2 px-2 text-center">{c.seas && <span className="text-purple-400 text-xs font-bold">{c.seas.peak}</span>}</td><td className="py-2 px-1 border-l-2 border-gray-600" /><td className="py-2 px-2 text-right text-gray-300">{c.needQty > 0 ? R(c.needQty) : "—"}</td><td className="py-2 px-2 text-right text-white font-semibold">{c.orderQty > 0 ? R(c.orderQty) : "—"}</td><td className="py-2 px-2 text-right text-amber-300">{c.needDollar > 0 ? $(c.needDollar) : "—"}</td><td className={`py-2 px-2 text-right ${c.orderQty > 0 ? dc(c.docAfter, c.critDays, c.warnDays) : "text-gray-500"}`}>{c.orderQty > 0 ? R(c.docAfter) : "—"}</td><td className="py-2 px-2"><button onClick={() => goCore(c.id)} className="text-blue-400 text-xs px-1.5 py-0.5 bg-blue-400/10 rounded">V</button></td></tr>)}</tbody>
        <tfoot><tr className="bg-gray-900 border-t-2 border-gray-700 text-sm font-semibold"><td colSpan={4} className="py-3 px-2 text-gray-300">{enr.length}</td><td className="py-3 px-2 text-right text-white">{D1(tot.d)}</td><td colSpan={3} /><td className="py-3 px-2 text-right text-white">{R(tot.a)}</td><td colSpan={2} /><td className="border-l-2 border-gray-600" /><td className="py-3 px-2 text-right">{R(tot.n)}</td><td className="py-3 px-2 text-right text-white">{R(tot.o)}</td><td className="py-3 px-2 text-right text-amber-300">{$(tot.co)}</td><td colSpan={2} /></tr></tfoot>
      </table></div>}

    {/* === BY VENDOR VIEW === */}
    {vm === "vendor" && vG.map(grp => {
      const v = grp.v; const tg = gTD(v, stg);
      const poI = getPOI(grp.cores, vendorSub !== "cores" ? grp.bundles : []);
      const poT = poI.reduce((s, i) => s + i.qty * i.cost, 0);
      const poC = poI.reduce((s, i) => s + (v.vou === 'Cases' && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : 0), 0);
      const meets = poT >= (v.moqDollar || 0);
      const anyCol = Object.values(collapsed).some(Boolean);

      return <div key={v.name} className="mb-5 border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-white font-semibold cursor-pointer hover:text-blue-400 hover:underline" onClick={() => window.open(window.location.pathname + '?vendor=' + encodeURIComponent(v.name), '_blank')}>{v.name}</span>
            <div className="relative"><WorkflowChip id={v.name} type="vendor" workflow={data.workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer} /></div>
            {v.country && <span className="text-xs text-gray-500">{v.country}</span>}
            <span className="text-xs text-gray-400">LT:{v.lt}d</span>
            <span className="text-xs text-gray-400">Buf:{grp.cores[0]?.buf || 14}d</span>
            <span className="text-xs text-gray-400">MOQ:{$(v.moqDollar)}</span>
            <span className="text-xs text-gray-400">Tgt:{tg}d</span>
            <span className="text-xs text-gray-400">{v.payment}</span>
            {poI.length === 0 ? <span className="ml-auto text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">—</span> : <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${meets ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>{meets ? "✓" : "!"} {$(poT)}{poC > 0 ? " / " + poC + "cs" : ""}</span>}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => fillR(grp.cores, grp.bundles, vendorSub)} className="text-xs bg-blue-600/80 text-white px-2.5 py-1 rounded">Fill Rec</button>
            <button onClick={() => clrV(grp.cores, grp.bundles)} className="text-xs bg-gray-700 text-gray-300 px-2.5 py-1 rounded">Clear</button>
            <button onClick={() => setDismissed({})} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">Show All</button>
            <div className="ml-auto flex gap-2">
              <button disabled={!poI.length} onClick={() => { genRFQ(v, poI, stg.buyer, poD); setToast("RFQ " + v.name) }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>RFQ</button>
              <button disabled={!poI.length} onClick={() => { genPO(v, poI, poN, stg.buyer, poD); setToast("PO " + v.name) }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-emerald-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>PO</button>
              <button disabled={!poI.length} onClick={() => { cp7f(v, poI, poN, stg.buyer, poD); setToast("7f copied!") }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>7f</button>
              <button disabled={!poI.length} onClick={() => { cp7g(v, poI, poN, stg.buyer); setToast("7g copied!") }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>7g</button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><VTH isCol={anyCol} /></thead><tbody>
          {vendorSub === "bundles" ? <>{grp.bundles.map(b => <BundleRow key={b.j} b={b} />)}{grp.bundles.length === 0 && <tr><td colSpan={40} className="py-4 text-center text-gray-500">No bundles</td></tr>}</>
            : vendorSub === "mix" ? <>{grp.cores.map(c => {
              const cBs = (data.bundles || []).filter(b => b.core1 === c.id && b.active === "Yes").map(b => ({ ...b, fee: feMap[b.j], margin: feMap[b.j] && feMap[b.j].aicogs > 0 ? ((feMap[b.j].gp / feMap[b.j].aicogs) * 100) : 0 }));
              const bAdj = cBs.reduce((s, b) => s + bundleEffQ(b), 0);
              return <Fragment key={c.id}><CoreRow c={c} mixAdj={bAdj} />{!dismissed[c.id] && cBs.map(b => <BundleRow key={b.j} b={b} indent />)}</Fragment>;
            })}</>
              : <>{grp.cores.map(c => <CoreRow key={c.id} c={c} />)}</>}
        </tbody></table></div>
      </div>;
    })}
  </div>;
}
