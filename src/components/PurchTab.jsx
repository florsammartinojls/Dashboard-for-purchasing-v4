import React, { useState, useMemo, useCallback, useEffect, useContext, Fragment } from "react";
import { R, D1, $, $2, $4, P, gS, cAI, cNQ, cOQ, cDA, bNQ, isD, gTD, dc, cSeas, fSl, fMY, fE, fDateUS, effectiveDSR, roundToCasePack, genPO, genRFQ, cp7f, cp7g } from "../lib/utils";
import { Dot, Toast, TH, SS, WorkflowChip, NumInput, SumCtx, VendorNotes, CalcBreakdown } from "./Shared";
import { batchProfiles, batchBundleProfiles, calcCoverageNeed, calcPurchaseFrequency, getCalcBreakdown, DEFAULT_PROFILE } from "../lib/seasonal";
import { batchVendorRecommendations, calcVendorRecommendation } from "../lib/recommender";

function SC({ v, children, className }) {
  const { addCell } = useContext(SumCtx);
  const [sel, setSel] = useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

export default function PurchTab({ data, stg, goCore, goBundle, goVendor, ov, setOv, initV, clearIV, saveWorkflow, deleteWorkflow, saveVendorComment, activeBundleCores }) {
  const initVendorFromURL = new URLSearchParams(window.location.search).get('vendor');
  const [vm, setVm] = useState(initV || initVendorFromURL ? "vendor" : "core");
  const [vf, setVf] = useState(initV || initVendorFromURL || "");
  useEffect(() => {
    if (initVendorFromURL && !initV) {
      const decoded = decodeURIComponent(initVendorFromURL);
      const match = (data.vendors || []).find(v => v.name === decoded || v.name.toLowerCase() === decoded.toLowerCase());
      if (match) setVf(match.name);
    }
  }, [data.vendors]);
  const [sort, setSort] = useState("status");
  const [sf, setSf] = useState("");
  const [nf, setNf] = useState("all");
  const [minD, setMinD] = useState(0);
  const [locF, setLocF] = useState("all");
  const [toast, setToast] = useState(null);
  const [toastPersist, setToastPersist] = useState(false);
  const [poN, setPoN] = useState("");
  const [poD, setPoD] = useState("");
  const [vendorSub, setVendorSub] = useState("mix");
  const [showRS, setShowRS] = useState(false);
  const [showCosts, setShowCosts] = useState(false);
  const [showPH, setShowPH] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [showIgnored, setShowIgnored] = useState(false);
  const [showNoBundleCores, setShowNoBundleCores] = useState(false);
  const [breakdown, setBreakdown] = useState(null);

  useEffect(() => { if (initV) { setVm("vendor"); setVf(initV); clearIV() } }, [initV, clearIV]);

  const isIgnored = useCallback((id) => {
    const wf = (data.workflow || []).find(w => w.id === id);
    if (!wf || wf.status !== "Ignore") return false;
    if (!wf.ignoreUntil) return true;
    const parts = (wf.ignoreUntil || "").split(/[-/]/);
    let until;
    if (parts.length === 3) {
      const [a, b, c] = parts.map(Number);
      until = a > 100 ? new Date(a, b - 1, c) : a > 12 ? new Date(c, b - 1, a) : new Date(c, a - 1, b);
    } else {
      until = new Date(wf.ignoreUntil);
    }
    return !isNaN(until.getTime()) && until >= new Date(new Date().toDateString());
  }, [data.workflow]);

  const vMap = useMemo(() => { const m = {}; (data.vendors || []).forEach(v => m[v.name] = v); return m }, [data.vendors]);
  const vNames = useMemo(() => (data.vendors || []).map(v => v.name).sort(), [data.vendors]);
  const feMap = useMemo(() => { const m = {}; (data.fees || []).forEach(f => m[f.j] = f); return m }, [data.fees]);
  const saMap = useMemo(() => { const m = {}; (data.sales || []).forEach(s => m[s.j] = s); return m }, [data.sales]);
  const pcMap = useMemo(() => { const m = {}; (data.priceComp || []).forEach(r => { if (!m[r.core]) m[r.core] = []; m[r.core].push(r) }); Object.keys(m).forEach(k => { m[k].sort((a, b) => (b.date || "").localeCompare(a.date || "")); m[k] = m[k].slice(0, 7) }); return m }, [data.priceComp]);
  const agedMap = useMemo(() => { const m = {}; (data.agedInv || []).forEach(r => m[r.j] = r); return m }, [data.agedInv]);
  const killMap = useMemo(() => { const m = {}; (data.killMgmt || []).forEach(r => m[r.j] = r); return m }, [data.killMgmt]);
  const recMap = useMemo(() => { const m = {}; (data.receiving || []).forEach(r => { if (!m[r.core]) m[r.core] = []; m[r.core].push(r) }); return m }, [data.receiving]);
  const bA = stg.bA || "yes"; const bI = stg.bI || "blank";
  const replenMap = useMemo(() => { const m = {}; (data.replenRec || []).forEach(r => { m[r.j] = r }); return m }, [data.replenRec]);
  const missingMap = useMemo(() => { const m = {}; (data.receiving || []).forEach(r => { if (r.piecesMissing > 0) { const k = (r.core || "").trim(); m[k] = (m[k] || 0) + r.piecesMissing } }); return m }, [data.receiving]);
  const casePackFromRec = useMemo(() => { const m = {}; (data.receiving || []).forEach(r => { const k = (r.core || "").trim(); if (k && r.pcs > 0 && r.cases > 0 && !m[k]) m[k] = Math.round(r.pcs / r.cases) }); return m }, [data.receiving]);

  // === SEASONAL PROFILES (core-level — kept for the Calc Breakdown modal only) ===
  const profiles = useMemo(() => batchProfiles(data.cores || [], data._coreInv || [], data._coreDays || []), [data.cores, data._coreInv, data._coreDays]);

  // === PURCHASE FREQUENCY per vendor ===
  const purchFreqMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => { m[v.name] = calcPurchaseFrequency(v.name, data.receivingFull || []) });
    return m;
  }, [data.vendors, data.receivingFull]);

  // === V2 RECOMMENDER — one pass for all vendors ===
  const vendorRecs = useMemo(() => {
    if (!data.vendors?.length) return {};
    return batchVendorRecommendations({
      vendors: data.vendors,
      cores: data.cores || [],
      bundles: data.bundles || [],
      bundleSales: data._bundleSales || [],
      receivingFull: data.receivingFull || [],
      replenMap,
      missingMap,
      settings: stg,
      purchFreqMap,
    });
  }, [data.vendors, data.cores, data.bundles, data._bundleSales, data.receivingFull, replenMap, missingMap, stg, purchFreqMap]);

  // Flat map: bundleId -> bundleDetails from whichever vendor rec contains it.
  // Used by CoreRow and BundleRow to show consistent effective DOC after waterfall.
  const bundleEffMap = useMemo(() => {
    const m = {};
    for (const vRec of Object.values(vendorRecs)) {
      if (!vRec?.bundleDetails) continue;
      for (const bd of vRec.bundleDetails) {
        m[bd.bundleId] = bd;
      }
    }
    return m;
  }, [vendorRecs]);

  // === ENRICHED CORES — status/DOC from physical data, need/order/cost from recommender ===
  const spikeThr = stg.spikeThreshold || 1.25;
  const enr = useMemo(() => (data.cores || [])
    .filter(c => c.id && !/^JLS/i.test(c.id))
    .filter(c => {
      if (stg.fA === "yes" && c.active !== "Yes") return false;
      if (stg.fA === "no" && c.active === "Yes") return false;
      if (stg.fV === "yes" && c.visible !== "Yes") return false;
      if (stg.fV === "no" && c.visible === "Yes") return false;
      if (stg.fI === "blank" && !!c.ignoreUntil) return false;
      if (!showNoBundleCores && activeBundleCores && !activeBundleCores.has(c.id)) return false;
      return true;
    }).map(c => {
      const v = vMap[c.ven] || {}; const lt = v.lt || 30; const tg = gTD(v, stg);
      const cd = lt; const wd = lt + (c.buf || 14);
      const effectiveDoc = c.dsr > 0 ? Math.round(cAI(c) / c.dsr) : c.doc;
      const st = gS(effectiveDoc, lt, c.buf, { critDays: cd, warnDays: wd });
      const ai = cAI(c);
      const seas = cSeas(c.id, (data._coreInv || []));
      const invAnomaly = ai > 0 && c.dsr > 0 && Math.abs(effectiveDoc - ai / c.dsr) > effectiveDoc * 0.2;

      // === v2 recommender lookup (authoritative for need/order/cost) ===
      const vRec = vendorRecs[c.ven];
      const cDet = vRec?.coreDetails?.find(x => x.coreId === c.id);
      const sNeed = cDet?.needPieces || 0;
      const oq = cDet?.finalQty || 0;
      const moqInflated = cDet?.moqInflated || false;
      const moqInflationRatio = cDet?.moqInflationRatio || 1;
      const excessFromMoq = cDet?.excessFromMoq || 0;
      const excessCostFromMoq = cDet?.excessCostFromMoq || 0;
      const recUrgent = cDet?.urgent || false;
      const bundlesAffected = cDet?.bundlesAffected || 0;

      // ⚙PROC indicator — has raw + bundles with DOC < 60
      let rawPendingBundles = false;
      if ((c.raw || 0) > 0 && activeBundleCores && activeBundleCores.has(c.id)) {
        const cBundles = (data.bundles || []).filter(b => {
          if (b.active !== "Yes" || b.ignoreUntil) return false;
          for (let i = 1; i <= 20; i++) if (b['core' + i] === c.id) return true;
          return false;
        });
        if (cBundles.some(b => (b.fibDoc || 0) < 60)) rawPendingBundles = true;
      }

      // Keep core-level profile available for the Calc Breakdown modal (legacy view)
      const profile = profiles[c.id] || DEFAULT_PROFILE;

      return {
        ...c,
        status: st,
        allIn: ai,
        doc: effectiveDoc,
        needQty: sNeed,
        orderQty: oq,
        needDollar: +(oq * c.cost).toFixed(2),
        docAfter: cDA(c, oq),
        lt,
        critDays: cd,
        warnDays: wd,
        targetDoc: tg,
        vc: v.country || "",
        seas,
        isDom: isD(v.country),
        spike: c.d7 > 0 && c.dsr > 0 && c.d7 >= c.dsr * spikeThr,
        sProfile: profile,
        sCoverage: { urgent: recUrgent },
        invAnomaly,
        rawPendingBundles,
        moqInflated,
        moqInflationRatio,
        excessFromMoq,
        excessCostFromMoq,
        bundlesAffected,
      };
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
    }), [data, stg, vf, sf, sort, vMap, nf, minD, locF, profiles, vendorRecs, showNoBundleCores, activeBundleCores, spikeThr]);

  const venBundles = useMemo(() => (data.bundles || []).filter(b => {
    if (bA === "yes" && b.active !== "Yes") return false;
    if (bA === "no" && b.active === "Yes") return false;
    if (bI === "blank" && !!b.ignoreUntil) return false;
    if (bI === "set" && !b.ignoreUntil) return false;
    if (vf && (b.vendors || "").indexOf(vf) < 0) return false;
    return true;
  }).map(b => ({ ...b, fee: feMap[b.j] })), [data.bundles, vf, feMap, bA, bI]);

  const sc = useMemo(() => { const c = { critical: 0, warning: 0, healthy: 0 }; enr.forEach(x => c[x.status]++); return c }, [enr]);

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
  const tot = useMemo(() => { let d = 0, a = 0, n = 0, o = 0, co = 0; enr.forEach(c => { d += c.dsr; a += c.allIn; n += c.needQty; o += c.orderQty; co += c.needDollar }); return { d, a, n, o, co } }, [enr]);

  const vG = useMemo(() => {
    if (vm !== "vendor") return [];
    const g = {};
    enr.forEach(c => { if (!g[c.ven]) g[c.ven] = { v: vMap[c.ven] || { name: c.ven }, cores: [], bundles: [] }; g[c.ven].cores.push(c) });
    Object.keys(g).forEach(vn => { g[vn].bundles = venBundles.filter(b => (b.vendors || "").indexOf(vn) >= 0) });
    return Object.values(g).filter(grp => vf || showIgnored || !isIgnored(grp.v.name)).sort((a, b) => b.cores.filter(c => c.status === "critical").length - a.cores.filter(c => c.status === "critical").length);
  }, [enr, vm, vMap, venBundles, isIgnored, showIgnored]);

  const getPOI = (cores, bundles) => {
    const items = [];
    cores.filter(c => hasCoreOrd(c)).forEach(c => {
      const cogpOv = gCogP(c.id);
      items.push({ id: c.id, ti: c.ti, vsku: c.vsku, qty: coreEffQ(c), cost: cogpOv > 0 ? cogpOv : c.cost, cp: c.casePack || 1, inbS: gInbS(c.id), isCoreItem: true });
    });
    (bundles || []).filter(b => hasBundleOrd(b)).forEach(b => {
      const f = feMap[b.j];
      const cogpOv = gCogP(b.j);
      const baseCost = f?.aicogs || b.aicogs || 0;
      items.push({ id: b.j, ti: b.t, vsku: b.asin || b.bundleCode, qty: bundleEffQ(b), cost: cogpOv > 0 ? cogpOv : baseCost, cp: 1, inbS: gInbS(b.j), isCoreItem: false });
    });
    return items;
  };

  const autoPO = (vendorCode) => { if (poN) return poN; const d = new Date(); const serial = Math.floor((d - new Date(1899, 11, 30)) / 86400000); return 'PO-' + serial + '-' + (vendorCode || 'XXX') };

  // === FILL REC v2 — thin wrapper, just applies the recommender's decisions ===
  const fillR = (cores, bundles, mode, vendorName) => {
    const vendor = vMap[vendorName];
    if (!vendor) return;

    // mode: 'cores' | 'bundles' | 'mix'
    //   'cores'   → force everything as core
    //   'bundles' → force everything as bundle
    //   'mix'     → use historical 7f detection per bundle
    const forceMode = mode === 'cores' ? 'cores' : mode === 'bundles' ? 'bundles' : null;

    // If forceMode differs from the default, recompute; else use the cached rec.
    const rec = forceMode
      ? calcVendorRecommendation({
          vendor,
          cores: data.cores || [],
          bundles: data.bundles || [],
          bundleSales: data._bundleSales || [],
          receivingFull: data.receivingFull || [],
          replenMap,
          missingMap,
          settings: stg,
          purchFreqSafety: purchFreqMap[vendorName]?.safetyMultiplier || 1.0,
          forceMode,
        })
      : vendorRecs[vendorName];

    if (!rec || !rec.items?.length) {
      setToast("Nothing to fill");
      return;
    }

    const u = { ...ov };
    for (const item of rec.items) {
      if (item.finalQty > 0) {
        u[item.id] = { ...(u[item.id] || {}), pcs: item.finalQty };
      }
    }
    setOv(u);
    setToast(`Fill Rec: ${rec.items.length} items, ${$(rec.totalCost)}`);
  };

  // === FILL TO MOQ — incrementally add cases to items until vendor MOQ is met ===
  // Strategy: keep adding a casepack to the item with the lowest projected DOC.
  const doFillMOQ = (grpCores, grpBundles, vendorMOQDollar) => {
    // Current total from user's edited state
    let currentTotal = 0;
    grpCores.forEach(c => {
      if (!hasCoreOrd(c)) return;
      const cogpOv = gCogP(c.id);
      currentTotal += coreEffQ(c) * (cogpOv > 0 ? cogpOv : c.cost);
    });
    if (vendorSub !== "cores") (grpBundles || []).filter(b => hasBundleOrd(b)).forEach(b => {
      const f = feMap[b.j];
      const cogpOv = gCogP(b.j);
      const baseCost = f?.aicogs || 0;
      currentTotal += bundleEffQ(b) * (cogpOv > 0 ? cogpOv : baseCost);
    });
    if (currentTotal >= vendorMOQDollar) { setToast("Already at/above MOQ"); return; }

    // Build a list of addable items (only those already being ordered)
    const addable = grpCores.filter(c => hasCoreOrd(c) && c.cost > 0 && c.dsr > 0).map(c => ({
      id: c.id,
      isCore: true,
      casePack: c.casePack || 1,
      cost: gCogP(c.id) > 0 ? gCogP(c.id) : c.cost,
      dsr: c.dsr,
      ref: c,
    }));

    if (addable.length === 0) { setToast("No orderable items — click Fill Rec first"); return; }

    const u = { ...ov };
    let added = 0;
    let safety = 0;
    while (currentTotal < vendorMOQDollar && safety < 500) {
      safety++;
      // pick the item with the lowest current projected DOC
      addable.forEach(a => {
        const q = (u[a.id]?.pcs ?? 0) || 0;
        a.projDOC = a.dsr > 0 ? (cAI(a.ref) + q) / a.dsr : 99999;
      });
      addable.sort((x, y) => x.projDOC - y.projDOC);
      const pick = addable[0];
      if (!pick) break;
      const step = pick.casePack;
      const cur = u[pick.id]?.pcs ?? 0;
      u[pick.id] = { ...(u[pick.id] || {}), pcs: cur + step };
      currentTotal += step * pick.cost;
      added += step * pick.cost;
    }
    setOv(u);
    setToast("MOQ filled: +" + $(added));
  };

  const clrV = (cores, bundles) => { const u = { ...ov }; cores.forEach(c => { delete u[c.id] }); (bundles || []).forEach(b => { delete u[b.j] }); setOv(u) };
  const togPH = id => setShowPH(p => ({ ...p, [id]: !p[id] }));
  const togCollapse = id => setCollapsed(p => ({ ...p, [id]: !p[id] }));
  const togDismiss = id => setDismissed(p => ({ ...p, [id]: !p[id] }));

  const openBreakdown = useCallback((c) => {
    const v = vMap[c.ven] || {}; const lt = v.lt || 30; const tg = gTD(v, stg);
    const profile = profiles[c.id] || DEFAULT_PROFILE;
    const pf = purchFreqMap[c.ven];
    setBreakdown(getCalcBreakdown(c, v, stg, profile, lt, tg, pf));
  }, [vMap, stg, profiles, purchFreqMap]);

  const getCombinedRec = (coreId) => { const recs = [...(recMap[coreId] || [])]; (data.bundles || []).filter(b => b.core1 === coreId && b.active === "Yes").forEach(b => { if (recMap[b.j]) recs.push(...recMap[b.j]) }); return recs.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 7) };
  const hasRecData = (coreId) => recMap[coreId]?.length || (data.bundles || []).some(b => b.core1 === coreId && b.active === "Yes" && recMap[b.j]?.length);

  // === CORE ROW ===
  const CoreRow = ({ c }) => {
    if (dismissed[c.id]) return <tr className="border-t border-gray-800/20 bg-gray-900/30 text-xs opacity-40"><td className="py-1 px-1" colSpan={2}><Dot status={c.status} /></td><td className="py-1 px-1 text-gray-500 font-mono">{c.id}</td><td className="py-1 px-1 text-gray-600 truncate max-w-[110px]">{c.ti}</td><td colSpan={20} className="py-1 px-1 text-right"><button onClick={() => togDismiss(c.id)} className="text-xs text-gray-500 hover:text-white px-1">+</button></td></tr>;
    const eq = coreEffQ(c);
    const cogpOverride = gCogP(c.id);
    const cost = eq * (cogpOverride > 0 ? cogpOverride : c.cost);

    // Effective After DOC:
    // Sum current bundle availability (from waterfall) + user's edited bundle orders
    // + the share of user's edited core order distributed proportionally.
    const cBundles = (data.bundles || []).filter(b => {
      if (b.active !== "Yes") return false;
      for (let i = 1; i <= 20; i++) if (b['core' + i] === c.id) return true;
      return false;
    });
    let ad = null;
    if (eq > 0 && c.dsr > 0) {
      // Aggregate bundle dimension: sum of bundle units available + bundle orders placed
      // Then map back to core pieces: totalCorePiecesAvailable/c.dsr ≈ ad
      ad = Math.round((c.allIn + eq) / c.dsr);
    } else if (c.dsr > 0) {
      ad = Math.round(c.allIn / c.dsr);
    }

    const isCol = collapsed[c.id];
    const combinedRec = showPH[c.id] ? getCombinedRec(c.id) : [];
    const hasSeasonal = c.sProfile?.hasHistory;
    const isUrgent = c.sCoverage?.urgent;

    return <><tr className={`border-t border-gray-800/30 hover:bg-gray-800/20 text-xs ${hasCoreOrd(c) ? "bg-emerald-900/10" : ""} ${isUrgent ? "bg-red-900/10" : ""}`}>
      <td className="py-1 px-0.5 sticky left-0 bg-gray-950 z-10 w-4"><Dot status={c.status} /></td>
      <td className="py-1 px-0.5 sticky left-4 bg-gray-950 z-10 whitespace-nowrap"><button onClick={() => goCore(c.id)} className="text-blue-400 font-mono hover:underline text-[11px]">{c.id}</button></td>
      <td className="py-1 px-1 text-gray-200 truncate max-w-[130px] sticky left-[85px] bg-gray-950 z-10">
        {c.ti}
        {isUrgent && <span className="ml-1 text-red-400 text-[9px] font-bold" title="Bundle will stockout before LT arrives">⚠OOS</span>}
        {c.invAnomaly && <span className="ml-1 text-amber-400 text-[9px] font-bold" title="Sheet DOC vs calculated DOC mismatch >20%">⚠INV</span>}
        {c.rawPendingBundles && <span className="ml-1 text-cyan-400 text-[9px] font-bold" title="Has raw available + bundles with DOC < 60. Consider processing raw into bundles instead of buying.">⚙PROC</span>}
        {c.moqInflated && <span className="ml-1 text-orange-400 text-[9px] font-bold" title={`MOQ forces ${Math.round(c.moqInflationRatio * 100)}% of actual need. Excess: ${R(c.excessFromMoq)} pcs / $${Math.round(c.excessCostFromMoq).toLocaleString()}`}>⚠MOQ</span>}
        {c.bundlesAffected > 0 && <span className="ml-1 text-[9px] text-gray-500" title={`Need driven by ${c.bundlesAffected} bundle(s)`}>({c.bundlesAffected}b)</span>}
      </td>
      <SC v={c.dsr} className="py-1 px-1 text-right">{D1(c.dsr)}</SC>
      <SC v={c.d7} className="py-1 px-1 text-right">{D1(c.d7)}</SC>
      <td className="py-1 px-1 text-center">{c.d7 > c.dsr ? <span className={c.spike ? "text-orange-400 font-bold" : "text-emerald-400"}>▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}{c.spike && <span className="text-orange-400 text-xs ml-0.5">⚡</span>}</td>
      <SC v={c.doc} className={`py-1 px-1 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</SC>
      <SC v={c.allIn} className="py-1 px-1 text-right">{R(c.allIn)}</SC>
      <td className="py-1 px-1 text-right text-gray-400">{c.moq > 0 ? R(c.moq) : "—"}</td>
      <td className="py-1 px-1 text-right text-gray-400">{c.casePack > 0 ? R(c.casePack) : "—"}</td>
      <td className="py-1 px-1 text-center">{c.seas && <span className="text-purple-400 font-bold">{c.seas.peak}</span>}</td>
      {!isCol && <><SC v={c.raw} className="py-1 px-1 text-right">{R(c.raw)}</SC><SC v={c.pp} className="py-1 px-1 text-right">{R(c.pp)}</SC><SC v={c.inb} className="py-1 px-1 text-right">{R(c.inb)}</SC><SC v={c.fba} className="py-1 px-1 text-right">{R(c.fba)}</SC></>}
      {showRS && <td colSpan={8} />}
      <td className="py-1 border-l-2 border-gray-600 px-1" />
      <td className="py-0.5 px-0.5 sticky right-36 bg-gray-950 z-10"><NumInput value={gPcs(c.id)} onChange={v => setF(c.id, 'pcs', v)} /></td>
      <td className="py-0.5 px-0.5 sticky right-24 bg-gray-950 z-10"><NumInput value={gCas(c.id)} onChange={v => setF(c.id, 'cas', v)} /></td>
      {showCosts && <><td className="py-0.5 px-0.5"><NumInput value={gInbS(c.id)} onChange={v => setF(c.id, 'inbS', v)} /></td><td className="py-0.5 px-0.5"><NumInput value={gCogP(c.id)} onChange={v => setF(c.id, 'cogP', v)} /></td><td className="py-0.5 px-0.5"><NumInput value={gCogC(c.id)} onChange={v => setF(c.id, 'cogC', v)} /></td></>}

      <SC v={cost} className="py-1 px-1 text-right text-amber-300 sticky right-12 bg-gray-950 z-10">{cost > 0 ? $(cost) : "—"}</SC>
      <td className={`py-1 px-1 text-right sticky right-0 bg-gray-950 z-10 ${ad ? dc(ad, c.critDays, c.warnDays) : "text-gray-500"}`}>{ad ? R(ad) : "—"}</td>
      <td className="py-1 px-0.5 flex gap-0.5">
        <button onClick={() => togCollapse(c.id)} className="text-gray-400 hover:text-white text-xs px-0.5">{isCol ? "+" : "−"}</button>
        <button onClick={() => togDismiss(c.id)} className="text-gray-400 hover:text-red-400 text-xs px-0.5">✕</button>
        {(pcMap[c.id] || hasRecData(c.id)) && <button onClick={() => togPH(c.id)} className={`text-xs px-0.5 rounded ${showPH[c.id] ? "text-amber-300" : "text-gray-500"}`}>$</button>}
        <button onClick={() => openBreakdown(c)} className={`text-xs px-0.5 rounded ${hasSeasonal ? "text-purple-400" : "text-gray-600"}`} title="Seasonal Breakdown (legacy core-level view)">📊</button>
        <button onClick={() => goCore(c.id)} className="text-blue-400 px-0.5 bg-blue-400/10 rounded text-xs">V</button>
        <div className="relative"><WorkflowChip id={c.id} type="core" workflow={data.workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer} country={c.vc} /></div>
      </td>
    </tr>
      {showPH[c.id] && (pcMap[c.id] || combinedRec.length > 0) && <tr><td colSpan={40} className="p-0"><div className="bg-gray-800/50 px-4 py-2 space-y-3">
        {pcMap[c.id] && <div><div className="text-gray-500 text-xs font-semibold mb-1">💰 Purchase History (7g)</div><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="py-0.5 text-left">Date</th><th className="py-0.5 text-right">Pcs</th><th className="py-0.5 text-right">Material</th><th className="py-0.5 text-right">Inb Ship</th><th className="py-0.5 text-right">Tariffs</th><th className="py-0.5 text-right">Total</th><th className="py-0.5 text-right">CPP</th></tr></thead><tbody>{pcMap[c.id].map((r, i) => <tr key={i} className="border-t border-gray-700/30"><td className="py-0.5 text-gray-300">{fDateUS(r.date)}</td><td className="py-0.5 text-right">{R(r.pcs)}</td><td className="py-0.5 text-right">{$2(r.matPrice)}</td><td className="py-0.5 text-right text-gray-400">{$2(r.inbShip)}</td><td className="py-0.5 text-right text-gray-400">{$2(r.tariffs)}</td><td className="py-0.5 text-right">{$2(r.totalCost)}</td><td className="py-0.5 text-right text-amber-300">{$2(r.cpp)}</td></tr>)}</tbody></table></div>}
        {combinedRec.length > 0 && <div><div className="text-gray-500 text-xs font-semibold mb-1">📦 Receiving (7f)</div><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="py-0.5 text-left">Date</th><th className="py-0.5 text-left">Vendor</th><th className="py-0.5 text-left">ID</th><th className="py-0.5 text-right">Pcs</th><th className="py-0.5 text-right">Cases</th><th className="py-0.5 text-left">Order #</th><th className="py-0.5 text-right">Missing</th></tr></thead><tbody>{combinedRec.map((r, i) => <tr key={i} className="border-t border-gray-700/30"><td className="py-0.5 text-gray-300">{fDateUS(r.date) || "—"}</td><td className="py-0.5 text-gray-300">{r.vendor || "—"}</td><td className="py-0.5 text-blue-400 font-mono">{r.core}</td><td className="py-0.5 text-right text-white">{R(r.pcs)}</td><td className="py-0.5 text-right">{r.cases > 0 ? R(r.cases) : "—"}</td><td className="py-0.5 text-gray-300">{r.orderNum || "—"}</td><td className={`py-0.5 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-500"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td></tr>)}</tbody></table></div>}
      </div></td></tr>}</>
  };

  // === BUNDLE ROW ===
  const BundleRow = ({ b }) => {
    const f = b.fee || feMap[b.j];
    const eq = bundleEffQ(b);
    const cogpOverride = gCogP(b.j);
    const cost = cogpOverride > 0 ? (eq * cogpOverride) : (f ? (eq * (f.aicogs || 0)) : 0);
    const aged = agedMap[b.j];
    const kill = killMap[b.j];
    const inb7f = missingMap[b.j] || 0;
    const rp = replenMap[b.j];
    const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0;
    const bCasePack = casePackFromRec[b.j] || 0;

    // Effective DOC comes from the v2 waterfall: totalAvailable already includes
    // this bundle's share of core raw, post-distribution. Adding user's edited qty
    // on top gives the "after this order" DOC.
    const bd = bundleEffMap[b.j];
    const effDSR = bd?.effectiveDSR || b.cd || 0;
    const totalAvail = bd?.totalAvailable ?? ((b.fibInv || 0) + (rp?.pprcUnits || 0) + (rp?.batched || 0) + inb7f);
    const effectiveDOC = effDSR > 0 ? Math.round((totalAvail + eq) / effDSR) : null;
    const urgentBundle = bd?.urgent;
    const buyNeedBundle = bd?.buyNeed || 0;

    return <tr className={`border-t border-gray-800/20 hover:bg-indigo-900/10 text-xs ${hasBundleOrd(b) ? "bg-emerald-900/10" : "bg-indigo-950/30"} ${urgentBundle ? "bg-red-900/10" : ""}`}>
      <td className="py-1 px-0.5 sticky left-0 bg-indigo-950/30 z-10 w-4 border-l-2 border-indigo-500/40" />
      <td className="py-1 px-0.5 sticky left-4 bg-indigo-950/30 z-10 whitespace-nowrap"><button onClick={() => goBundle(b.j)} className="text-indigo-400 font-mono hover:underline text-[11px]">{b.j}</button></td>
      <td className="py-1 px-1 text-indigo-200 truncate max-w-[130px] sticky left-[85px] bg-indigo-950/30 z-10">
        {b.t}
        {b.asin && <a href={`https://sellercentral.amazon.com/myinventory/inventory?fulfilledBy=all&page=1&pageSize=25&searchField=all&searchTerm=${b.asin}&sort=date_created_desc&status=all`} target="_blank" rel="noopener noreferrer" className="ml-1 text-gray-500 hover:text-blue-400 text-[9px] font-mono">{b.asin}</a>}
        {urgentBundle && <span className="ml-1 text-red-400 text-[9px] font-bold" title="Will stockout before LT">⚠OOS</span>}
        {aged && aged.fbaHealth !== "Healthy" && <span className={`ml-1 text-xs ${aged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{aged.fbaHealth}</span>}
        {aged && aged.storageLtsf > 0 && <span className="ml-1 text-xs text-red-300">${aged.storageLtsf.toFixed(0)}</span>}
        {kill && kill.latestEval && kill.latestEval.toLowerCase().includes('kill') && <span className="ml-1 text-xs text-red-400 font-bold">KILL</span>}
        {kill && kill.sellEval && kill.sellEval.toLowerCase().includes('sell') && <span className="ml-1 text-xs text-amber-400 font-bold">ST</span>}
      </td>
      <SC v={b.cd} className="py-1 px-1 text-right text-indigo-300">{D1(b.cd)}</SC>
      <SC v={b.d7comp} className="py-1 px-1 text-right text-indigo-300">{D1(b.d7comp)}</SC>
      <td className="py-1 px-1 text-center">{b.d7comp > b.cd ? <span className="text-emerald-400">▲</span> : b.d7comp < b.cd ? <span className="text-red-400">▼</span> : "—"}</td>
      <SC v={b.doc} className="py-1 px-1 text-right text-indigo-300">{R(b.doc)}</SC>
      <td className="py-1 px-1 text-right text-gray-700" /><td className="py-1 px-1 text-gray-700" />
      <td className="py-1 px-1 text-gray-500 text-right">{bCasePack > 0 ? R(bCasePack) : ""}</td>
      <td className="py-1 px-1 text-center text-indigo-300">{b.replenTag || ""}</td>
      {!collapsed[b.j] && <td colSpan={4} />}
      {showRS && <><td className="py-1 border-l-2 border-cyan-800 px-0.5" /><SC v={b.fibDoc} className="py-1 px-1 text-right text-cyan-300">{R(b.fibDoc)}</SC><td className={`py-1 px-1 text-right ${margin >= 30 ? "text-emerald-400" : margin >= 15 ? "text-amber-400" : margin > 0 ? "text-red-400" : "text-gray-600"}`}>{margin > 0 ? Math.round(margin) + "%" : "—"}</td><SC v={rp?.rawUnits} className="py-1 px-1 text-right">{R(rp?.rawUnits || 0)}</SC><SC v={rp?.batched} className="py-1 px-1 text-right">{R(rp?.batched || 0)}</SC><SC v={b.fibInv} className="py-1 px-1 text-right text-cyan-300">{R(b.fibInv || 0)}</SC><SC v={rp?.pprcUnits} className="py-1 px-1 text-right">{R(rp?.pprcUnits || 0)}</SC><td className="py-1 px-1 text-right text-red-400">{inb7f > 0 ? R(inb7f) : "0"}</td></>}
      <td className="py-1 border-l-2 border-gray-600 px-1" />
      <td className="py-0.5 px-0.5 sticky right-36 bg-indigo-950/30 z-10"><NumInput value={gPcs(b.j)} onChange={v => setF(b.j, 'pcs', v)} /></td>
      <td className="py-0.5 px-0.5 sticky right-24 bg-indigo-950/30 z-10"><NumInput value={gCas(b.j)} onChange={v => setF(b.j, 'cas', v)} /></td>
      {showCosts && <><td className="py-0.5 px-0.5"><NumInput value={gInbS(b.j)} onChange={v => setF(b.j, 'inbS', v)} /></td><td className="py-0.5 px-0.5"><NumInput value={gCogP(b.j)} onChange={v => setF(b.j, 'cogP', v)} /></td><td className="py-0.5 px-0.5"><NumInput value={gCogC(b.j)} onChange={v => setF(b.j, 'cogC', v)} /></td></>}
      <SC v={cost} className="py-1 px-1 text-right text-amber-300 sticky right-12 bg-indigo-950/30 z-10">{cost > 0 ? $(cost) : "—"}</SC>
      <td className={`py-1 px-1 text-right sticky right-0 bg-indigo-950/30 z-10 ${effectiveDOC ? (effectiveDOC <= 30 ? "text-red-400" : effectiveDOC <= 60 ? "text-amber-400" : "text-emerald-400") : "text-gray-600"}`}>{effectiveDOC ? R(effectiveDOC) : "—"}</td>
      <td className="py-1 px-1"><button onClick={() => goBundle(b.j)} className="text-indigo-400 px-0.5 bg-indigo-400/10 rounded text-xs">V</button></td>
    </tr>;
  };

  const rsToggle = <button onClick={() => setShowRS(!showRS)} className={`text-xs px-1 py-0.5 rounded font-bold ${showRS ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400"}`}>{showRS ? "−" : "+"}RS</button>;
  const costsToggle = <button onClick={() => setShowCosts(!showCosts)} className={`text-xs px-1 py-0.5 rounded font-bold ${showCosts ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-400"}`}>{showCosts ? "−" : "+"}$</button>;

  const VTH = ({ isCol }) => <tr className="text-gray-500 uppercase bg-gray-900 text-xs sticky top-0 z-20">
    <th className="py-2 px-1 w-5 sticky left-0 bg-gray-900 z-30" />
    <TH tip="Core or JLS #" className="py-2 px-1 text-left sticky left-5 bg-gray-900 z-30">ID</TH>
    <th className="py-2 px-1 text-left sticky left-24 bg-gray-900 z-30">Title</th>
    <TH tip="Composite DSR" className="py-2 px-1 text-right">DSR</TH><TH tip="7-Day DSR" className="py-2 px-1 text-right">7D</TH><TH tip="Trend" className="py-2 px-1 text-center">T</TH><TH tip="Days of Coverage" className="py-2 px-1 text-right">DOC</TH><TH tip="All-In" className="py-2 px-1 text-right">All-In</TH><TH tip="MOQ" className="py-2 px-1 text-right">MOQ</TH><TH tip="Case Pack" className="py-2 px-1 text-right">VCas</TH><TH tip="Seasonal" className="py-2 px-1 text-center">S</TH>
    {!isCol && <><TH tip="Raw" className="py-2 px-1 text-right">Raw</TH><TH tip="PPRC" className="py-2 px-1 text-right">PPRC</TH><TH tip="Inbound" className="py-2 px-1 text-right">Inb</TH><TH tip="FBA Pcs" className="py-2 px-1 text-right">FBA Pcs</TH></>}
    {showRS && <><th className="py-2 border-l-2 border-cyan-800 px-0.5" /><TH tip="FIB DOC" className="py-2 px-1 text-right text-cyan-400">FibDoc</TH><TH tip="Margin" className="py-2 px-1 text-right text-cyan-400">Mrgn</TH><TH tip="Raw" className="py-2 px-1 text-right text-cyan-400">Raw</TH><TH tip="Batch" className="py-2 px-1 text-right text-cyan-400">Batch</TH><TH tip="FIB" className="py-2 px-1 text-right text-cyan-400">FIB</TH><TH tip="PPRC" className="py-2 px-1 text-right text-cyan-400">PPRC</TH><TH tip="7f Miss" className="py-2 px-1 text-right text-red-400">7f Miss</TH></>}
    <th className="py-2 border-l-2 border-gray-600 px-1" />
    <TH tip="Pieces" className="py-2 px-1 text-center sticky right-36 bg-gray-900 z-30">Pcs</TH><TH tip="Cases" className="py-2 px-1 text-center sticky right-24 bg-gray-900 z-30">Cas</TH>
    {showCosts && <><TH tip="InbS" className="py-2 px-1 text-center">InbS</TH><TH tip="CogP" className="py-2 px-1 text-center">CogP</TH><TH tip="CogC" className="py-2 px-1 text-center">CogC</TH></>}
    <th className="py-2 px-1 text-right sticky right-12 bg-gray-900 z-30">Cost</th>
    <TH tip="After DOC" className="py-2 px-1 text-right sticky right-0 bg-gray-900 z-30">After</TH>
    <th className="py-2 px-1 w-20">{rsToggle} {costsToggle}</th>
  </tr>;

  return <div className="p-4">{toast && <Toast msg={toast} onClose={() => { setToast(null); setToastPersist(false); }} persist={toastPersist} />}
    {breakdown && <CalcBreakdown data={breakdown} onClose={() => setBreakdown(null)} />}
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <div className="flex bg-gray-800 rounded-lg p-0.5">{["core", "vendor"].map(m => <button key={m} onClick={() => setVm(m)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm === m ? "bg-blue-600 text-white" : "text-gray-400"}`}>{m === "core" ? "By Core" : "By Vendor"}</button>)}</div>
      <SS value={vf} onChange={setVf} options={vNames} />
      <select value={sf} onChange={e => setSf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="">All Status</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>
      {!vf && <select value={locF} onChange={e => setLocF(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="us">US Only</option><option value="intl">International</option></select>}
      <select value={nf} onChange={e => setNf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="need">Needs Buy</option><option value="ok">No Need</option></select>
      {vm === "core" && <><select value={sort} onChange={e => setSort(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="status">Priority</option><option value="doc">DOC</option><option value="dsr">DSR</option><option value="need$">$</option></select><span className="text-gray-500 text-xs">Min:</span><input type="number" value={minD} onChange={e => setMinD(+e.target.value)} className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1 w-14" /></>}
      {vm === "vendor" && <div className="flex bg-gray-800 rounded-lg p-0.5">{[["mix", "Mix (auto)"], ["cores", "Force Cores"], ["bundles", "Force Bundles"]].map(([k, l]) => <button key={k} onClick={() => setVendorSub(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${vendorSub === k ? "bg-indigo-600 text-white" : "text-gray-400"}`}>{l}</button>)}</div>}
      <div className="flex gap-2 ml-auto text-xs"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{sc.critical}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{sc.warning}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{sc.healthy}</span><span className="text-gray-500">|</span><span className="text-gray-300 font-semibold">{enr.length}</span>
        {vm === "vendor" && <button
          onClick={() => setShowNoBundleCores(!showNoBundleCores)}
          className={`ml-1 px-2 py-0.5 rounded text-xs ${showNoBundleCores ? "bg-amber-500/20 text-amber-400" : "bg-gray-700 text-gray-500"}`}
        >
          {showNoBundleCores ? "Hide" : "Show"} No-Bundle
        </button>}
        <button onClick={() => setShowIgnored(!showIgnored)} className={`ml-1 px-2 py-0.5 rounded text-xs ${showIgnored ? "bg-red-500/20 text-red-400" : "bg-gray-700 text-gray-500"}`}>{showIgnored ? "Hide" : "Show"} Ignored</button>
      </div>
    </div>
    {vm === "vendor" && <div className="flex flex-wrap gap-3 mb-4 items-center text-sm"><span className="text-gray-500 text-xs">PO#:</span><input type="text" value={poN} onChange={e => setPoN(e.target.value)} placeholder="Auto" className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 w-28 text-sm" />{!vf && <><span className="text-gray-500 text-xs">Date:</span><input type="date" value={poD} onChange={e => setPoD(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-sm" /></>}<span className="text-gray-500 text-xs">Buyer:</span><span className="text-white font-semibold">{stg.buyer || <span className="text-red-400">Set in ⚙️</span>}</span></div>}

    {vm === "core" && <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead><tr className="bg-gray-900/80 text-xs text-gray-400 uppercase sticky top-0 z-20"><th className="py-3 px-2 w-8" /><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left">Vendor</th><th className="py-3 px-2 text-left">Title</th><TH tip="DSR" className="py-3 px-2 text-right">DSR</TH><TH tip="7D" className="py-3 px-2 text-right">7D</TH><th className="py-3 px-2 text-center">T</th><TH tip="DOC" className="py-3 px-2 text-right">DOC</TH><TH tip="All-In" className="py-3 px-2 text-right">All-In</TH><th className="py-3 px-2 text-right">MOQ</th><th className="py-3 px-2 text-center">S</th><th className="py-3 px-1 border-l-2 border-gray-600" /><TH tip="Need (bundle-driven)" className="py-3 px-2 text-right">Need</TH><th className="py-3 px-2 text-right">Order</th><th className="py-3 px-2 text-right">Cost</th><TH tip="After DOC" className="py-3 px-2 text-right">After</TH><th className="py-3 px-2 w-14" /></tr></thead>
      <tbody>{enr.map(c => <tr key={c.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 text-sm ${c.sCoverage?.urgent ? "bg-red-900/10" : ""}`}><td className="py-2 px-2"><Dot status={c.status} /></td><td className="py-2 px-2"><button onClick={() => goCore(c.id)} className="text-blue-400 font-mono text-xs hover:underline">{c.id}</button></td><td className="py-2 px-2 text-blue-300 text-xs truncate max-w-[100px] cursor-pointer hover:underline" onClick={() => goVendor(c.ven)}>{c.ven}</td><td className="py-2 px-2 text-gray-200 truncate max-w-[180px]">{c.ti}{c.sCoverage?.urgent && <span className="ml-1 text-red-400 text-xs font-bold">⚠OOS</span>}{c.invAnomaly && <span className="ml-1 text-amber-400 text-xs font-bold">⚠INV</span>}{c.rawPendingBundles && <span className="ml-1 text-cyan-400 text-xs font-bold" title="Has raw + bundles with low DOC">⚙PROC</span>}{c.bundlesAffected > 0 && <span className="ml-1 text-xs text-gray-500">({c.bundlesAffected}b)</span>}</td><td className="py-2 px-2 text-right">{D1(c.dsr)}</td><td className="py-2 px-2 text-right">{D1(c.d7)}</td><td className="py-2 px-2 text-center">{c.d7 > c.dsr ? <span className="text-emerald-400">▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}</td><td className={`py-2 px-2 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</td><td className="py-2 px-2 text-right">{R(c.allIn)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{c.moq > 0 ? R(c.moq) : "—"}</td><td className="py-2 px-2 text-center">{c.seas && <span className="text-purple-400 text-xs font-bold">{c.seas.peak}</span>}</td><td className="py-2 px-1 border-l-2 border-gray-600" /><td className="py-2 px-2 text-right">{c.needQty > 0 ? (
        c.moqInflated ? (
          <span title={`Real need: ${R(c.needQty)} · MOQ forces: ${R(c.orderQty)}`}>
            <span className="text-gray-300">{R(c.needQty)}</span>
            <span className="text-orange-400 text-xs ml-1">→{R(c.orderQty)}</span>
          </span>
        ) : <span className="text-gray-300">{R(c.needQty)}</span>
      ) : "—"}</td><td className="py-2 px-2 text-right text-white font-semibold">{c.orderQty > 0 ? R(c.orderQty) : "—"}</td><td className="py-2 px-2 text-right text-amber-300">{c.needDollar > 0 ? $(c.needDollar) : "—"}</td><td className={`py-2 px-2 text-right ${c.orderQty > 0 ? dc(c.docAfter, c.critDays, c.warnDays) : "text-gray-500"}`}>{c.orderQty > 0 ? R(c.docAfter) : "—"}</td><td className="py-2 px-2 flex gap-1"><button onClick={() => openBreakdown(c)} className={`text-xs px-1 rounded ${c.sProfile?.hasHistory ? "text-purple-400" : "text-gray-600"}`}>📊</button><button onClick={() => goCore(c.id)} className="text-blue-400 text-xs px-1.5 py-0.5 bg-blue-400/10 rounded">V</button></td></tr>)}</tbody>
      <tfoot><tr className="bg-gray-900 border-t-2 border-gray-700 text-sm font-semibold"><td colSpan={4} className="py-3 px-2 text-gray-300">{enr.length}</td><td className="py-3 px-2 text-right text-white">{D1(tot.d)}</td><td colSpan={3} /><td className="py-3 px-2 text-right text-white">{R(tot.a)}</td><td colSpan={2} /><td className="border-l-2 border-gray-600" /><td className="py-3 px-2 text-right">{R(tot.n)}</td><td className="py-3 px-2 text-right text-white">{R(tot.o)}</td><td className="py-3 px-2 text-right text-amber-300">{$(tot.co)}</td><td colSpan={2} /></tr></tfoot>
    </table></div>}

    {vm === "vendor" && vG.map(grp => {
      const v = grp.v; const tg = gTD(v, stg);
      const poI = getPOI(grp.cores, vendorSub !== "cores" ? grp.bundles : []);
      const poT = poI.reduce((s, i) => s + i.qty * i.cost, 0);
      const poC = poI.reduce((s, i) => s + (v.vou === 'Cases' && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : 0), 0);
      const meets = v.moqDollar > 0 ? poT >= v.moqDollar : true;
      const anyCol = Object.values(collapsed).some(Boolean);
      const vendorPO = autoPO(v.code);
      const moqGap = (v.moqDollar || 0) - poT;
      const pf = purchFreqMap[v.name];
      const vRec = vendorRecs[v.name];

      // How many bundles would be bought as "bundle" mode vs "core" mode (for visibility)
      const bundlesInBundleMode = vRec?.bundleItems?.length || 0;
      const bundlesInCoreMode = (vRec?.bundleDetails || []).filter(bd => bd.buyMode === 'core' && bd.buyNeed > 0).length;

      return <div key={v.name} className="mb-5 border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-white font-semibold cursor-pointer hover:text-blue-400 hover:underline" onClick={() => window.open(window.location.pathname + '?vendor=' + encodeURIComponent(v.name), '_blank')}>{v.name}</span>
            <div className="relative"><WorkflowChip id={v.name} type="vendor" workflow={data.workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer} country={v.country} /></div>
            <div className="relative"><VendorNotes vendor={v.name} comments={data.vendorComments} onSave={saveVendorComment} buyer={stg.buyer} /></div>
            {v.country && <span className="text-xs text-gray-500">{v.country}</span>}
            <span className="text-xs text-gray-400">LT:{v.lt}d</span>
            <span className="text-xs text-gray-400">Buf:{grp.cores[0]?.buf || 14}d</span>
            <span className="text-xs text-gray-400">MOQ:{$(v.moqDollar)}</span>
            <span className="text-xs text-gray-400">Tgt:{tg}d</span>
            <span className="text-xs text-gray-400">{v.payment}</span>
            {pf && pf.comment && <span className="text-xs text-amber-400">{pf.comment}</span>}
            {pf && <span className="text-xs text-gray-500">{pf.ordersPerYear}/yr · ×{pf.safetyMultiplier}</span>}
            {(bundlesInBundleMode > 0 || bundlesInCoreMode > 0) && <span className="text-xs text-cyan-400" title="Recommender's buy-mode split per bundle (from 7f history)">
              Mix: {bundlesInCoreMode} core · {bundlesInBundleMode} bundle
            </span>}
            {(() => {
              const totalExcessMoq = grp.cores.filter(c => c.moqInflated).reduce((s, c) => s + c.excessCostFromMoq, 0);
              const countInflated = grp.cores.filter(c => c.moqInflated).length;
              if (totalExcessMoq === 0) return null;
              return <span className="text-xs text-orange-400" title="Sum of excess inventory $ forced by MOQ across cores in this vendor">
                ⚠ MOQ excess: ${Math.round(totalExcessMoq).toLocaleString()} ({countInflated} cores)
              </span>;
            })()}
            {poI.length === 0 ? <span className="ml-auto text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">—</span> : <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${meets ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>{meets ? "✓" : "!"} {$(poT)}{poC > 0 ? " / " + poC + "cs" : ""}</span>}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => fillR(grp.cores, grp.bundles, vendorSub, v.name)} className={`text-xs px-2.5 py-1 rounded ${data._coreInv?.length ? "bg-blue-600/80 text-white" : "bg-yellow-600 text-white animate-pulse"}`}>{data._coreInv?.length ? "Fill Rec" : "Fill Rec ⏳"}</button>
            <button onClick={() => doFillMOQ(grp.cores, grp.bundles, v.moqDollar || 0)} disabled={!v.moqDollar || poT >= v.moqDollar || poI.length === 0} className={`text-xs px-2.5 py-1 rounded font-medium ${v.moqDollar && poT < v.moqDollar && poI.length > 0 ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>Fill MOQ{moqGap > 0 && poI.length > 0 ? ` (+${$(moqGap)})` : ""}</button>
            <button onClick={() => clrV(grp.cores, grp.bundles)} className="text-xs bg-gray-700 text-gray-300 px-2.5 py-1 rounded">Clear</button>
            <button onClick={() => setDismissed({})} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">Show All</button>
            <div className="ml-auto flex gap-2">
              <button disabled={!poI.length} onClick={() => { genRFQ(v, poI, stg.buyer, poD, vendorPO); setToast("RFQ " + vendorPO) }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>RFQ</button>
              <button disabled={!poI.length} onClick={() => { genPO(v, poI, vendorPO, stg.buyer, poD); setToast("PO " + vendorPO) }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-emerald-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>PO</button>
              <button disabled={!poI.length} onClick={() => { cp7f(v, poI, vendorPO, stg.buyer, poD); setToast("7f copied!") }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>7f</button>
              <button disabled={!poI.length} onClick={() => { cp7g(v, poI, vendorPO, stg.buyer); setToast("7g copied!") }} className={`text-xs px-3 py-1.5 rounded font-medium ${poI.length ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>7g</button>
              {v.contactEmail && <button onClick={() => { const subj = encodeURIComponent('PO ' + vendorPO + ' — JLS Trading Co.'); const firstName = (v.contactName || '').split(' ')[0] || 'there'; const body = encodeURIComponent('Hi ' + firstName + ',\nHow are you?\nHope you are doing well!\n\nI\'ve attached ' + vendorPO + '\nCould you please give me a quote?\n\nThanks a lot,\n' + (stg.buyer || '')); window.open('mailto:' + v.contactEmail + '?subject=' + subj + '&body=' + body) }} className="text-xs px-3 py-1.5 rounded font-medium bg-blue-600 text-white">📧</button>}
            </div>
          </div>
        </div>
        <div className="overflow-auto max-h-[70vh] max-w-[calc(100vw-2rem)]"><table className="w-full text-xs"><thead><VTH isCol={anyCol} /></thead><tbody>
          {vendorSub === "bundles" ? <>{grp.bundles.map(b => <BundleRow key={b.j} b={b} />)}{grp.bundles.length === 0 && <tr><td colSpan={40} className="py-4 text-center text-gray-500">No bundles</td></tr>}</>
            : vendorSub === "mix" ? <>{grp.cores.map(c => {
              const cBs = (data.bundles || []).filter(b => {
                let uses = false;
                for (let i = 1; i <= 20; i++) if (b['core' + i] === c.id) { uses = true; break; }
                if (!uses) return false;
                if (bA === "yes" && b.active !== "Yes") return false;
                if (bA === "no" && b.active === "Yes") return false;
                if (bI === "blank" && !!b.ignoreUntil) return false;
                if (bI === "set" && !b.ignoreUntil) return false;
                return true;
              }).map(b => ({ ...b, fee: feMap[b.j] })).sort((a, b) => (a.fibDoc || 0) - (b.fibDoc || 0));
              const orderedBs = nf === "need" ? cBs.filter(b => hasBundleOrd(b)) : cBs;
              if (nf === "need" && !hasCoreOrd(c) && orderedBs.length === 0) return null;
              return <Fragment key={c.id}><CoreRow c={c} />{!dismissed[c.id] && orderedBs.map(b => <BundleRow key={b.j} b={b} />)}</Fragment>;
            })}</>
              : <>{grp.cores.map(c => <CoreRow key={c.id} c={c} />)}</>}
        </tbody></table></div>
      </div>;
    })}

    {vm === "vendor" && vG.length === 0 && <div className="text-center text-gray-500 py-12">No vendors match current filters.</div>}
  </div>;
}
