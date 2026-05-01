import React, { useState, useMemo, useCallback, useEffect, useContext, useRef, Fragment } from "react";
import { R, D1, $, $2, $4, P, gS, cAI, cNQ, cOQ, cDA, bNQ, isD, gTD, dc, cSeas, fSl, fMY, fE, fDateUS, effectiveDSR, roundToCasePack, genPO, genRFQ, cp7f, cp7g } from "../lib/utils";
import { Dot, Toast, TH, SS, WorkflowChip, NumInput, SumCtx, VendorNotes, CalcBreakdownV2 } from "./Shared";
import { batchProfiles, batchBundleProfiles, calcCoverageNeed, calcPurchaseFrequency, DEFAULT_PROFILE } from "../lib/seasonal";
import { batchVendorRecommendationsV4, calcVendorRecommendationV4 } from "../lib/recommenderV4";
import { saveSnapshotIfNeeded, loadPreviousSnapshot, computeDelta } from "../lib/snapshot";
import { SegmentCtx } from "../App";
import { SegmentBadge } from "./SegmentsTab";

// === FLAG DEFINITIONS — compact icons, text in tooltip ===
const FLAG_DEFS = {
  OOS: {
    label: "Stockout risk",
    short: "OOS",
    icon: "⚠",
    cls: "text-red-300 bg-red-500/25 border border-red-500/50",
    tip: "Stockout risk — a bundle using this core will run out BEFORE the next PO arrives. Needs to be in the next order.",
  },
  INV: {
    label: "Inv mismatch",
    short: "INV",
    icon: "≠",
    cls: "text-amber-300 bg-amber-500/25 border border-amber-500/50",
    tip: "Inv mismatch — sheet DOC and recalculated DOC (allIn ÷ DSR) differ by >20%. Recheck stock manually before ordering.",
  },
  MOQ: {
    label: "MOQ inflated",
    short: "MOQ",
    icon: "$",
    cls: "text-orange-300 bg-orange-500/25 border border-orange-500/50",
    tip: "MOQ inflated — the MOQ or casepack forces an order significantly larger than the real need. Check 📊 for excess details.",
  },
  // [v3.4] NEW regime badges
  INTERMITTENT: {
    label: "Intermittent demand",
    short: "INTERMIT",
    icon: "~",
    cls: "text-sky-300 bg-sky-500/25 border border-sky-500/50",
    tip: "Intermittent demand — sells sporadically (most days zero). Forecast uses real rate over the window, not the peak sale value.",
  },
  NEW: {
    label: "New / sparse history",
    short: "NEW",
    icon: "N",
    cls: "text-violet-300 bg-violet-500/25 border border-violet-500/50",
    tip: "New or sparse history — less than 30 days of data. Recommendation uses sheet DSR with a conservative cap. Review manually.",
  },
};

function Flag({ type, extraTip }) {
  const def = FLAG_DEFS[type];
  if (!def) return null;
  const title = extraTip ? `${def.tip}\n\n${extraTip}` : def.tip;
  return (
    <span
      className={`inline-flex items-center justify-center text-[11px] font-bold flex-shrink-0 w-5 h-5 rounded-full cursor-help ${def.cls}`}
      title={title}
    >
      {def.icon}
    </span>
  );
}

