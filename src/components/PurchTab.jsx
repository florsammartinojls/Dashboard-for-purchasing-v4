import React, { useState, useMemo, useCallback, useEffect, useContext, Fragment } from "react";
import { R, D1, $, $2, $4, P, gS, cAI, cNQ, cOQ, cDA, bNQ, isD, gTD, dc, cSeas, fSl, fMY, fE, fDateUS, effectiveDSR, roundToCasePack, genPO, genRFQ, cp7f, cp7g } from "../lib/utils";
import { Dot, Toast, TH, SS, WorkflowChip, NumInput, SumCtx, VendorNotes, CalcBreakdown } from "./Shared";
import { batchProfiles, batchBundleProfiles, calcCoverageNeed, calcPurchaseFrequency, fillToMOQ as fillToMOQCalc, getCalcBreakdown, DEFAULT_PROFILE } from "../lib/seasonal";

function SC({ v, children, className }) {
  const { addCell } = useContext(SumCtx);
  const [sel, setSel] = useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

const AGL_LT = 80;


export default function PurchTab({ data, stg, goCore, goBundle, goVendor, ov, setOv, initV, clearIV, saveWorkflow, deleteWorkflow, saveVendorComment, activeBundleCores }) {
  const [vm, setVm] = useState(initV ? "vendor" : "core");
  const [sort, setSort] = useState("status");
  const [vf, setVf] = useState(initV || "");
  const [sf, setSf] = useState("");
  const [nf, setNf] = useState("all");
  const [minD, setMinD] = useState(0);
  const [locF, setLocF] = useState("all");
  const [toast, setToast] = useState(null);
  const [toastPersist, setToastPersist] = useState(false);
  const [poN, setPoN] = useState("");
  const [poD, setPoD] = useState("");
  const [vendorSub, setVendorSub] = useState("cores");
  const [showRS, setShowRS] = useState(false);
  const [showCosts, setShowCosts] = useState(false);
  const [showPH, setShowPH] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [showIgnored, setShowIgnored] = useState(false);
  const [showNoBundleCores, setShowNoBundleCores] = useState(false);
  const [breakdown, setBreakdown] = useState(null);
  const [aglMap, setAglMap] = useState({}); // vendor → true/false

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
  const rsBundleMap = useMemo(() => { const m = {}; (data.restock || []).forEach(r => { const bk = (r.bundle || "").trim(); if (bk) m[bk] = r }); return m }, [data.restock]);
  const replenMap = useMemo(() => { const m = {}; (data.replenRec || []).forEach(r => { m[r.j] = r }); return m }, [data.replenRec]);
  const missingMap = useMemo(() => { const m = {}; (data.receiving || []).forEach(r => { if (r.piecesMissing > 0) { const k = (r.core || "").trim(); m[k] = (m[k] || 0) + r.piecesMissing } }); return m }, [data.receiving]);
  const casePackFromRec = useMemo(() => { const m = {}; (data.receiving || []).forEach(r => { const k = (r.core || "").trim(); if (k && r.pcs > 0 && r.cases > 0 && !m[k]) m[k] = Math.round(r.pcs / r.cases) }); return m }, [data.receiving]);

  // === SEASONAL PROFILES ===
  const profiles = useMemo(() => batchProfiles(data.cores || [], data._coreInv || [], data._coreDays || []), [data.cores, data._coreInv, data._coreDays]);
  const bundleProfiles = useMemo(() => batchBundleProfiles(data.bundles || [], data._bundleSales || []), [data.bundles, data._bundleSales]);

  // === PURCHASE FREQUENCY per vendor ===
  const purchFreqMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => { m[v.name] = calcPurchaseFrequency(v.name, data.receivingFull || []) });
    return m;
  }, [data.vendors, data.receivingFull]);

  // === ENRICHED CORES ===
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
      const profile = profiles[c.id] || DEFAULT_PROFILE;
      const pf = purchFreqMap[c.ven];
      const coverage = calcCoverageNeed(c, lt, tg, profile, pf);
      const sNeed = coverage.need;
      const oq = cOQ(sNeed, c.moq, c.casePack);
      const seas = cSeas(c.id, (data._coreInv || []));
      const invAnomaly = ai > 0 && c.dsr > 0 && Math.abs(effectiveDoc - ai / c.dsr) > effectiveDoc * 0.2;
