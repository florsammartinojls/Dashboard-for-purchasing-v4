// src/App.jsx
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { fetchLive, fetchHistory, refreshHistoryOnServer, fetchInfo, apiPost } from "./lib/api";
import { R, D1, gS, fTs, gTD, isD, cAI, cNQ } from "./lib/utils";
import { Loader, Stg, QuickSum, SumCtx, SlidePanel, Dot, WorkflowChip, VendorNotes } from "./components/Shared";
import DashboardSummary from "./components/DashboardSummary";
import PurchTab from "./components/PurchTab";
import CoreTab from "./components/CoreTab";
import BundleTab from "./components/BundleTab";
import OrdersTab from "./components/OrdersTab";
import PerformanceTab from "./components/PerformanceTab";
import { batchVendorRecommendations } from "./lib/recommender";
import { calcPurchaseFrequency } from "./lib/seasonal";

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
  { term: "C.DSR", desc: "Composite Daily Sales Rate (1 decimal)." },
  { term: "DOC", desc: "Days of Coverage — how many days current inventory will last at current sales rate." },
  { term: "Critical", desc: "DOC ≤ Lead Time. Needs immediate action." },
  { term: "Warning", desc: "DOC ≤ Lead Time + Buffer Days. Monitor closely." },
  { term: "Healthy", desc: "DOC > Lead Time + Buffer. Sufficient inventory." },
  { term: "Forecast Level", desc: "Holt-smoothed baseline DSR. Replaces raw DSR for calculations — more stable than a 7-day or 30-day average." },
  { term: "Trend", desc: "Holt-estimated change in DSR per day. Positive = demand rising." },
  { term: "σ_LT (sigma LT)", desc: "Standard deviation of demand during lead time. Measures volatility." },
  { term: "Z", desc: "Service-level multiplier. 95% = 1.65 (buffer 1.65 × σ_LT), 97% = 1.88, 99% = 2.33." },
  { term: "Safety Stock", desc: "Z × σ_LT. Statistical buffer that grows with volatility, shrinks when demand is stable." },
  { term: "Tracking Signal", desc: "Sum of forecast errors ÷ MAD. |TS| > 4 means forecast is biased — review." },
];