function FlagLegendItem({ type }) {
  const def = FLAG_DEFS[type];
  if (!def) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${def.cls}`} title={def.tip}>
      <span>{def.icon}</span>
      <span>{def.label}</span>
    </span>
  );
}


function SC({ v, children, className }) {
  const { addCell } = useContext(SumCtx);
  const [sel, setSel] = useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

// === DELTA MODAL ===
function DeltaModal({ vendorName, delta, onClose }) {
  if (!delta) return null;
  const dir = delta.pctChange > 0 ? '+' : '';
  const color = delta.pctChange > 0 ? 'text-red-400' : 'text-emerald-400';
  const fmtN = n => Math.round(n).toLocaleString('en-US');
  const fmt$ = n => '$' + Math.round(n).toLocaleString('en-US');

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center overflow-auto p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <div>
            <h2 className="text-lg font-bold text-white">{vendorName} — What changed?</h2>
            <p className="text-gray-400 text-xs">Comparing today's recommendation vs snapshot from {delta.prevDate}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-gray-500 text-[10px] uppercase">Yesterday ({delta.prevDate})</div>
            <div className="text-white font-bold text-lg">{fmt$(delta.prevTotal)}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-gray-500 text-[10px] uppercase">Today</div>
            <div className="text-white font-bold text-lg">{fmt$(delta.todayTotal)}</div>
          </div>
          <div className={`rounded-lg p-3 ${delta.pctChange > 0 ? "bg-red-500/10 border border-red-500/30" : "bg-emerald-500/10 border border-emerald-500/30"}`}>
            <div className="text-gray-500 text-[10px] uppercase">Δ</div>
            <div className={`font-bold text-lg ${color}`}>{dir}{delta.pctChange.toFixed(1)}%</div>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-white mb-2">Top contributors to the change</h3>
        {delta.contributions && delta.contributions.length > 0 ? (
          <div className="space-y-1.5">
            {delta.contributions.map((c, i) => {
              const arrow = c.amount > 0 ? '↑' : '↓';
              const aColor = c.amount > 0 ? 'text-red-400' : 'text-emerald-400';
              const sourceColors = {
                level: 'text-blue-400', trend: 'text-emerald-400',
                inventory: 'text-amber-400', safety_stock: 'text-purple-400',
                new_bundle: 'text-cyan-400',
              };
              return (
                <div key={i} className="flex items-start gap-3 bg-gray-800/50 rounded px-3 py-2">
                  <span className={`text-lg ${aColor}`}>{arrow}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-blue-300 font-mono">{c.bundleId}</span>
                      <span className={`text-[10px] uppercase font-semibold ${sourceColors[c.source] || 'text-gray-400'}`}>{c.source.replace('_', ' ')}</span>
                      <span className={`ml-auto font-bold ${aColor}`}>{c.amount > 0 ? '+' : ''}{fmtN(c.amount)} units</span>
                    </div>
                    <div className="text-gray-400 text-[11px] mt-0.5">{c.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-xs">No significant per-bundle drivers found (change may be from MOQ rounding or price shifts).</p>
        )}

        <p className="text-[10px] text-gray-500 mt-4 italic">
          Snapshots are saved once per day per vendor (browser localStorage, last 14 days retained). They help explain why the recommendation moved without needing to open the console.
        </p>
      </div>
    </div>
  );
}

export default function PurchTab({ data, stg, vendorRecs, goCore, goBundle, goVendor, ov, setOv, initV, clearIV, saveWorkflow, deleteWorkflow, saveVendorComment, activeBundleCores }) {
  const segCtx = useContext(SegmentCtx);
if (!vendorRecs || !Object.keys(vendorRecs).length) vendorRecs = {};
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
  const [vendorSub, setVendorSub] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('sub');
    if (fromUrl && ["mix", "cores", "bundles"].includes(fromUrl)) return fromUrl;
    const vendorFromUrl = new URLSearchParams(window.location.search).get('vendor');
    if (vendorFromUrl) {
      try {
        const saved = localStorage.getItem('fba_vendor_sub_' + vendorFromUrl);
        if (saved && ["mix", "cores", "bundles"].includes(saved)) return saved;
      } catch {}
    }
    try {
      const saved = localStorage.getItem('fba_vendor_sub');
      if (saved && ["mix", "cores", "bundles"].includes(saved)) return saved;
    } catch {}
    return "mix";
  });
  const [autoDetectedVendors, setAutoDetectedVendors] = useState(() => new Set());
  useEffect(() => {
    try {
      if (vf) localStorage.setItem('fba_vendor_sub_' + vf, vendorSub);
      localStorage.setItem('fba_vendor_sub', vendorSub);
    } catch {}
  }, [vendorSub, vf]);
  useEffect(() => {
    if (!vf) return;
    try {
      const saved = localStorage.getItem('fba_vendor_sub_' + vf);
      if (saved && ["mix", "cores", "bundles"].includes(saved)) setVendorSub(saved);
    } catch {}
  }, [vf]);
  const [showRS, setShowRS] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showPH, setShowPH] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [showIgnored, setShowIgnored] = useState(false);
  const [showNoBundleCores, setShowNoBundleCores] = useState(false);
  const [breakdownCore, setBreakdownCore] = useState(null);
  const [moqOverrides, setMoqOverrides] = useState({});
  const [overrideRecs, setOverrideRecs] = useState({});

  const [vendorDeltas, setVendorDeltas] = useState({});
  const [showDeltaFor, setShowDeltaFor] = useState(null);
  
  const moqDebounceTimers = useRef({});

    useEffect(() => {
      return () => {
        Object.values(moqDebounceTimers.current).forEach(t => clearTimeout(t));
      };
    }, []);

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

  const profiles = useMemo(() => batchProfiles(data.cores || [], data._coreInv || [], data._coreDays || []), [data.cores, data._coreInv, data._coreDays]);

  const purchFreqMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => { m[v.name] = calcPurchaseFrequency(v.name, data.receivingFull || []) });
    return m;
  }, [data.vendors, data.receivingFull]);

  const effectiveRecs = useMemo(() => ({ ...vendorRecs, ...overrideRecs }), [vendorRecs, overrideRecs]);

  useEffect(() => {
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      window.__vendorRecs = effectiveRecs;
    }
  }, [effectiveRecs]);

  useEffect(() => {
    if (!effectiveRecs || !Object.keys(effectiveRecs).length) return;
    let cancelled = false;
    (async () => {
      const deltas = {};
      for (const [vendorName, rec] of Object.entries(effectiveRecs)) {
        if (!rec) continue;
        try {
          const prev = await loadPreviousSnapshot(vendorName);
          if (prev) {
            const delta = computeDelta(rec, prev);
            if (delta) deltas[vendorName] = delta;
          }
          await saveSnapshotIfNeeded(vendorName, rec);
        } catch (e) {
          if (import.meta.env.DEV) console.warn('Snapshot async failed for', vendorName, e);
        }
      }
      if (!cancelled) setVendorDeltas(deltas);
    })();
    return () => { cancelled = true; };
  }, [effectiveRecs]);

  useEffect(() => {
    if (!vf) return;
    if (autoDetectedVendors.has(vf)) return;
    const hadSaved = (() => {
      try { return !!localStorage.getItem('fba_vendor_sub_' + vf); } catch { return false; }
    })();
    if (hadSaved) {
      setAutoDetectedVendors(prev => { const n = new Set(prev); n.add(vf); return n; });
      return;
    }
    const rec = effectiveRecs[vf];
    if (!rec || !rec.bundleDetails) return;
    const activeBundles = rec.bundleDetails.filter(bd => bd.buyNeed > 0);
    if (activeBundles.length === 0) {
      setAutoDetectedVendors(prev => { const n = new Set(prev); n.add(vf); return n; });
      return;
    }
    const coreCount = activeBundles.filter(bd => bd.buyMode === 'core').length;
    const bundleCount = activeBundles.filter(bd => bd.buyMode === 'bundle').length;
    let detected = 'mix';
    if (bundleCount === 0 && coreCount > 0) detected = 'cores';
    else if (coreCount === 0 && bundleCount > 0) detected = 'bundles';
    if (detected !== vendorSub) setVendorSub(detected);
    setAutoDetectedVendors(prev => { const n = new Set(prev); n.add(vf); return n; });
  }, [vf, vendorRecs, autoDetectedVendors, vendorSub]);

  const getVendorPrice = useCallback((vendorName, itemId, fallback) => {
    const rec = effectiveRecs[vendorName];
    if (rec?.priceMap && rec.priceMap[itemId] > 0) {
      return rec.priceMap[itemId];
    }
    return fallback || 0;
  }, [effectiveRecs]);

  const bundleEffMap = useMemo(() => {
    const m = {};
    for (const vRec of Object.values(effectiveRecs)) {
      if (!vRec?.bundleDetails) continue;
      for (const bd of vRec.bundleDetails) {
        m[bd.bundleId] = bd;
      }
    }
    return m;
  }, [effectiveRecs]);

  const priceHistoryFull = useMemo(
    () => (data.priceCompFull?.length ? data.priceCompFull : data.priceComp) || [],
    [data.priceCompFull, data.priceComp]
  );

  const getCppBenchmark = useCallback((coreId, vendor) => {
    if (!coreId || !vendor?.name) return null;
    const isChinaCurrent = (() => {
      const c = (vendor.country || '').toLowerCase().trim();
      return c === 'china' || c === 'cn' || c === 'prc';
    })();
    const cid = coreId.toLowerCase().trim();
    const vNameLower = vendor.name.toLowerCase().trim();
    const parseNote = (note) => {
      if (!note) return { kind: 'unknown', name: null };
      const n = String(note).trim();
      const m = n.match(/^(.+?)\s+-\s+/);
      if (m) return { kind: 'named', name: m[1].trim() };
      return { kind: 'unnamed', name: null };
    };
const isChinaRow = (r) => (Number(r?.inbShip) || 0) > 0 || (Number(r?.tariffs) || 0) > 0;
const rows = priceHistoryFull
      .filter(r => r && (r.core || '').toLowerCase().trim() === cid)
      .map(r => {
        const pcs = Number(r.pcs);
        const total = Number(r.totalCost);
        if (!(pcs > 0) || !(total > 0)) return null;
        const cpp = total / pcs;
        const parsed = parseNote(r.note);
        return { date: r.date || '', cpp, note: r.note, parsed, isChina: isChinaRow(r), raw: r };
      })
      .filter(Boolean)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (rows.length === 0) return null;
    let currentRow = null;
    for (const r of rows) {
      if (isChinaCurrent) {
        if (r.isChina) { currentRow = r; break; }
      } else {
        if (r.isChina) continue;
        if (r.parsed.kind === 'named' && r.parsed.name) {
          const nl = r.parsed.name.toLowerCase();
          if (nl === vNameLower || nl.includes(vNameLower) || vNameLower.includes(nl)) {
            currentRow = r; break;
          }
        }
      }
    }
    if (!currentRow) return null;
    let benchRow = null;
    let benchLabel = '';
    if (isChinaCurrent) {
      for (const r of rows) {
        if (r.isChina) continue;
        if (r.parsed.kind === 'named' && r.parsed.name) {
          benchRow = r;
          benchLabel = r.parsed.name;
          break;
        }
      }
    } else {
      for (const r of rows) {
        if (r === currentRow) continue;
        if (r.isChina) {
          benchRow = r;
          benchLabel = 'China';
          break;
        }
      }
    }
    if (!benchRow) return null;
    const pctDiff = benchRow.cpp > 0 ? ((currentRow.cpp - benchRow.cpp) / benchRow.cpp) * 100 : 0;
    return {
      currentCpp: currentRow.cpp,
      currentDate: currentRow.date,
      benchmarkCpp: benchRow.cpp,
      benchmarkDate: benchRow.date,
      benchmarkLabel: benchLabel,
      pctDiff,
    };
  }, [priceHistoryFull]);

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

      const vRec = effectiveRecs[c.ven];
      const cDet = vRec?.coreDetails?.find(x => x.coreId === c.id);
      const sNeed = cDet?.needPieces || 0;
      const oq = cDet?.finalQty || 0;
      const moqInflated = cDet?.moqInflated || false;
      const moqInflationRatio = cDet?.moqInflationRatio || 1;
      const excessFromMoq = cDet?.excessFromMoq || 0;
      const excessCostFromMoq = cDet?.excessCostFromMoq || 0;
      const recUrgent = cDet?.urgent || false;
      const bundlesAffected = cDet?.bundlesAffected || 0;

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
    if (nf === "inorder") {
      // Show this core if EITHER the core itself OR any of its bundles
      // has pcs/cas loaded in the order overrides.
      const coreHasOrder = ov[c.id]?.pcs > 0 || ov[c.id]?.cas > 0;
      const bundlesOfThisCore = (data.bundles || []).filter(b => {
        for (let i = 1; i <= 20; i++) if (b['core' + i] === c.id) return true;
        return false;
      });
      const anyBundleHasOrder = bundlesOfThisCore.some(b =>
        ov[b.j]?.pcs > 0 || ov[b.j]?.cas > 0
      );
      if (!coreHasOrder && !anyBundleHasOrder) return false;
    }
      if (locF === "us" && !c.isDom) return false;
      if (locF === "intl" && c.isDom) return false;
      return true;
    }).sort((a, b) => {
      const so = { critical: 0, warning: 1, healthy: 2 };
      if (sort === "status") {
        const aN = a.needQty > 0 ? 0 : 1;
        const bN = b.needQty > 0 ? 0 : 1;
        if (aN !== bN) return aN - bN;
        if (so[a.status] !== so[b.status]) return so[a.status] - so[b.status];
        return b.needDollar - a.needDollar;
      }
      if (sort === "doc") return a.doc - b.doc;
      if (sort === "dsr") return b.dsr - a.dsr;
      if (sort === "need$") return b.needDollar - a.needDollar;
      return 0;
    })
   , [data, stg, vf, sf, sort, vMap, nf, minD, locF, profiles, effectiveRecs, showNoBundleCores, activeBundleCores, spikeThr, ov]);
  
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
      const vendorPrice = getVendorPrice(c.ven, c.id, c.cost);
      const unitCost = cogpOv > 0 ? cogpOv : vendorPrice;
      items.push({ id: c.id, ti: c.ti, vsku: c.vsku, qty: coreEffQ(c), cost: unitCost, cp: c.casePack || 1, inbS: gInbS(c.id), isCoreItem: true });
    });
    (bundles || []).filter(b => hasBundleOrd(b)).forEach(b => {
      const f = feMap[b.j];
      const cogpOv = gCogP(b.j);
      const vendorsRaw = (b.vendors || "").trim();
      let vendorName = vendorsRaw;
      if (!effectiveRecs[vendorName]) {
        const firstChunk = vendorsRaw.split(',').map(s => s.trim()).find(v => v && effectiveRecs[v]) || "";
        if (firstChunk) vendorName = firstChunk;
      }
      const vendorPrice = getVendorPrice(vendorName, b.j, f?.aicogs || b.aicogs || 0);
      const unitCost = cogpOv > 0 ? cogpOv : vendorPrice;
      items.push({ id: b.j, ti: b.t, vsku: b.asin || b.bundleCode, qty: bundleEffQ(b), cost: unitCost, cp: 1, inbS: gInbS(b.j), isCoreItem: false });
    });
    return items;
  };

  const autoPO = (vendorCode) => { if (poN) return poN; const d = new Date(); const serial = Math.floor((d - new Date(1899, 11, 30)) / 86400000); return 'PO-' + serial + '-' + (vendorCode || 'XXX') };

  // ════════════════════════════════════════════════════════
  // [v3.4 FIX] Helper centralizado para llamar al recommender
  // con TODOS los inputs correctos. Antes fillR y los MOQ
  // overrides olvidaban bundleDays/coreDays/abcA, lo que hacía
  // que el motor cayera al fallback flat y diera números
  // distintos que el batch principal.
  // ════════════════════════════════════════════════════════
  const callRecommender = useCallback((vendorName, opts = {}) => {
    const vendor = vMap[vendorName];
    if (!vendor) return null;
    const segMap = {};
    for (const [bid, rec] of Object.entries(segCtx.effectiveMap || {})) {
      segMap[bid] = rec.effective;
    }
    return calcVendorRecommendationV4({
      vendor,
      cores: data.cores || [],
      bundles: data.bundles || [],
      bundleSales: data._bundleSales || [],
      bundleDays: data.bundleDaysForecast || [],
      coreDays: data.coreDaysForecast || [],
      abcA: data.abcA || [],
      receivingFull: data.receivingFull || [],
      replenMap,
      missingMap,
      priceCompFull: (data.priceCompFull?.length ? data.priceCompFull : data.priceComp) || [],
      segmentMap: segMap,
      settings: stg,
      forceMode: opts.forceMode || null,
      bundleMoqOverride: opts.bundleMoqOverride || 0,
      moqExtraDocThreshold: stg.moqExtraDocThreshold || 30,
    });
  }, [vMap, data, replenMap, missingMap, stg, segCtx.effectiveMap]);

  const applyMoqOverride = useCallback((vendorName) => {
    const ov = moqOverrides[vendorName] || {};
    const rec = callRecommender(vendorName, { bundleMoqOverride: ov.bundleMoq || 0 });
    if (rec) {
      setOverrideRecs(prev => ({ ...prev, [vendorName]: rec }));
      setToast(`MOQ override applied for ${vendorName}`);
    }
  }, [moqOverrides, callRecommender]);

  const applyMoqOverrideSilent = useCallback((vendorName, bundleMoqValue) => {
    if (!bundleMoqValue || bundleMoqValue <= 0) {
      setOverrideRecs(prev => {
        if (!prev[vendorName]) return prev;
        const n = { ...prev };
        delete n[vendorName];
        return n;
      });
      return;
    }
    const rec = callRecommender(vendorName, { bundleMoqOverride: bundleMoqValue });
    if (rec) {
      setOverrideRecs(prev => ({ ...prev, [vendorName]: rec }));
    }
  }, [callRecommender]);
  
  const resetMoqOverride = useCallback((vendorName) => {
    setMoqOverrides(prev => { const n = { ...prev }; delete n[vendorName]; return n; });
    setOverrideRecs(prev => { const n = { ...prev }; delete n[vendorName]; return n; });
    setToast(`MOQ override cleared for ${vendorName}`);
  }, []);

  const getMoqOv = (vendorName) => moqOverrides[vendorName] || {};
  const setMoqOv = (vendorName, field, value) => {
    setMoqOverrides(prev => ({
      ...prev,
      [vendorName]: { ...(prev[vendorName] || {}), [field]: value }
    }));
    if (field === 'bundleMoq') {
      if (moqDebounceTimers.current[vendorName]) {
        clearTimeout(moqDebounceTimers.current[vendorName]);
      }
      moqDebounceTimers.current[vendorName] = setTimeout(() => {
        applyMoqOverrideSilent(vendorName, value);
      }, 600);
    }
  };

  // [v3.4 FIX] fillR ahora usa callRecommender — Force Cores y
  // Force Bundles producen los mismos números que Mix. Lo único
  // que cambia es el switch de buyMode.
  const fillR = (cores, bundles, mode, vendorName) => {
    const forceMode = mode === 'cores' ? 'cores' : mode === 'bundles' ? 'bundles' : null;
    const rec = forceMode
      ? callRecommender(vendorName, {
          forceMode,
          bundleMoqOverride: moqOverrides[vendorName]?.bundleMoq || 0,
        })
      : effectiveRecs[vendorName];
    if (!rec || !rec.items?.length) { setToast("Nothing to fill"); return; }
    const u = { ...ov };
    for (const item of rec.items) {
      if (item.finalQty > 0) u[item.id] = { ...(u[item.id] || {}), pcs: item.finalQty };
    }
    setOv(u);
    setToast(`Filled ${rec.items.length} items`);
  };

  const doFillMOQ = (grpCores, grpBundles, vendorMOQDollar) => {
    let currentTotal = 0;
    grpCores.forEach(c => {
      if (!hasCoreOrd(c)) return;
      const cogpOv = gCogP(c.id);
      const vendorPrice = getVendorPrice(c.ven, c.id, c.cost);
      currentTotal += coreEffQ(c) * (cogpOv > 0 ? cogpOv : vendorPrice);
    });
    if (vendorSub !== "cores") (grpBundles || []).filter(b => hasBundleOrd(b)).forEach(b => {
      const f = feMap[b.j];
      const cogpOv = gCogP(b.j);
      const vendorsRaw = (b.vendors || "").trim();
      let vendorName = vendorsRaw;
      if (!effectiveRecs[vendorName]) {
        const firstChunk = vendorsRaw.split(',').map(s => s.trim()).find(v => v && effectiveRecs[v]) || "";
        if (firstChunk) vendorName = firstChunk;
      }
      const vendorPrice = getVendorPrice(vendorName, b.j, f?.aicogs || 0);
      currentTotal += bundleEffQ(b) * (cogpOv > 0 ? cogpOv : vendorPrice);
    });
    if (currentTotal >= vendorMOQDollar) { setToast("Already at/above MOQ"); return; }
    const addable = grpCores.filter(c => hasCoreOrd(c) && c.cost > 0 && c.dsr > 0).map(c => {
      const cogpOv = gCogP(c.id);
      const vendorPrice = getVendorPrice(c.ven, c.id, c.cost);
      return {
        id: c.id, isCore: true, casePack: c.casePack || 1,
        cost: cogpOv > 0 ? cogpOv : vendorPrice,
        dsr: c.dsr, ref: c,
      };
    });
    if (addable.length === 0) { setToast("No orderable items — click Fill Rec first"); return; }
    const u = { ...ov };
    let added = 0;
    let safety = 0;
    while (currentTotal < vendorMOQDollar && safety < 500) {
      safety++;
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

  const openBreakdown = useCallback((c) => { setBreakdownCore(c); }, []);
  const getCombinedRec = (coreId) => { const recs = [...(recMap[coreId] || [])]; (data.bundles || []).filter(b => b.core1 === coreId && b.active === "Yes").forEach(b => { if (recMap[b.j]) recs.push(...recMap[b.j]) }); return recs.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 7) };
  const hasRecData = (coreId) => recMap[coreId]?.length || (data.bundles || []).some(b => b.core1 === coreId && b.active === "Yes" && recMap[b.j]?.length);

  const CoreRow = ({ c, isLastOfGroup }) => {
    if (dismissed[c.id]) return <tr className="border-t border-gray-800/20 bg-gray-900/30 text-xs opacity-40"><td className="py-1 px-1" colSpan={2}><Dot status={c.status} /></td><td className="py-1 px-1 text-gray-500 font-mono">{c.id}</td><td className="py-1 px-1 text-gray-600 truncate max-w-[110px]">{c.ti}</td><td colSpan={30} className="py-1 px-1 text-right"><button onClick={() => togDismiss(c.id)} className="text-xs text-gray-500 hover:text-white px-1">+</button></td></tr>;
    const eq = coreEffQ(c);
    const cogpOverride = gCogP(c.id);
    const vendorPrice = getVendorPrice(c.ven, c.id, c.cost);
    const unitCost = cogpOverride > 0 ? cogpOverride : vendorPrice;
    const cost = eq * unitCost;

    let ad = null;
    if (eq > 0 && c.dsr > 0) ad = Math.round((c.allIn + eq) / c.dsr);
    else if (c.dsr > 0) ad = Math.round(c.allIn / c.dsr);

    const isCol = collapsed[c.id];
    const combinedRec = showPH[c.id] ? getCombinedRec(c.id) : [];
    const hasSeasonal = c.sProfile?.hasHistory;
    const isUrgent = c.sCoverage?.urgent;

    const rowBg = "";
    const stickyBg = "bg-gray-950";

    return <>
      <tr className={`${isLastOfGroup ? "border-b-2 border-gray-700" : "border-b border-gray-800/40"} hover:bg-gray-800/40 text-xs ${rowBg}`}>
        <td className={`py-2 px-0.5 sticky left-0 z-10 w-4 ${stickyBg}`}><Dot status={c.status} /></td>
        <td className={`py-2 px-0.5 sticky left-4 z-10 whitespace-nowrap ${stickyBg}`}>
          <button onClick={() => goCore(c.id)} className="text-blue-400 font-mono hover:underline text-[11px]">{c.id}</button>
        </td>
        <td className={`py-2 px-1 sticky left-[85px] z-10 ${stickyBg}`}>
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className="text-gray-100 truncate max-w-[160px] font-medium">{c.ti}</span>
            {isUrgent && <Flag type="OOS" />}
            {c.invAnomaly && <Flag type="INV" />}
            {c.moqInflated && <Flag type="MOQ" extraTip={`MOQ forces ${Math.round(c.moqInflationRatio * 100)}% of real need. Excess: ${R(c.excessFromMoq)} pcs / $${Math.round(c.excessCostFromMoq).toLocaleString()}`} />}
            {c.bundlesAffected > 0 && <span className="text-[10px] text-gray-500 flex-shrink-0" title={`Driven by ${c.bundlesAffected} bundle(s). See 📊 Step 3.`}>({c.bundlesAffected}b)</span>}
          </div>
        </td>

        <SC v={c.dsr} className="py-2 px-1 text-right">{D1(c.dsr)}</SC>
        <SC v={c.d7} className="py-2 px-1 text-right">{D1(c.d7)}</SC>
        <td className="py-2 px-1 text-center">{c.d7 > c.dsr ? <span className={c.spike ? "text-orange-400 font-bold" : "text-emerald-400"}>▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}{c.spike && <span className="text-orange-400 text-xs ml-0.5">⚡</span>}</td>
        <SC v={c.doc} className={`py-2 px-1 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</SC>
        <SC v={c.allIn} className="py-2 px-1 text-right">{R(c.allIn)}</SC>
        <td className="py-2 px-1 text-center">{c.seas && <span className="text-purple-400 font-bold">{c.seas.peak}</span>}</td>

        {showDetail && <>
          <td className="py-2 px-1 text-right text-gray-500">{c.moq > 0 ? R(c.moq) : "—"}</td>
          <td className="py-2 px-1 text-right text-gray-500">{c.casePack > 0 ? R(c.casePack) : "—"}</td>
          {!isCol && <>
            <SC v={c.raw} className="py-2 px-1 text-right text-gray-400">{R(c.raw)}</SC>
            <SC v={c.pp} className="py-2 px-1 text-right text-gray-400">{R(c.pp)}</SC>
            <SC v={c.inb} className="py-2 px-1 text-right text-gray-400">{R(c.inb)}</SC>
            <SC v={c.fba} className="py-2 px-1 text-right text-gray-400">{R(c.fba)}</SC>
          </>}
        </>}

        {showRS && <td colSpan={8} />}
        <td className="py-2 border-l-2 border-blue-500/40 px-1" />

        <td className={`py-1 px-0.5 sticky right-36 z-10 ${stickyBg}`}><NumInput value={gPcs(c.id)} onChange={v => setF(c.id, 'pcs', v)} /></td>
        <td className={`py-1 px-0.5 sticky right-24 z-10 ${stickyBg}`}><NumInput value={gCas(c.id)} onChange={v => setF(c.id, 'cas', v)} /></td>
        {showDetail && <>
          <td className="py-1 px-0.5"><NumInput value={gInbS(c.id)} onChange={v => setF(c.id, 'inbS', v)} /></td>
          <td className="py-1 px-0.5"><NumInput value={gCogP(c.id)} onChange={v => setF(c.id, 'cogP', v)} /></td>
          <td className="py-1 px-0.5"><NumInput value={gCogC(c.id)} onChange={v => setF(c.id, 'cogC', v)} /></td>
        </>}
        {(() => {
          const bench = getCppBenchmark(c.id, vMap[c.ven]);
          let tip = null;
          let pctEl = null;
          if (bench) {
            const cheaper = bench.pctDiff < 0;
            const sign = bench.pctDiff > 0 ? '+' : '';
            tip = `Current CPP (${c.ven}): $${bench.currentCpp.toFixed(4)}/pc (from ${bench.currentDate})\nBenchmark (${bench.benchmarkLabel}): $${bench.benchmarkCpp.toFixed(4)}/pc (from ${bench.benchmarkDate})\n${sign}${bench.pctDiff.toFixed(0)}% vs benchmark (total-cost CPP, inbound+tariffs included)`;
            pctEl = <span className={`block text-[9px] font-normal ${cheaper ? "text-emerald-400" : "text-red-400"}`} title={tip}>{sign}{bench.pctDiff.toFixed(0)}%</span>;
          }
          return (
            <SC v={cost} className={`py-2 px-1 text-right text-amber-300 font-semibold sticky right-12 z-10 ${stickyBg}`}>
              <span title={tip || undefined}>{cost > 0 ? $(cost) : "—"}</span>
              {pctEl}
            </SC>
          );
        })()}
        <td className={`py-2 px-1 text-right sticky right-0 z-10 ${stickyBg} ${ad ? dc(ad, c.critDays, c.warnDays) : "text-gray-500"}`}>{ad ? R(ad) : "—"}</td>
        <td className="py-2 px-0.5 flex gap-0.5 items-center">
          <button onClick={() => togCollapse(c.id)} className="text-gray-400 hover:text-white text-xs px-0.5">{isCol ? "+" : "−"}</button>
          <button onClick={() => togDismiss(c.id)} className="text-gray-400 hover:text-red-400 text-xs px-0.5">✕</button>
          {(pcMap[c.id] || hasRecData(c.id)) && <button onClick={() => togPH(c.id)} className={`text-xs px-0.5 rounded ${showPH[c.id] ? "text-amber-300" : "text-gray-500"}`}>$</button>}
          <button onClick={() => openBreakdown(c)} className={`text-xs px-0.5 rounded ${hasSeasonal ? "text-purple-400" : "text-gray-600"}`} title="Breakdown">📊</button>
          <button onClick={() => goCore(c.id)} className="text-blue-400 px-0.5 bg-blue-400/10 rounded text-xs">V</button>
          <div className="relative"><WorkflowChip id={c.id} type="core" workflow={data.workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer} country={c.vc} /></div>
        </td>
      </tr>
      {showPH[c.id] && (pcMap[c.id] || combinedRec.length > 0) && <tr><td colSpan={40} className="p-0"><div className="bg-gray-800/50 px-4 py-2 space-y-3">
        {pcMap[c.id] && <div><div className="text-gray-500 text-xs font-semibold mb-1">💰 Purchase History (7g)</div><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="py-0.5 text-left">Date</th><th className="py-0.5 text-right">Pcs</th><th className="py-0.5 text-right">Material</th><th className="py-0.5 text-right">Inb Ship</th><th className="py-0.5 text-right">Tariffs</th><th className="py-0.5 text-right">Total</th><th className="py-0.5 text-right">CPP</th></tr></thead><tbody>{pcMap[c.id].map((r, i) => <tr key={i} className="border-t border-gray-700/30"><td className="py-0.5 text-gray-300">{fDateUS(r.date)}</td><td className="py-0.5 text-right">{R(r.pcs)}</td><td className="py-0.5 text-right">{$2(r.matPrice)}</td><td className="py-0.5 text-right text-gray-400">{$2(r.inbShip)}</td><td className="py-0.5 text-right text-gray-400">{$2(r.tariffs)}</td><td className="py-0.5 text-right">{$2(r.totalCost)}</td><td className="py-0.5 text-right text-amber-300">{$2(r.cpp)}</td></tr>)}</tbody></table></div>}
        {combinedRec.length > 0 && <div><div className="text-gray-500 text-xs font-semibold mb-1">📦 Receiving (7f)</div><table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="py-0.5 text-left">Date</th><th className="py-0.5 text-left">Vendor</th><th className="py-0.5 text-left">ID</th><th className="py-0.5 text-right">Pcs</th><th className="py-0.5 text-right">Cases</th><th className="py-0.5 text-left">Order #</th><th className="py-0.5 text-right">Missing</th></tr></thead><tbody>{combinedRec.map((r, i) => <tr key={i} className="border-t border-gray-700/30"><td className="py-0.5 text-gray-300">{fDateUS(r.date) || "—"}</td><td className="py-0.5 text-gray-300">{r.vendor || "—"}</td><td className="py-0.5 text-blue-400 font-mono">{r.core}</td><td className="py-0.5 text-right text-white">{R(r.pcs)}</td><td className="py-0.5 text-right">{r.cases > 0 ? R(r.cases) : "—"}</td><td className="py-0.5 text-gray-300">{r.orderNum || "—"}</td><td className={`py-0.5 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-500"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td></tr>)}</tbody></table></div>}
      </div></td></tr>}
    </>;
  };

  const BundleRow = ({ b }) => {
    const f = b.fee || feMap[b.j];
    const eq = bundleEffQ(b);
    const cogpOverride = gCogP(b.j);
    const vendorsRaw = (b.vendors || "").trim();
    let vendorName = vendorsRaw;
    if (!effectiveRecs[vendorName]) {
      const firstChunk = vendorsRaw.split(',').map(s => s.trim()).find(v => v && effectiveRecs[v]) || "";
      if (firstChunk) vendorName = firstChunk;
    }
    const vendorPrice = getVendorPrice(vendorName, b.j, f?.aicogs || 0);
    const unitCost = cogpOverride > 0 ? cogpOverride : vendorPrice;
    const cost = eq * unitCost;
    const aged = agedMap[b.j];
    const kill = killMap[b.j];
    const inb7f = missingMap[b.j] || 0;
    const rp = replenMap[b.j];
    const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0;
    const bCasePack = casePackFromRec[b.j] || 0;

    const bd = bundleEffMap[b.j];
    const effDSR = bd?.effectiveDSR || b.cd || 0;
    const totalAvail = bd?.totalAvailable ?? ((b.fibInv || 0) + (rp?.pprcUnits || 0) + (rp?.batched || 0) + inb7f);
    const effectiveDOC = effDSR > 0 ? Math.round((totalAvail + eq) / effDSR) : null;
    const urgentBundle = bd?.urgent;

    // [v3.4] regime info para badges
    const regime = bd?.regime || null;
    const regimeReason = bd?.regimeInfo?.reason || '';

    const rowBg = "bg-indigo-950/20";
    const stickyBg = "bg-indigo-950/40";

    return <tr className={`border-b border-gray-800/20 hover:bg-indigo-900/20 text-xs ${rowBg}`}>
      <td className={`py-1.5 px-0.5 sticky left-0 z-10 w-4 border-l-2 border-indigo-500/40 ${stickyBg}`} />
      <td className={`py-1.5 px-0.5 sticky left-4 z-10 whitespace-nowrap ${stickyBg}`}><button onClick={() => goBundle(b.j)} className="text-indigo-400 font-mono hover:underline text-[11px]">{b.j}</button></td>
      <td className={`py-1.5 px-1 text-indigo-200 truncate max-w-[160px] sticky left-[85px] z-10 ${stickyBg}`}>
        <span className="pl-3">↳ {b.t}</span>
        {b.asin && <a href={`https://sellercentral.amazon.com/myinventory/inventory?fulfilledBy=all&page=1&pageSize=25&searchField=all&searchTerm=${b.asin}&sort=date_created_desc&status=all`} target="_blank" rel="noopener noreferrer" className="ml-1 text-gray-500 hover:text-blue-400 text-[9px] font-mono">{b.asin}</a>}
        {(() => {
          const segRec = segCtx.effectiveMap[b.j];
          if (!segRec) return null;
          if (segRec.effective === 'STABLE' && segRec.confidence === 'high') return null;
          return <span className="ml-1"><SegmentBadge segment={segRec.segment} override={segRec.override !== segRec.segment ? segRec.override : null} small /></span>;
        })()}
        {urgentBundle && <Flag type="OOS" />}
        {regime === 'intermittent' && <Flag type="INTERMITTENT" extraTip={regimeReason} />}
        {regime === 'new_or_sparse' && <Flag type="NEW" extraTip={regimeReason} />}
        {bd?.bundleMoqStatus === 'wait' && <span className="ml-1 text-[10px] font-semibold text-sky-300 bg-sky-500/20 border border-sky-500/40 px-1.5 py-0.5 rounded" title={`Below Bundle MOQ. Need ${bd.bundleMoqOriginalNeed} but MOQ requires more. Would add ${bd.bundleMoqExtraDOC}d extra stock. Waiting to accumulate.`}>⏸ Wait</span>}
        {bd?.bundleMoqStatus === 'inflated_urgent' && <span className="ml-1 text-[10px] font-semibold text-red-300 bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 rounded" title={`MOQ inflated (urgent) — needed ${bd.bundleMoqOriginalNeed}, buying MOQ to avoid stockout. +${bd.bundleMoqExtraDOC}d extra.`}>⚠ MOQ urgent</span>}
        {bd?.bundleMoqStatus === 'inflated_ok' && <span className="ml-1 text-[10px] font-semibold text-orange-300 bg-orange-500/20 border border-orange-500/40 px-1.5 py-0.5 rounded" title={`MOQ inflated — needed ${bd.bundleMoqOriginalNeed}, buying MOQ. +${bd.bundleMoqExtraDOC}d extra (acceptable).`}>$ Inflated</span>}
          {bd?.bundleMoqStatus === 'inflated_excess' && <span className="ml-1 text-[10px] font-semibold text-red-300 bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 rounded" title={`MOQ inflated heavily — needed ${bd.bundleMoqOriginalNeed}, buying MOQ. +${bd.bundleMoqExtraDOC}d extra (above 30d threshold). Review before ordering.`}>⚠ MOQ excess +{bd.bundleMoqExtraDOC}d</span>}
        {aged && aged.fbaHealth !== "Healthy" && <span className={`ml-1 text-xs ${aged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{aged.fbaHealth}</span>}
        {aged && aged.storageLtsf > 0 && <span className="ml-1 text-xs text-red-300">${aged.storageLtsf.toFixed(0)}</span>}
        {kill && kill.latestEval && kill.latestEval.toLowerCase().includes('kill') && <span className="ml-1 text-xs text-red-400 font-bold">KILL</span>}
        {kill && kill.sellEval && kill.sellEval.toLowerCase().includes('sell') && <span className="ml-1 text-xs text-amber-400 font-bold">ST</span>}
      </td>
      <SC v={b.cd} className="py-1.5 px-1 text-right text-indigo-300">{D1(b.cd)}</SC>
      <SC v={b.d7comp} className="py-1.5 px-1 text-right text-indigo-300">{D1(b.d7comp)}</SC>
      <td className="py-1.5 px-1 text-center">{b.d7comp > b.cd ? <span className="text-emerald-400">▲</span> : b.d7comp < b.cd ? <span className="text-red-400">▼</span> : "—"}</td>
      <SC v={b.doc} className="py-1.5 px-1 text-right text-indigo-300">{R(b.doc)}</SC>
      <td className="py-1.5 px-1 text-right text-gray-700" />
      <td className="py-1.5 px-1 text-center text-indigo-300">{b.replenTag || ""}</td>

      {showDetail && <>
        <td className="py-1.5 px-1 text-right text-gray-700" />
        <td className="py-1.5 px-1 text-gray-500 text-right">{bCasePack > 0 ? R(bCasePack) : ""}</td>
        {!collapsed[b.j] && <td colSpan={4} />}
      </>}

      {showRS && <>
        <td className="py-1.5 border-l-2 border-cyan-800 px-0.5" />
        <SC v={b.fibDoc} className="py-1.5 px-1 text-right text-cyan-300">{R(b.fibDoc)}</SC>
        <td className={`py-1.5 px-1 text-right ${margin >= 30 ? "text-emerald-400" : margin >= 15 ? "text-amber-400" : margin > 0 ? "text-red-400" : "text-gray-600"}`}>{margin > 0 ? Math.round(margin) + "%" : "—"}</td>
        <SC v={rp?.rawUnits} className="py-1.5 px-1 text-right">{R(rp?.rawUnits || 0)}</SC>
        <SC v={rp?.batched} className="py-1.5 px-1 text-right">{R(rp?.batched || 0)}</SC>
        <SC v={b.fibInv} className="py-1.5 px-1 text-right text-cyan-300">{R(b.fibInv || 0)}</SC>
        <SC v={rp?.pprcUnits} className="py-1.5 px-1 text-right">{R(rp?.pprcUnits || 0)}</SC>
        <td className="py-1.5 px-1 text-right text-red-400">{inb7f > 0 ? R(inb7f) : "0"}</td>
      </>}

      <td className="py-1.5 border-l-2 border-blue-500/40 px-1" />
      <td className={`py-1 px-0.5 sticky right-36 z-10 ${stickyBg}`}><NumInput value={gPcs(b.j)} onChange={v => setF(b.j, 'pcs', v)} /></td>
      <td className={`py-1 px-0.5 sticky right-24 z-10 ${stickyBg}`}><NumInput value={gCas(b.j)} onChange={v => setF(b.j, 'cas', v)} /></td>
      {showDetail && <>
        <td className="py-1 px-0.5"><NumInput value={gInbS(b.j)} onChange={v => setF(b.j, 'inbS', v)} /></td>
        <td className="py-1 px-0.5"><NumInput value={gCogP(b.j)} onChange={v => setF(b.j, 'cogP', v)} /></td>
        <td className="py-1 px-0.5"><NumInput value={gCogC(b.j)} onChange={v => setF(b.j, 'cogC', v)} /></td>
      </>}
      <SC v={cost} className={`py-1.5 px-1 text-right text-amber-300 sticky right-12 z-10 ${stickyBg}`}>{cost > 0 ? $(cost) : "—"}</SC>
      <td className={`py-1.5 px-1 text-right sticky right-0 z-10 ${stickyBg} ${effectiveDOC ? (effectiveDOC <= 30 ? "text-red-400" : effectiveDOC <= 60 ? "text-amber-400" : "text-emerald-400") : "text-gray-600"}`}>{effectiveDOC ? R(effectiveDOC) : "—"}</td>
      <td className="py-1.5 px-1"><button onClick={() => goBundle(b.j)} className="text-indigo-400 px-0.5 bg-indigo-400/10 rounded text-xs">V</button></td>
    </tr>;
  };

  const rsToggle = <button onClick={() => setShowRS(!showRS)} className={`text-xs px-1.5 py-0.5 rounded font-bold ${showRS ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:text-gray-200"}`} title="Show Replen Stock details (margin, batch, FIB)">{showRS ? "−" : "+"}RS</button>;
  const detailToggle = <button onClick={() => setShowDetail(!showDetail)} className={`text-xs px-1.5 py-0.5 rounded font-bold ${showDetail ? "bg-teal-600 text-white" : "bg-gray-700 text-gray-400 hover:text-gray-200"}`} title="Show secondary detail columns (MOQ, VCAS, Raw, PPRC, INB, FBA, cost overrides)">{showDetail ? "−" : "+"} Detail</button>;

  const VTH = ({ isCol }) => <tr className="text-gray-500 uppercase bg-gray-900 text-xs sticky top-0 z-20">
    <th className="py-2 px-1 w-5 sticky left-0 bg-gray-900 z-30" />
    <TH tip="Core or JLS #" className="py-2 px-1 text-left sticky left-5 bg-gray-900 z-30">ID</TH>
    <th className="py-2 px-1 text-left sticky left-24 bg-gray-900 z-30">Title</th>
    <TH tip="Composite DSR" className="py-2 px-1 text-right">DSR</TH>
    <TH tip="7-Day DSR" className="py-2 px-1 text-right">7D</TH>
    <TH tip="Trend" className="py-2 px-1 text-center">T</TH>
    <TH tip="Days of Coverage" className="py-2 px-1 text-right">DOC</TH>
    <TH tip="All-In" className="py-2 px-1 text-right">All-In</TH>
    <TH tip="Seasonal peak" className="py-2 px-1 text-center">S</TH>

    {showDetail && <>
      <TH tip="MOQ" className="py-2 px-1 text-right">MOQ</TH>
      <TH tip="Case Pack" className="py-2 px-1 text-right">VCas</TH>
      {!isCol && <>
        <TH tip="Raw" className="py-2 px-1 text-right">Raw</TH>
        <TH tip="PPRC" className="py-2 px-1 text-right">PPRC</TH>
        <TH tip="Inbound to Amazon" className="py-2 px-1 text-right">Inb</TH>
        <TH tip="FBA Pcs" className="py-2 px-1 text-right">FBA Pcs</TH>
      </>}
    </>}

    {showRS && <>
      <th className="py-2 border-l-2 border-cyan-800 px-0.5" />
      <TH tip="FIB DOC" className="py-2 px-1 text-right text-cyan-400">FibDoc</TH>
      <TH tip="Margin" className="py-2 px-1 text-right text-cyan-400">Mrgn</TH>
      <TH tip="Raw" className="py-2 px-1 text-right text-cyan-400">Raw</TH>
      <TH tip="Batch" className="py-2 px-1 text-right text-cyan-400">Batch</TH>
      <TH tip="FIB" className="py-2 px-1 text-right text-cyan-400">FIB</TH>
      <TH tip="PPRC" className="py-2 px-1 text-right text-cyan-400">PPRC</TH>
      <TH tip="7f Miss" className="py-2 px-1 text-right text-red-400">7f Miss</TH>
    </>}

    <th className="py-2 border-l-2 border-blue-500/40 px-1" />
    <TH tip="Pieces" className="py-2 px-1 text-center sticky right-36 bg-gray-900 z-30 text-blue-300">Pcs</TH>
    <TH tip="Cases" className="py-2 px-1 text-center sticky right-24 bg-gray-900 z-30 text-blue-300">Cas</TH>
    {showDetail && <>
      <TH tip="Inbound shipping override" className="py-2 px-1 text-center">InbS</TH>
      <TH tip="COGS per piece override" className="py-2 px-1 text-center">CogP</TH>
      <TH tip="COGS per case override" className="py-2 px-1 text-center">CogC</TH>
    </>}
    <th className="py-2 px-1 text-right sticky right-12 bg-gray-900 z-30 text-blue-300">Cost</th>
    <TH tip="After DOC" className="py-2 px-1 text-right sticky right-0 bg-gray-900 z-30 text-blue-300">After</TH>
    <th className="py-2 px-1 w-24">{rsToggle} {detailToggle}</th>
  </tr>;

  return <div className="p-4">{toast && <Toast msg={toast} onClose={() => { setToast(null); setToastPersist(false); }} persist={toastPersist} />}
    {breakdownCore && <CalcBreakdownV2 core={breakdownCore} vendor={vMap[breakdownCore.ven]} vendorRec={effectiveRecs[breakdownCore.ven]} profile={profiles[breakdownCore.id]} stg={stg} onClose={() => setBreakdownCore(null)} />}{showDeltaFor && vendorDeltas[showDeltaFor] && <DeltaModal vendorName={showDeltaFor} delta={vendorDeltas[showDeltaFor]} onClose={() => setShowDeltaFor(null)} />}
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <div className="flex bg-gray-800 rounded-lg p-0.5">{["core", "vendor"].map(m => <button key={m} onClick={() => setVm(m)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm === m ? "bg-blue-600 text-white" : "text-gray-400"}`}>{m === "core" ? "By Core" : "By Vendor"}</button>)}</div>
      <SS value={vf} onChange={setVf} options={vNames} />
      <select value={sf} onChange={e => setSf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="">All Status</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>
      {!vf && <select value={locF} onChange={e => setLocF(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="us">US Only</option><option value="intl">International</option></select>}
      <select value={nf} onChange={e => setNf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="inorder">In Order</option></select>
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

    {vm === "core" && <div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead><tr className="bg-gray-900/80 text-xs text-gray-400 uppercase sticky top-0 z-20"><th className="py-3 px-2 w-8" /><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left">Vendor</th><th className="py-3 px-2 text-left">Title</th><TH tip="DSR" className="py-3 px-2 text-right">DSR</TH><TH tip="7D" className="py-3 px-2 text-right">7D</TH><th className="py-3 px-2 text-center">T</th><TH tip="DOC" className="py-3 px-2 text-right">DOC</TH><TH tip="All-In" className="py-3 px-2 text-right">All-In</TH><th className="py-3 px-2 text-right">MOQ</th><th className="py-3 px-2 text-center">S</th><th className="py-3 px-1 border-l-2 border-blue-500/40" /><TH tip="Need (bundle-driven)" className="py-3 px-2 text-right text-blue-300">Need</TH><th className="py-3 px-2 text-right text-blue-300">Order</th><th className="py-3 px-2 text-right text-blue-300">Cost</th><TH tip="After DOC" className="py-3 px-2 text-right text-blue-300">After</TH><th className="py-3 px-2 w-14" /></tr></thead>
      <tbody>{enr.map(c => <tr key={c.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 text-sm ${c.sCoverage?.urgent ? "bg-red-900/10" : ""}`}><td className="py-2 px-2"><Dot status={c.status} /></td><td className="py-2 px-2"><button onClick={() => goCore(c.id)} className="text-blue-400 font-mono text-xs hover:underline">{c.id}</button></td><td className="py-2 px-2 text-blue-300 text-xs truncate max-w-[100px] cursor-pointer hover:underline" onClick={() => goVendor(c.ven)}>{c.ven}</td><td className="py-2 px-2 text-gray-200 max-w-[260px]">
  <div className="flex items-center gap-1.5 flex-wrap">
    <span className="truncate max-w-[170px]">{c.ti}</span>
    {c.sCoverage?.urgent && <Flag type="OOS" />}
    {c.invAnomaly && <Flag type="INV" />}
    {c.moqInflated && <Flag type="MOQ" extraTip={`MOQ forces ${Math.round(c.moqInflationRatio * 100)}% of real need. Excess: ${R(c.excessFromMoq)} pcs / $${Math.round(c.excessCostFromMoq).toLocaleString()}`} />}
    {c.bundlesAffected > 0 && <span className="text-[10px] text-gray-500" title={`Driven by ${c.bundlesAffected} bundle(s).`}>({c.bundlesAffected}b)</span>}
  </div>
</td><td className="py-2 px-2 text-right">{D1(c.dsr)}</td><td className="py-2 px-2 text-right">{D1(c.d7)}</td><td className="py-2 px-2 text-center">{c.d7 > c.dsr ? <span className="text-emerald-400">▲</span> : c.d7 < c.dsr ? <span className="text-red-400">▼</span> : "—"}</td><td className={`py-2 px-2 text-right font-semibold ${dc(c.doc, c.critDays, c.warnDays)}`}>{R(c.doc)}</td><td className="py-2 px-2 text-right">{R(c.allIn)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{c.moq > 0 ? R(c.moq) : "—"}</td><td className="py-2 px-2 text-center">{c.seas && <span className="text-purple-400 text-xs font-bold">{c.seas.peak}</span>}</td><td className="py-2 px-1 border-l-2 border-blue-500/40" /><td className="py-2 px-2 text-right">{c.needQty > 0 ? (
        c.moqInflated ? (
          <span title={`Real need: ${R(c.needQty)} · MOQ forces: ${R(c.orderQty)}`}>
            <span className="text-gray-300">{R(c.needQty)}</span>
            <span className="text-orange-400 text-xs ml-1">→{R(c.orderQty)}</span>
          </span>
        ) : <span className="text-gray-300">{R(c.needQty)}</span>
      ) : "—"}</td><td className="py-2 px-2 text-right text-white font-semibold">{c.orderQty > 0 ? R(c.orderQty) : "—"}</td><td className="py-2 px-2 text-right text-amber-300">
  {c.needDollar > 0 ? $(c.needDollar) : "—"}
  {(() => {
    const bench = getCppBenchmark(c.id, vMap[c.ven]);
    if (!bench) return null;
    const cheaper = bench.pctDiff < 0;
    const sign = bench.pctDiff > 0 ? '+' : '';
    const tip = `Current CPP (${c.ven}): $${bench.currentCpp.toFixed(4)}/pc\nBenchmark (${bench.benchmarkLabel}): $${bench.benchmarkCpp.toFixed(4)}/pc\n${sign}${bench.pctDiff.toFixed(0)}% vs benchmark (total CPP, incl. inbound+tariffs)`;
    return <span className={`block text-[9px] font-normal ${cheaper ? "text-emerald-400" : "text-red-400"}`} title={tip}>{sign}{bench.pctDiff.toFixed(0)}%</span>;
  })()}
</td><td className={`py-2 px-2 text-right ${c.orderQty > 0 ? dc(c.docAfter, c.critDays, c.warnDays) : "text-gray-500"}`}>{c.orderQty > 0 ? R(c.docAfter) : "—"}</td><td className="py-2 px-2 flex gap-1"><button onClick={() => openBreakdown(c)} className={`text-xs px-1 rounded ${c.sProfile?.hasHistory ? "text-purple-400" : "text-gray-600"}`}>📊</button><button onClick={() => goCore(c.id)} className="text-blue-400 text-xs px-1.5 py-0.5 bg-blue-400/10 rounded">V</button></td></tr>)}</tbody>
      <tfoot><tr className="bg-gray-900 border-t-2 border-gray-700 text-sm font-semibold"><td colSpan={4} className="py-3 px-2 text-gray-300">{enr.length}</td><td className="py-3 px-2 text-right text-white">{D1(tot.d)}</td><td colSpan={3} /><td className="py-3 px-2 text-right text-white">{R(tot.a)}</td><td colSpan={2} /><td className="border-l-2 border-blue-500/40" /><td className="py-3 px-2 text-right">{R(tot.n)}</td><td className="py-3 px-2 text-right text-white">{R(tot.o)}</td><td className="py-3 px-2 text-right text-amber-300">{$(tot.co)}</td><td colSpan={2} /></tr></tfoot>
    </table></div>}

    {vm === "vendor" && vG.map(grp => {
      const v = grp.v; const tg = gTD(v, stg);
      const poI = getPOI(grp.cores, vendorSub !== "cores" ? grp.bundles : []);
      const poT = poI.reduce((s, i) => s + i.qty * i.cost, 0);
      const poC = poI.reduce((s, i) => s + (v.vou === 'Cases' && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : 0), 0);
      const effectiveVendorMoq = getMoqOv(v.name).dollarMoq || v.moqDollar || 0;
      const meets = effectiveVendorMoq > 0 ? poT >= effectiveVendorMoq : true;
      const anyCol = Object.values(collapsed).some(Boolean);
      const vendorPO = autoPO(v.code);
      const moqGap = effectiveVendorMoq - poT;
      const pf = purchFreqMap[v.name];
      const vRec = effectiveRecs[v.name];

      const bundlesInBundleMode = vRec?.bundleItems?.length || 0;
      const bundlesInCoreMode = (vRec?.bundleDetails || []).filter(bd => bd.buyMode === 'core' && bd.buyNeed > 0).length;

      // [v3.4] count bundles by regime (visible at vendor header)
      const regimeCounts = (vRec?.bundleDetails || []).reduce((acc, bd) => {
        const r = bd.regime || 'unknown';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {});

      const activeFlags = new Set();
      grp.cores.forEach(c => {
        if (c.sCoverage?.urgent) activeFlags.add('OOS');
        if (c.invAnomaly) activeFlags.add('INV');
        if (c.moqInflated) activeFlags.add('MOQ');
      });
      if (regimeCounts.intermittent > 0) activeFlags.add('INTERMITTENT');
      if (regimeCounts.new_or_sparse > 0) activeFlags.add('NEW');

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
            {(bundlesInBundleMode > 0 || bundlesInCoreMode > 0) && <span className="text-xs text-cyan-400" title="Based on 7f history: how many of this vendor's active bundles-with-need will be bought as raw core material vs as finished bundles">
              {bundlesInCoreMode + bundlesInBundleMode} bundle{(bundlesInCoreMode + bundlesInBundleMode) > 1 ? "s" : ""} need buy → {bundlesInCoreMode} via core, {bundlesInBundleMode} via bundle
            </span>}
            {(() => {
              const totalExcessMoq = grp.cores.filter(c => c.moqInflated).reduce((s, c) => s + c.excessCostFromMoq, 0);
              const countInflated = grp.cores.filter(c => c.moqInflated).length;
              if (totalExcessMoq === 0) return null;
              return <span className="text-xs text-orange-400" title="Sum of excess inventory $ forced by MOQ across cores in this vendor">
                MOQ excess: ${Math.round(totalExcessMoq).toLocaleString()} ({countInflated} cores)
              </span>;
            })()}
            {(() => {
  const delta = vendorDeltas[v.name];
  const hasDelta = delta && delta.significant;
  return (
    <span className="ml-auto flex items-center gap-2">
      {hasDelta && (
        <button
          onClick={() => setShowDeltaFor(v.name)}
          className={`text-xs font-semibold px-2 py-0.5 rounded border ${delta.pctChange > 0 ? "text-red-300 bg-red-500/10 border-red-500/30 hover:bg-red-500/20" : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"}`}
          title={`Click to see what changed vs ${delta.prevDate}`}
        >
          {delta.pctChange > 0 ? '+' : ''}{delta.pctChange.toFixed(0)}% vs {delta.prevDate.substring(5)}
        </button>
      )}
      {poI.length === 0
        ? <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">—</span>
        : <span className={`text-xs font-semibold px-2 py-0.5 rounded ${meets ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"}`}>{meets ? "✓" : "!"} {$(poT)}{poC > 0 ? " / " + poC + "cs" : ""}</span>
      }
    </span>
  );
})()}
          </div>
          {activeFlags.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-gray-800">
              <span className="text-[9px] uppercase text-gray-600 tracking-wider">Flags:</span>
              {[...activeFlags].map(f => <FlagLegendItem key={f} type={f} />)}
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1.5 mr-2">
              <span className="text-[10px] text-gray-500">MOQ$:</span>
              <input
                type="number"
                value={getMoqOv(v.name).dollarMoq || ''}
                onChange={e => setMoqOv(v.name, 'dollarMoq', +e.target.value)}
                placeholder={v.moqDollar > 0 ? String(v.moqDollar) : "0"}
                className="bg-gray-800 border border-gray-600 text-white rounded px-1.5 py-0.5 w-16 text-[10px] text-center"
              />
             <span className="text-[10px] text-gray-500">BdlMOQ:</span>
            <input
              type="number"
              value={getMoqOv(v.name).bundleMoq || ''}
              onChange={e => setMoqOv(v.name, 'bundleMoq', +e.target.value)}
              placeholder="0"
              className="bg-gray-800 border border-gray-600 text-white rounded px-1.5 py-0.5 w-14 text-[10px] text-center"
              title="Bundle MOQ: auto-applies after you stop typing"
            />
            {overrideRecs[v.name] && <button onClick={() => resetMoqOverride(v.name)} className="text-[10px] text-gray-400 hover:text-white" title="Reset MOQ overrides">↺</button>}
            {overrideRecs[v.name] && <span className="text-[10px] text-blue-400 font-medium" title="Bundle MOQ override active — recalculated bundles">Live ✓</span>}
              </div>
            <button onClick={() => fillR(grp.cores, grp.bundles, vendorSub, v.name)} className={`text-xs px-2.5 py-1 rounded ${data._coreInv?.length ? "bg-blue-600/80 text-white" : "bg-yellow-600 text-white animate-pulse"}`}>{data._coreInv?.length ? "Fill Rec" : "Fill Rec ⏳"}</button>
            {(() => {
  const effectiveMoq = getMoqOv(v.name).dollarMoq || v.moqDollar || 0;
  const effectiveGap = effectiveMoq - poT;
  const canFillMoq = effectiveMoq > 0 && poT < effectiveMoq && poI.length > 0;
  return (
    <button
      onClick={() => doFillMOQ(grp.cores, grp.bundles, effectiveMoq)}
      disabled={!canFillMoq}
      className={`text-xs px-2.5 py-1 rounded font-medium ${canFillMoq ? "bg-orange-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}
      title={effectiveMoq === 0 ? "Set a MOQ$ override above or configure vendor MOQ" : canFillMoq ? `Fill to reach $${effectiveMoq}` : "Already meets MOQ"}
    >
      Fill MOQ{effectiveGap > 0 && poI.length > 0 ? ` (+${$(effectiveGap)})` : ""}
    </button>
  );
})()}
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
          {vendorSub === "bundles" ? <>{grp.bundles.filter(b => nf !== "inorder" || hasBundleOrd(b)).map(b => <BundleRow key={b.j} b={b} />)}{grp.bundles.length === 0 && <tr><td colSpan={40} className="py-4 text-center text-gray-500">No bundles</td></tr>}</>
            : vendorSub === "mix" ? <>{grp.cores.map((c, ci) => {
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
              const orderedBs = nf === "inorder" ? cBs.filter(b => hasBundleOrd(b)) : cBs;
              if (nf === "inorder" && !hasCoreOrd(c) && orderedBs.length === 0) return null;
              const isLast = ci === grp.cores.length - 1;
              const showBundles = !dismissed[c.id] && orderedBs.length > 0;
              return <Fragment key={c.id}>
                <CoreRow c={c} isLastOfGroup={!showBundles && isLast === false} />
                {showBundles && orderedBs.map((b, bi) => <BundleRow key={b.j} b={b} isLastOfBundles={bi === orderedBs.length - 1 && !isLast} />)}
              </Fragment>;
            })}</>
            : <>{grp.cores.map((c, ci) => <CoreRow key={c.id} c={c} isLastOfGroup={ci < grp.cores.length - 1} />)}</>}
        </tbody></table></div>
      </div>;
    })}

    {vm === "vendor" && vG.length === 0 && <div className="text-center text-gray-500 py-12">No vendors match current filters.</div>}
  </div>;
}