return { ...c, status: st, allIn: ai, doc: effectiveDoc, needQty: sNeed, orderQty: oq, needDollar: +(oq * c.cost).toFixed(2), docAfter: cDA(c, oq), lt, critDays: cd, warnDays: wd, targetDoc: tg, vc: v.country || "", seas, isDom: isD(v.country), spike: c.d7 > 0 && c.dsr > 0 && c.d7 >= c.dsr * 1.25, sProfile: profile, sCoverage: coverage, invAnomaly };
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
    }), [data, stg, vf, sf, sort, vMap, nf, minD, locF, profiles, purchFreqMap, showNoBundleCores, activeBundleCores]);

  const venBundles = useMemo(() => (data.bundles || []).filter(b => {
    if (bA === "yes" && b.active !== "Yes") return false;
    if (bA === "no" && b.active === "Yes") return false;
    if (bI === "blank" && !!b.ignoreUntil) return false;
    if (bI === "set" && !b.ignoreUntil) return false;
    if (vf && (b.vendors || "").indexOf(vf) < 0) return false;
    return true;
  }).map(b => ({ ...b, fee: feMap[b.j] })), [data.bundles, vf, feMap, bA, bI]);

  const sc = useMemo(() => { const c = { critical: 0, warning: 0, healthy: 0 }; enr.forEach(x => c[x.status]++); return c }, [enr]);

  // Raw waterfall
  const rawAllocMap = useMemo(() => {
    const map = {};
    const activeBundles = (data.bundles || []).filter(b => { if (bA === "yes" && b.active !== "Yes") return false; if (bA === "no" && b.active === "Yes") return false; return true });
    const coreGroups = {};
    activeBundles.forEach(b => { if (!b.core1) return; if (!coreGroups[b.core1]) coreGroups[b.core1] = []; coreGroups[b.core1].push(b) });
    enr.forEach(c => {
      const bundles = coreGroups[c.id] || []; if (bundles.length === 0) return;
      let pool = c.raw || 0;
      const bData = bundles.map(b => {
        const rp = replenMap[b.j]; const pprc = rp?.pprcUnits || 0; const inb7f = missingMap[b.j] || 0;
        const inv = (b.fibInv || 0) + inb7f + pprc; const dsr = b.cd || 0;
        return { j: b.j, baseDOC: dsr > 0 ? inv / dsr : 9999, dsr, qtyPerBundle: b.qty1 || 1, inv };
      }).sort((a, b) => a.baseDOC - b.baseDOC);
      const tg = c.targetDoc || 180;
      bData.forEach(bd => {
        if (bd.dsr <= 0 || pool <= 0) { map[bd.j] = { rawUnits: 0, baseDOC: bd.baseDOC, baseInv: bd.inv }; return }
        const needCP = Math.max(0, tg - bd.baseDOC) * bd.dsr * bd.qtyPerBundle;
        const give = Math.min(needCP, pool); pool -= give;
        map[bd.j] = { rawUnits: bd.qtyPerBundle > 0 ? give / bd.qtyPerBundle : 0, baseDOC: bd.baseDOC, baseInv: bd.inv };
      });
    });
    return map;
  }, [enr, data.bundles, replenMap, missingMap, bA]);

  const gO = id => ov[id] || {};
  const setF = (id, f, v) => setOv(p => ({ ...p, [id]: { ...(p[id] || {}), [f]: v } }));
  const gPcs = id => (gO(id).pcs ?? 0);
  const gCas = id => (gO(id).cas ?? 0);
  const gInbS = id => (gO(id).inbS ?? 0);
  const gCogP = id => (gO(id).cogP ?? 0);
  const gCogC = id => (gO(id).cogC ?? 0);
  const gBMoq = id => (gO(id).bMoq ?? 0);
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
    cores.filter(c => hasCoreOrd(c)).forEach(c => items.push({ id: c.id, ti: c.ti, vsku: c.vsku, qty: coreEffQ(c), cost: c.cost, cp: c.casePack || 1, inbS: gInbS(c.id), isCoreItem: true }));
    (bundles || []).filter(b => hasBundleOrd(b)).forEach(b => { const f = feMap[b.j]; items.push({ id: b.j, ti: b.t, vsku: b.asin || b.bundleCode, qty: bundleEffQ(b), cost: f?.aicogs || b.aicogs || 0, cp: 1, inbS: gInbS(b.j), isCoreItem: false }) });
    return items;
  };

  const autoPO = (vendorCode) => { if (poN) return poN; const d = new Date(); const serial = Math.floor((d - new Date(1899, 11, 30)) / 86400000); return 'PO-' + serial + '-' + (vendorCode || 'XXX') };

  // === FILL REC (v2 — core need as reference, distribute to bundles by weight, respect PPRC) ===
  const fillR = (cores, bundles, mode, vendorName) => {
    const u = { ...ov };
    const bMoq = gBMoq('_bmoq_' + vendorName);
    const isAgl = aglMap[vendorName] || false;
    const warnings = [];

    if (mode === "bundles" || mode === "mix") {
      const coreMap = {}; cores.forEach(c => { coreMap[c.id] = c });

      // Group bundles by core
      const bundlesByCore = {};
      (bundles || []).forEach(b => {
        // Associate bundle with ALL its cores, not just core1
        [b.core1, b.core2, b.core3].filter(Boolean).forEach(cid => {
          if (!coreMap[cid]) return;
          if (!bundlesByCore[cid]) bundlesByCore[cid] = [];
          if (!bundlesByCore[cid].some(x => x.j === b.j)) bundlesByCore[cid].push(b);
        });
      });

      cores.forEach(c => {
        const cBundles = bundlesByCore[c.id] || [];
        if (cBundles.length === 0) {
          // No bundles → order as core if needed
          if (c.needQty > 0) u[c.id] = { ...(u[c.id] || {}), pcs: cOQ(c.needQty, c.moq, c.casePack) };
          return;
        }

        // 1. Core need = total NEW pieces to order (already net of all inventory)
        const coreNeed = c.needQty || 0;

        // 2. Split by %28d weight IN BUNDLE UNITS, then shift using PPRC
        const totL28 = cBundles.reduce((s, b) => { const sa = saMap[b.j]; return s + (sa?.l28U || 0) }, 0);
        const bData = cBundles.map(b => {
          const sa = saMap[b.j];
          const l28 = sa?.l28U || 0;
          const weight = totL28 > 0 ? l28 / totL28 : 1 / cBundles.length;
          const rp = replenMap[b.j];
          const qpb = b.qty1 || 1;
          const normalShareBU = Math.ceil((coreNeed * weight) / qpb);
          const pprcCommitted = (rp?.pprcUnits || 0) + (rp?.batched || 0);
          const pprcWillCover = Math.min(pprcCommitted, normalShareBU);
          let gap = Math.max(0, normalShareBU - pprcWillCover);
          // CAP: don't let any bundle exceed targetDOC after order
          const bundleDSR = b.cd || 0;
          const bundleCurrentInv = (b.fibInv || 0) + (rp?.pprcUnits || 0) + (rp?.batched || 0);
          const maxOrderBU = bundleDSR > 0 ? Math.max(0, Math.ceil(c.targetDoc * bundleDSR) - bundleCurrentInv) : 0;
          const capped = gap > maxOrderBU && maxOrderBU >= 0;
          const excess = capped ? (gap - maxOrderBU) * qpb : 0; // excess in core pcs
          if (capped) gap = maxOrderBU;
          return { j: b.j, weight: r2w(weight), propDemand: normalShareBU, covered: pprcWillCover, gap, qpb, core1: b.core1, excess, bundleDSR, capped };
        });

        // Redistribute excess from capped bundles to uncapped ones (by weight)
        const totalExcessCorePcs = bData.reduce((s, bd) => s + bd.excess, 0);
        if (totalExcessCorePcs > 0) {
          const uncapped = bData.filter(bd => !bd.capped && bd.bundleDSR > 0);
          const uncappedWeight = uncapped.reduce((s, bd) => s + bd.weight, 0);
          uncapped.forEach(bd => {
            const extraBU = uncappedWeight > 0 ? Math.ceil((totalExcessCorePcs * (bd.weight / uncappedWeight)) / bd.qpb) : 0;
            // Re-check cap after redistribution
            const rp = replenMap[bd.j];
            const bundleCurrentInv = ((data.bundles || []).find(b => b.j === bd.j)?.fibInv || 0) + (rp?.pprcUnits || 0) + (rp?.batched || 0);
            const maxAfterRedist = bd.bundleDSR > 0 ? Math.max(0, Math.ceil(c.targetDoc * bd.bundleDSR) - bundleCurrentInv) : 0;
            bd.gap = Math.min(bd.gap + extraBU, maxAfterRedist);
          });
        }

        // 3. Calculate bundle orders from gaps (already in bundle units)
        let totalBundleOrderCorePcs = 0;
        const coreExtrasFromBundles = { pieces: 0 };

        bData.forEach(bd => {
          if (bd.gap <= 0) return;
          const effectiveMoq = bMoq > 0 ? bMoq : 0;

          if (mode === "mix" && effectiveMoq > 0 && bd.gap < effectiveMoq) {
            // Below B.MOQ → convert back to core pieces
            coreExtrasFromBundles.pieces += bd.gap * bd.qpb;
          } else {
            let ord = effectiveMoq > 0 ? Math.max(bd.gap, effectiveMoq) : bd.gap;
            const bcp = casePackFromRec[bd.j] || 0;
            if (bcp > 0) ord = Math.ceil(ord / bcp) * bcp;
            u[bd.j] = { ...(u[bd.j] || {}), pcs: ord };
            totalBundleOrderCorePcs += ord * bd.qpb; // convert back to core pcs for overallocation check
          }
        });
    // 4. Core raw: smart check — do bundles actually cover the demand?
        let coreRawNeed = 0;
        if (coreExtrasFromBundles.pieces > 0) {
          // B.MOQ converted extras → order as core
          coreRawNeed = coreExtrasFromBundles.pieces;
        } else if (cBundles.length === 0 && coreNeed > 0) {
          // No bundles at all → order as core
          coreRawNeed = coreNeed;
        } else if (coreNeed > 0 && totalBundleOrderCorePcs === 0 && cBundles.length > 0) {
          // Bundles exist but none needed ordering — check if they actually have inventory
          const bundleTotalInv = cBundles.reduce((s, b) => {
            const rp = replenMap[b.j];
            return s + (b.fibInv || 0) + (rp?.pprcUnits || 0) + (rp?.batched || 0);
          }, 0);
          const bundleTotalDsr = cBundles.reduce((s, b) => s + (b.cd || 0), 0);
          const bundleCoverDays = bundleTotalDsr > 0 ? bundleTotalInv / bundleTotalDsr : 9999;
          // If bundles have less than half the target DOC → they're NOT covering demand → order core
          if (bundleCoverDays < c.targetDoc * 0.5) {
            coreRawNeed = coreNeed;
          }
          // Otherwise bundles are well stocked (high PPRC/FIB) → no core order needed
        }
       

        // 5. Check overallocation: if total orders > core need + 15 DOC → warn
        // 5a. Place core order if needed
        if (coreRawNeed > 0) {
          u[c.id] = { ...(u[c.id] || {}), pcs: cOQ(coreRawNeed, c.moq, c.casePack) };
        }        
        const totalOrderCorePcs = totalBundleOrderCorePcs + (coreRawNeed > 0 ? cOQ(coreRawNeed, c.moq, c.casePack) : 0);
        const overDOC = c.dsr > 0 ? Math.round((totalOrderCorePcs - coreNeed) / c.dsr) : 0;
        if (overDOC > 15 && coreNeed > 0) {
          warnings.push(`${c.id}: +${overDOC} DOC over need (PPRC imbalance) — review unbundle`);
        }
      });
} else {
        // Cores mode — seasonal needQty already computed
        cores.filter(c => c.needQty > 0).forEach(c => { u[c.id] = { ...(u[c.id] || {}), pcs: cOQ(c.needQty, c.moq, c.casePack) } });
      }

    setOv(u);
    if (warnings.length > 0) { setToast("⚠ " + warnings.join(" | ")); setToastPersist(true); }
  };

  const r2w = n => Math.round(n * 100) / 100;

  // === FILL TO MOQ ===
  const doFillMOQ = (grpCores, grpBundles, vendorMOQDollar) => {
    let currentTotal = 0;
    grpCores.forEach(c => { currentTotal += coreEffQ(c) * c.cost });
    if (vendorSub !== "cores") (grpBundles || []).filter(b => hasBundleOrd(b)).forEach(b => { const f = feMap[b.j]; currentTotal += bundleEffQ(b) * (f?.aicogs || 0) });
    if (currentTotal >= vendorMOQDollar) { setToast("Already at/above MOQ"); return }
    const lt = grpCores[0]?.lt || 30; const tg = grpCores[0]?.targetDoc || 90;
    const extra = fillToMOQCalc(grpCores, vendorMOQDollar, currentTotal, profiles, lt, tg);
    if (Object.keys(extra).length === 0) { setToast("Could not reach MOQ"); return }
    const u = { ...ov }; let addedTotal = 0;
    Object.entries(extra).forEach(([id, extraPcs]) => { const existing = gPcs(id) || 0; u[id] = { ...(u[id] || {}), pcs: existing + extraPcs }; const c = grpCores.find(x => x.id === id); if (c) addedTotal += extraPcs * c.cost });
    setOv(u); setToast("MOQ filled: +" + $(addedTotal));
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
    const eq = coreEffQ(c); const cost = eq * c.cost;
    const activeBundlesForCore = (data.bundles || []).filter(b => b.core1 === c.id && b.active === "Yes");
    const bundleOrderPieces = activeBundlesForCore.reduce((s, b) => s + (bundleEffQ(b) * (b.qty1 || 1)), 0);
    let ad = null;
    if (eq > 0 && c.dsr > 0) {
      if (activeBundlesForCore.length === 1) { const sb = activeBundlesForCore[0]; const alloc = rawAllocMap[sb.j] || { rawUnits: 0, baseInv: 0 }; ad = sb.cd > 0 ? Math.round((alloc.baseInv + alloc.rawUnits + bundleEffQ(sb) + (eq / (sb.qty1 || 1))) / sb.cd) : null }
      else { ad = Math.round((c.allIn + eq + bundleOrderPieces) / c.dsr) }
    }
    const isCol = collapsed[c.id]; const combinedRec = showPH[c.id] ? getCombinedRec(c.id) : [];
    const hasSeasonal = c.sProfile?.hasHistory; const isUrgent = c.sCoverage?.urgent;

    return <><tr className={`border-t border-gray-800/30 hover:bg-gray-800/20 text-xs ${hasCoreOrd(c) ? "bg-emerald-900/10" : ""} ${isUrgent ? "bg-red-900/10" : ""}`}>
      <td className="py-1 px-0.5 sticky left-0 bg-gray-950 z-10 w-4"><Dot status={c.status} /></td>
      <td className="py-1 px-0.5 sticky left-4 bg-gray-950 z-10 whitespace-nowrap"><button onClick={() => goCore(c.id)} className="text-blue-400 font-mono hover:underline text-[11px]">{c.id}</button></td>
      <td className="py-1 px-1 text-gray-200 truncate max-w-[130px] sticky left-[85px] bg-gray-950 z-10">
        {c.ti}{isUrgent && <span className="ml-1 text-red-400 text-[9px] font-bold">⚠OOS</span>}{c.invAnomaly && <span className="ml-1 text-amber-400 text-[9px] font-bold" title="Unusual inventory changes — Sheet DOC vs calculated DOC mismatch &gt;20%">⚠INV</span>}</td>
      <SC v={c.dsr} className="py-1 px-1 text-right">{D1(c.dsr)}</SC>
      <SC v={c.d7} className="py-1 px-1 text-right">{D1(c.d7)}</SC>
      <td className="py-1 px-1 text-center">{c.d7 > c.dsr ? <span className={c.spike ? "text-orange-400 font-bold" : "text-emerald-400"}>▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}{c.spike && <span className="text-orange-400 text-xs ml-0.5">⚡</span>}</td>
      <SC v={c.doc} className={`py-1 px-1 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}{c.doc > 0 && c.dsr > 0 && Math.abs(c.doc - cAI(c) / c.dsr) > c.doc * 0.2 && <span className="ml-0.5 text-red-400 text-[9px]" title={"Sheet DOC vs All-In/DSR mismatch: " + R(c.doc) + " vs " + R(Math.round(cAI(c) / c.dsr))}>⚠</span>}</SC>
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
        <button onClick={() => openBreakdown(c)} className={`text-xs px-0.5 rounded ${hasSeasonal ? "text-purple-400" : "text-gray-600"}`} title="Seasonal Breakdown">📊</button>
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
    const f = b.fee || feMap[b.j]; const eq = bundleEffQ(b); const cost = f ? (eq * (f.aicogs || 0)) : 0;
    const aged = agedMap[b.j]; const kill = killMap[b.j]; const inb7f = missingMap[b.j] || 0; const rp = replenMap[b.j];
    const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0;
    const bCasePack = casePackFromRec[b.j] || 0;
    const alloc = rawAllocMap[b.j] || { rawUnits: 0, baseDOC: 0, baseInv: 0 };
    const effectiveDOC = b.cd > 0 ? Math.round((alloc.baseInv + alloc.rawUnits + eq) / b.cd) : null;
    return <tr className={`border-t border-gray-800/20 hover:bg-indigo-900/10 text-xs ${hasBundleOrd(b) ? "bg-emerald-900/10" : "bg-indigo-950/30"}`}>
     <td className="py-1 px-0.5 sticky left-0 bg-indigo-950/30 z-10 w-4 border-l-2 border-indigo-500/40" />
     <td className="py-1 px-0.5 sticky left-4 bg-indigo-950/30 z-10 whitespace-nowrap"><button onClick={() => goBundle(b.j)} className="text-indigo-400 font-mono hover:underline text-[11px]">{b.j}</button></td>
     <td className="py-1 px-1 text-indigo-200 truncate max-w-[130px] sticky left-[85px] bg-indigo-950/30 z-10">
        {b.t}{b.asin && <a href={`https://sellercentral.amazon.com/myinventory/inventory?fulfilledBy=all&page=1&pageSize=25&searchField=all&searchTerm=${b.asin}&sort=date_created_desc&status=all`} target="_blank" rel="noopener noreferrer" className="ml-1 text-gray-500 hover:text-blue-400 text-[9px] font-mono">{b.asin}</a>}
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
      {vm === "vendor" && <div className="flex bg-gray-800 rounded-lg p-0.5">{[["cores", "Cores"], ["bundles", "Bundles"], ["mix", "Mix"]].map(([k, l]) => <button key={k} onClick={() => setVendorSub(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${vendorSub === k ? "bg-indigo-600 text-white" : "text-gray-400"}`}>{l}</button>)}</div>}
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

    {vm === "core" && <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead><tr className="bg-gray-900/80 text-xs text-gray-400 uppercase sticky top-0 z-20"><th className="py-3 px-2 w-8" /><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left">Vendor</th><th className="py-3 px-2 text-left">Title</th><TH tip="DSR" className="py-3 px-2 text-right">DSR</TH><TH tip="7D" className="py-3 px-2 text-right">7D</TH><th className="py-3 px-2 text-center">T</th><TH tip="DOC" className="py-3 px-2 text-right">DOC</TH><TH tip="All-In" className="py-3 px-2 text-right">All-In</TH><th className="py-3 px-2 text-right">MOQ</th><th className="py-3 px-2 text-center">S</th><th className="py-3 px-1 border-l-2 border-gray-600" /><TH tip="Seasonal Need" className="py-3 px-2 text-right">Need</TH><th className="py-3 px-2 text-right">Order</th><th className="py-3 px-2 text-right">Cost</th><TH tip="After DOC" className="py-3 px-2 text-right">After</TH><th className="py-3 px-2 w-14" /></tr></thead>
      <tbody>{enr.map(c => <tr key={c.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 text-sm ${c.sCoverage?.urgent ? "bg-red-900/10" : ""}`}><td className="py-2 px-2"><Dot status={c.status} /></td><td className="py-2 px-2"><button onClick={() => goCore(c.id)} className="text-blue-400 font-mono text-xs hover:underline">{c.id}</button></td><td className="py-2 px-2 text-blue-300 text-xs truncate max-w-[100px] cursor-pointer hover:underline" onClick={() => goVendor(c.ven)}>{c.ven}</td><td className="py-2 px-2 text-gray-200 truncate max-w-[180px]">{c.ti}{c.sCoverage?.urgent && <span className="ml-1 text-red-400 text-xs font-bold">⚠OOS</span>}{c.invAnomaly && <span className="ml-1 text-amber-400 text-xs font-bold" title="Unusual inventory changes detected">⚠INV</span>}</td><td className="py-2 px-2 text-right">{D1(c.dsr)}</td><td className="py-2 px-2 text-right">{D1(c.d7)}</td><td className="py-2 px-2 text-center">{c.d7 > c.dsr ? <span className="text-emerald-400">▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}</td><td className={`py-2 px-2 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</td><td className="py-2 px-2 text-right">{R(c.allIn)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{c.moq > 0 ? R(c.moq) : "—"}</td><td className="py-2 px-2 text-center">{c.seas && <span className="text-purple-400 text-xs font-bold">{c.seas.peak}</span>}</td><td className="py-2 px-1 border-l-2 border-gray-600" /><td className="py-2 px-2 text-right text-gray-300">{c.needQty > 0 ? R(c.needQty) : "—"}</td><td className="py-2 px-2 text-right text-white font-semibold">{c.orderQty > 0 ? R(c.orderQty) : "—"}</td><td className="py-2 px-2 text-right text-amber-300">{c.needDollar > 0 ? $(c.needDollar) : "—"}</td><td className={`py-2 px-2 text-right ${c.orderQty > 0 ? dc(c.docAfter, c.critDays, c.warnDays) : "text-gray-500"}`}>{c.orderQty > 0 ? R(c.docAfter) : "—"}</td><td className="py-2 px-2 flex gap-1"><button onClick={() => openBreakdown(c)} className={`text-xs px-1 rounded ${c.sProfile?.hasHistory ? "text-purple-400" : "text-gray-600"}`}>📊</button><button onClick={() => goCore(c.id)} className="text-blue-400 text-xs px-1.5 py-0.5 bg-blue-400/10 rounded">V</button></td></tr>)}</tbody>
      <tfoot><tr className="bg-gray-900 border-t-2 border-gray-700 text-sm font-semibold"><td colSpan={4} className="py-3 px-2 text-gray-300">{enr.length}</td><td className="py-3 px-2 text-right text-white">{D1(tot.d)}</td><td colSpan={3} /><td className="py-3 px-2 text-right text-white">{R(tot.a)}</td><td colSpan={2} /><td className="border-l-2 border-gray-600" /><td className="py-3 px-2 text-right">{R(tot.n)}</td><td className="py-3 px-2 text-right text-white">{R(tot.o)}</td><td className="py-3 px-2 text-right text-amber-300">{$(tot.co)}</td><td colSpan={2} /></tr></tfoot>
    </table></div>}

    {vm === "vendor" && vG.map(grp => {
      const v = grp.v; const tg = gTD(v, stg);
      const poI = getPOI(grp.cores, vendorSub !== "cores" ? grp.bundles : []);
      const poT = poI.reduce((s, i) => s + i.qty * i.cost, 0);
      const poC = poI.reduce((s, i) => s + (v.vou === 'Cases' && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : 0), 0);
      const effectiveMoqD = v.moqDollar || (gO('_dmoq_' + v.name).dMoq ?? 0);
      const meets = effectiveMoqD > 0 ? poT >= effectiveMoqD : true;
      const anyCol = Object.values(collapsed).some(Boolean);
      const vendorPO = autoPO(v.code);
      const moqGap = (v.moqDollar || 0) - poT;
      const pf = purchFreqMap[v.name];
      const isAgl = aglMap[v.name] || false;

      return <div key={v.name} className="mb-5 border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-white font-semibold cursor-pointer hover:text-blue-400 hover:underline" onClick={() => window.open(window.location.pathname + '?vendor=' + encodeURIComponent(v.name), '_blank')}>{v.name}</span>
            <div className="relative"><WorkflowChip id={v.name} type="vendor" workflow={data.workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer} country={v.country} /></div>
            <div className="relative"><VendorNotes vendor={v.name} comments={data.vendorComments} onSave={saveVendorComment} buyer={stg.buyer} /></div>
            {v.country && <span className="text-xs text-gray-500">{v.country}</span>}
            <span className="text-xs text-gray-400">LT:{v.lt}d</span>
            <span className="text-xs text-gray-400">Buf:{grp.cores[0]?.buf || 14}d</span>
           <span className="text-xs text-gray-400">MOQ:{$(effectiveMoqD || v.moqDollar)}</span>
            <span className="text-xs text-gray-400">Tgt:{tg}d</span>
            <span className="text-xs text-gray-400">{v.payment}</span>
            {pf && pf.comment && <span className="text-xs text-amber-400">{pf.comment}</span>}
            {pf && <span className="text-xs text-gray-500">{pf.ordersPerYear}/yr · ×{pf.safetyMultiplier}</span>}
            {(() => {
              const alerts = [];
              grp.cores.forEach(c => {
                const eq = coreEffQ(c);
                if (eq <= 0) return;
                const coreRecs = (data.receivingFull || []).filter(r => (r.core || "").trim().toLowerCase() === c.id.toLowerCase() && r.pcs > 0 && r.vendor === v.name);
                if (coreRecs.length >= 2) {
                  const minCore = Math.min(...coreRecs.map(r => r.pcs));
                  if (eq < minCore) alerts.push({ id: c.id, qty: eq, min: minCore, type: "core" });
                }
              });
              if (alerts.length === 0) return null;
              return <div className="w-full mt-1">{alerts.map(a => <div key={a.id} className="text-xs text-amber-400">⚠ {a.id}: ordering {R(a.qty)} but lowest {a.type} purchase was {R(a.min)}</div>)}</div>;
            })()}
<span className="flex items-center gap-1 text-xs text-gray-400">C.MOQ:<NumInput value={gO('_cmoq_' + v.name).cMoq ?? 0} onChange={val => setF('_cmoq_' + v.name, 'cMoq', val)} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center text-xs" /></span>
            <span className="flex items-center gap-1 text-xs text-gray-400">$MOQ:<NumInput value={gO('_dmoq_' + v.name).dMoq ?? 0} onChange={val => setF('_dmoq_' + v.name, 'dMoq', val)} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-16 text-center text-xs" /></span>
            {(vendorSub === "bundles" || vendorSub === "mix") && <>
              <span className="flex items-center gap-1 text-xs text-gray-400">B.MOQ:<NumInput value={gBMoq('_bmoq_' + v.name)} onChange={val => setF('_bmoq_' + v.name, 'bMoq', val)} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center text-xs" /></span>
              <button onClick={() => setAglMap(p => ({ ...p, [v.name]: !p[v.name] }))} className={`text-xs px-2 py-0.5 rounded font-medium ${isAgl ? "bg-cyan-600 text-white" : "bg-gray-700 text-gray-400"}`} title="AGL: use 80d lead time for bundles">AGL{isAgl ? " ✓" : ""}</button>
            </>}
            {poI.length === 0 ? <span className="ml-auto text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">—</span> : <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${meets ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>{meets ? "✓" : "!"} {$(poT)}{poC > 0 ? " / " + poC + "cs" : ""}</span>}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => fillR(grp.cores, grp.bundles, vendorSub, v.name)} className={`text-xs px-2.5 py-1 rounded ${data._coreInv?.length ? "bg-blue-600/80 text-white" : "bg-yellow-600 text-white animate-pulse"}`}>{data._coreInv?.length ? "Fill Rec" : "Fill Rec ⏳"}</button>
            <button onClick={() => doFillMOQ(grp.cores, grp.bundles, v.moqDollar || (gO('_dmoq_' + v.name).dMoq ?? 0))} disabled={!v.moqDollar || poT >= v.moqDollar || poI.length === 0} className={`text-xs px-2.5 py-1 rounded font-medium ${v.moqDollar && poT < v.moqDollar && poI.length > 0 ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}>Fill MOQ{moqGap > 0 && poI.length > 0 ? ` (+${$(moqGap)})` : ""}</button>
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
            const cBs = (data.bundles || []).filter(b => { if (b.core1 !== c.id && b.core2 !== c.id && b.core3 !== c.id) return false; if (bA === "yes" && b.active !== "Yes") return false; if (bA === "no" && b.active === "Yes") return false; if (bI === "blank" && !!b.ignoreUntil) return false; if (bI === "set" && !b.ignoreUntil) return false; return true }).map(b => ({ ...b, fee: feMap[b.j] })).sort((a, b) => (a.fibDoc || 0) - (b.fibDoc || 0));
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