function GlossTab() {
  const [gl, setGl] = useState(() => { try { const s = localStorage.getItem('fba_glossary'); if (s) return JSON.parse(s) } catch { } return DEFAULT_GL });
  const [editing, setEditing] = useState(null);
  const [nT, setNT] = useState(""); const [nD, setND] = useState("");
  const save = (arr) => { setGl(arr); try { localStorage.setItem('fba_glossary', JSON.stringify(arr)) } catch { } };
  const add = () => { if (nT.trim()) { save([...gl, { term: nT.trim(), desc: nD.trim() }]); setNT(""); setND("") } };
  const del = i => save(gl.filter((_, j) => j !== i));
  const upd = (i, field, val) => { const n = [...gl]; n[i] = { ...n[i], [field]: val }; save(n) };
  const reset = () => save(DEFAULT_GL);
  return <div className="p-4 max-w-4xl mx-auto">
    <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold text-white">Glossary</h2><button onClick={reset} className="text-xs text-gray-500 hover:text-white">Reset to defaults</button></div>
    {gl.map((g, i) => <div key={i} className={`flex gap-4 py-3 px-4 rounded-lg ${i % 2 === 0 ? "bg-gray-900/50" : ""}`}>
      {editing === i ? <><input value={g.term} onChange={e => upd(i, 'term', e.target.value)} className="bg-gray-800 text-blue-400 font-mono text-sm rounded px-2 py-1 w-28" /><input value={g.desc} onChange={e => upd(i, 'desc', e.target.value)} className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 flex-1" /><button onClick={() => setEditing(null)} className="text-emerald-400 text-xs">✓</button></> : <><span className="text-blue-400 font-mono font-semibold text-sm min-w-[140px]">{g.term}</span><span className="text-gray-300 text-sm flex-1">{g.desc}</span><button onClick={() => setEditing(i)} className="text-gray-500 hover:text-white text-xs">✎</button><button onClick={() => del(i)} className="text-gray-500 hover:text-red-400 text-xs">✕</button></>}
    </div>)}
    <div className="flex gap-2 mt-4"><input value={nT} onChange={e => setNT(e.target.value)} placeholder="Term" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 w-28" /><input value={nD} onChange={e => setND(e.target.value)} placeholder="Description" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 flex-1" /><button onClick={add} className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded">Add</button></div>
  </div>;
}

const TABS = [
  { id: "dashboard", l: "Dashboard" },
  { id: "purchasing", l: "Purchasing" },
  { id: "core", l: "Core Detail" },
  { id: "bundle", l: "Bundle Detail" },
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
  bundleSales: [], priceHist: [], coreDays: [], bundleDays: []
};

// v3 defaults — service level, forecasting params, anomaly detection
const DEFAULT_SETTINGS = {
  buyer: '',
  domesticDoc: 90,
  intlDoc: 180,
  replenFloorDoc: 80,
  spikeThreshold: 1.25,
  moqInflationThreshold: 1.5,
  moqExtraDocThreshold: 30,
  fA: "yes", fI: "blank", fV: "yes",
  // v3 forecasting
  holtAlpha: 0.2,
  holtBeta: 0.1,
  hampelWindow: 7,
  hampelThreshold: 3,
  serviceLevelA: 97,
  serviceLevelOther: 95,
  inventoryAnomalyMultiplier: 3,
  anomalyLookbackDays: 7,
};

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initCore = urlParams.get('core');
  const initBundle = urlParams.get('bundle');
  const initVendorParam = urlParams.get('vendor');
  const initTab = urlParams.get('tab');

  const [tab, setTab] = useState(initCore ? "core" : initBundle ? "bundle" : initVendorParam ? "purchasing" : initTab || "dashboard");
  const [showS, setShowS] = useState(false);
  const [stg, setStg] = useState(DEFAULT_SETTINGS);
  const [coreId, setCoreId] = useState(initCore || null);
  const [bundleId, setBundleId] = useState(initBundle || null);

  const [data, setData] = useState(EMPTY_DATA);

  const [liveStatus, setLiveStatus] = useState({ loading: true, error: null, version: null });
  const [historyStatus, setHistoryStatus] = useState({ loading: true, error: null, version: null, fromCache: false });
  const [refreshingHistory, setRefreshingHistory] = useState(false);

  const [ov, setOv] = useState({});
  const [initV, setInitV] = useState(initVendorParam || null);
  const [prevTab, setPrevTab] = useState(null);
  const [panelCoreId, setPanelCoreId] = useState(null);
  const [panelBundleId, setPanelBundleId] = useState(null);
  const [sumCells, setSumCells] = useState([]);
  const addCell = useCallback((v, remove) => { if (remove) setSumCells(p => p.filter(x => x !== v)); else setSumCells(p => [...p, v]) }, []);
  const clearSum = useCallback(() => setSumCells([]), []);

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
    try {
      const history = await fetchHistory({ forceRefresh });
      setData(prev => ({
        ...prev,
        receivingFull: history.receivingFull || [],
        priceCompFull: history.priceCompFull || [],
        bundleSales: history.bundleSales || [],
        priceHist: history.priceHist || [],
        coreInv: history.coreInv || [],
        bundleInv: history.bundleInv || []
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

  const vendorRecs = useMemo(() => {
    if (!data.vendors?.length) return {};
    return batchVendorRecommendations({
      vendors: data.vendors,
      cores: data.cores || [],
      bundles: data.bundles || [],
      bundleSales: data.bundleSales || [],
      bundleDays: data.bundleDays || [],
      coreDays: data.coreDays || [],
      abcA: data.abcA || [],
      receivingFull: data.receivingFull || [],
      replenMap,
      missingMap,
      priceCompFull: (data.priceCompFull?.length ? data.priceCompFull : data.priceComp) || [],
      settings: stg,
      purchFreqMap,
    });
  }, [data.vendors, data.cores, data.bundles, data.bundleSales, data.bundleDays, data.coreDays, data.abcA, data.receivingFull, data.priceCompFull, data.priceComp, replenMap, missingMap, stg, purchFreqMap]);

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

  const goCore = useCallback(id => { if (tab === "purchasing") { setPanelCoreId(id); setPanelBundleId(null); clearSum() } else { setPrevTab(tab); setCoreId(id); setTab("core"); clearSum() } }, [tab]);
  const goBundle = useCallback(id => { if (tab === "purchasing" || panelCoreId) { setPanelBundleId(id); clearSum() } else { setPrevTab(tab); setBundleId(id); setTab("bundle"); clearSum() } }, [tab, panelCoreId]);
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

  return <SumCtx.Provider value={{ addCell }}>
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
          <div className="max-w-7xl mx-auto mt-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300">
            ⏳ Loading history data in background... Seasonal calculations will be available shortly.
          </div>
        )}
      </header>

      <nav className="bg-gray-900/50 border-b border-gray-800 px-4 sticky top-[53px] z-30">
        <div className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">{TABS.map(t => <button key={t.id} onClick={(e) => { if (e.ctrlKey || e.metaKey) { window.open(window.location.pathname + '?tab=' + t.id, '_blank'); return; } setPrevTab(tab); setTab(t.id); if (t.id !== "core") setCoreId(null); if (t.id !== "bundle") setBundleId(null); clearSum() }} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>{t.l}</button>)}</div>
      </nav>

      <main className="max-w-7xl mx-auto">
       {tab === "dashboard" && <DashboardSummary data={dataH} stg={stg} vendorRecs={vendorRecs} goVendor={goVendor} workflow={data.workflow} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} vendorComments={data.vendorComments} saveVendorComment={saveVendorComment} onEnterPurchasing={() => setTab("purchasing")} activeBundleCores={activeBundleCores} />}
        {tab === "purchasing" && <PurchTab data={dataH} stg={stg} vendorRecs={vendorRecs} goCore={goCore} goBundle={goBundle} goVendor={goVendor} ov={ov} setOv={setOv} initV={initV} clearIV={clearIV} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} saveVendorComment={saveVendorComment} activeBundleCores={activeBundleCores} />}
        {tab === "core" && <CoreTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} coreId={coreId} onBack={handleBackFromCore} goBundle={goBundle} />}
        {tab === "bundle" && <BundleTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, bundleInv: data.bundleInv, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} bundleId={bundleId} onBack={handleBackFromBundle} goCore={goCore} />}
        {tab === "orders" && <OrdersTab data={data} />}
        {tab === "vendors" && <VendorsTab data={data} stg={stg} goVendor={goVendor} workflow={data.workflow} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} vendorComments={data.vendorComments} saveVendorComment={saveVendorComment} />}
        {tab === "performance" && <PerformanceTab />}
        {tab === "glossary" && <GlossTab />}
      </main>

      {showS && <Stg s={stg} setS={setStg} onClose={() => setShowS(false)} />}
      <SlidePanel open={!!(panelCoreId || panelBundleId)} onClose={() => { setPanelCoreId(null); setPanelBundleId(null); clearSum() }}>
        {panelBundleId ? <BundleTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, bundleInv: data.bundleInv, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} bundleId={panelBundleId} onBack={() => { setPanelBundleId(null); if (!panelCoreId) setPanelCoreId(null) }} goCore={id => { setPanelBundleId(null); setPanelCoreId(id) }} />
        : panelCoreId ? <CoreTab data={data} stg={stg} hist={{ coreInv: data.coreInv, bundleSales: data.bundleSales, priceHist: data.priceHist }} daily={{ coreDays: data.coreDays, bundleDays: data.bundleDays }} coreId={panelCoreId} onBack={() => setPanelCoreId(null)} goBundle={id => setPanelBundleId(id)} />
        : null}
      </SlidePanel>
      <QuickSum cells={sumCells} onClear={clearSum} />
    </div>
  </SumCtx.Provider>;
}
