import React, { useState, useMemo, useCallback, useEffect } from "react";
import { api, apiPost } from "./lib/api";
import { R, D1, gS, fTs } from "./lib/utils";
import { Loader, Stg, QuickSum, SumCtx, SlidePanel, Dot, WorkflowChip } from "./components/Shared";
import PurchTab from "./components/PurchTab";
import CoreTab from "./components/CoreTab";
import BundleTab from "./components/BundleTab";

// === Vendors Tab ===
function VendorsTab({ data, stg, goVendor, workflow, saveWorkflow, deleteWorkflow }) {
  const vMap = useMemo(() => { const m = {}; (data.vendors || []).forEach(v => m[v.name] = v); return m }, [data.vendors]);
  const vS = useMemo(() => {
    const g = {};
    (data.cores || []).filter(c => c.active === "Yes").forEach(c => {
      if (!g[c.ven]) g[c.ven] = { name: c.ven, cr: 0, wa: 0, he: 0, cores: 0, dsr: 0 };
      const v = vMap[c.ven] || {};
      const st = gS(c.doc, v.lt || 30, c.buf || 14, stg);
      g[c.ven][st === "critical" ? "cr" : st === "warning" ? "wa" : "he"]++;
      g[c.ven].cores++; g[c.ven].dsr += c.dsr;
    });
    return Object.values(g).sort((a, b) => b.cr - a.cr || b.wa - a.wa);
  }, [data.cores, vMap, stg]);
  return <div className="p-4 max-w-4xl mx-auto"><h2 className="text-xl font-bold text-white mb-4">Vendor Overview</h2><div className="space-y-1">{vS.map(v => <div key={v.name} className="flex items-center gap-2 px-4 py-3 rounded-lg bg-gray-900/50 hover:bg-gray-800"><button onClick={() => goVendor(v.name)} className="flex items-center gap-4 flex-1 text-left"><div className="flex gap-1 min-w-[80px]">{v.cr > 0 && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold">{v.cr}</span>}{v.wa > 0 && <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-semibold">{v.wa}</span>}<span className="text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">{v.he}</span></div><span className="text-white font-medium flex-1">{v.name}</span><span className="text-gray-500 text-xs">{v.cores} · DSR:{D1(v.dsr)}</span></button><div className="relative"><WorkflowChip id={v.name} type="vendor" workflow={workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer="" /></div></div>)}</div></div>;
}

// === Glossary Tab — editable ===
const DEFAULT_GL = [
  { term: "C.DSR", desc: "Composite Daily Sales Rate (1 decimal)." },
  { term: "DOC", desc: "Days of Coverage — how many days current inventory will last at current sales rate." },
  { term: "Critical", desc: "DOC ≤ Lead Time. Needs immediate action — you may run out before new stock arrives." },
  { term: "Warning", desc: "DOC ≤ Lead Time + Buffer Days. Monitor closely — tight but not yet critical." },
  { term: "Healthy", desc: "DOC > Lead Time + Buffer. Sufficient inventory." },
  { term: "Buffer Days", desc: "Extra safety margin days per core (set in source sheet). Default ~14 days." },
  { term: "⚡ Spike", desc: "7D DSR is 25%+ above composite DSR. Need calculation uses 7D DSR instead to cover the demand spike." },
  { term: "Fill Rec: Cores", desc: "Need = (Target DOC × effective DSR) − All-In Inventory. Order = max(Need, MOQ), rounded up to vendor case pack." },
  { term: "Fill Rec: Bundles", desc: "Need = (Target DOC × bundle DSR) − FIB Inventory. Order = Need (no MOQ on bundles)." },
  { term: "Fill Rec: Mix", desc: "1) For each bundle: Effective DOC = current DOC + (core inbound ÷ qty_per_bundle ÷ bundle DSR). 2) Need = (Target DOC − Effective DOC) × bundle DSR. 3) If need < vendor MOQ → don't order bundle, convert to core pieces instead. 4) Core order = own need + converted bundle pieces, rounded to case pack." },
  { term: "FIBDOC", desc: "FBA Inbound Days of Coverage." },
  { term: "PFIBDOC", desc: "Projected FIB DOC after restock." },
  { term: "7f", desc: "Receiving Ledger (clipboard copy for spreadsheet)." },
  { term: "7g", desc: "COGS Ledger (clipboard copy for spreadsheet)." },
  { term: "RFQ", desc: "Request for Quote — like PO but without pricing columns." },
  { term: "AICOGS", desc: "All-In Cost of Goods Sold." },
  { term: "InbS", desc: "Inbound Shipping cost." },
  { term: "CogP", desc: "Cost per Piece." },
  { term: "CogC", desc: "Cost per Case." },
  { term: "+RS", desc: "Toggle Restocker columns: FIB Pcs, Raw Pcs, Inbound Pcs, Case Pack, MOQ Pcs." },
  { term: "$", desc: "Toggle purchase history (last 4 orders) for a core." },
  { term: "%28d", desc: "Bundle % weight = units sold L28d for this bundle / total L28d units for all bundles of the same core." },
  { term: "FBA Health", desc: "From Aged Inventory sheet — Healthy, At Risk, or Unhealthy." },
  { term: "LTSF", desc: "Long-Term Storage Fee — charges for aged inventory at FBA." },
  { term: "KILL", desc: "ASIN flagged for discontinuation in Kill Management sheet." },
  { term: "ST", desc: "Sell-Through — ASIN in sell-through evaluation mode." },
  { term: "+/−", desc: "Expand or collapse detail columns per core row." },
  { term: "✕", desc: "Dismiss a core row (hide it temporarily while reviewing). 'Show All' brings them back." },
];

function GlossTab() {
  const [gl, setGl] = useState(() => {
    try { const s = localStorage.getItem('fba_glossary'); if (s) return JSON.parse(s) } catch { }
    return DEFAULT_GL;
  });
  const [editing, setEditing] = useState(null);
  const [nT, setNT] = useState(""); const [nD, setND] = useState("");
  const save = (arr) => { setGl(arr); try { localStorage.setItem('fba_glossary', JSON.stringify(arr)) } catch { } };
  const add = () => { if (nT.trim()) { save([...gl, { term: nT.trim(), desc: nD.trim() }]); setNT(""); setND("") } };
  const del = i => save(gl.filter((_, j) => j !== i));
  const upd = (i, field, val) => { const n = [...gl]; n[i] = { ...n[i], [field]: val }; save(n) };
  const reset = () => save(DEFAULT_GL);

  return <div className="p-4 max-w-4xl mx-auto">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold text-white">Glossary</h2>
      <button onClick={reset} className="text-xs text-gray-500 hover:text-white">Reset to defaults</button>
    </div>
    {gl.map((g, i) => <div key={i} className={`flex gap-4 py-3 px-4 rounded-lg ${i % 2 === 0 ? "bg-gray-900/50" : ""}`}>
      {editing === i ? <>
        <input value={g.term} onChange={e => upd(i, 'term', e.target.value)} className="bg-gray-800 text-blue-400 font-mono text-sm rounded px-2 py-1 w-28" />
        <input value={g.desc} onChange={e => upd(i, 'desc', e.target.value)} className="bg-gray-800 text-gray-300 text-sm rounded px-2 py-1 flex-1" />
        <button onClick={() => setEditing(null)} className="text-emerald-400 text-xs">✓</button>
      </> : <>
        <span className="text-blue-400 font-mono font-semibold text-sm min-w-[100px]">{g.term}</span>
        <span className="text-gray-300 text-sm flex-1">{g.desc}</span>
        <button onClick={() => setEditing(i)} className="text-gray-500 hover:text-white text-xs">✎</button>
        <button onClick={() => del(i)} className="text-gray-500 hover:text-red-400 text-xs">✕</button>
      </>}
    </div>)}
    <div className="flex gap-2 mt-4">
      <input value={nT} onChange={e => setNT(e.target.value)} placeholder="Term" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 w-28" />
      <input value={nD} onChange={e => setND(e.target.value)} placeholder="Description" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1.5 flex-1" />
      <button onClick={add} className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded">Add</button>
    </div>
  </div>;
}

// === MAIN APP ===
const TABS = [{ id: "purchasing", l: "Purchasing" }, { id: "core", l: "Core Detail" }, { id: "bundle", l: "Bundle Detail" }, { id: "vendors", l: "Vendors" }, { id: "glossary", l: "Glossary" }];

export default function App() {
  // Read URL params for deep linking (new tab support)
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initCore = urlParams.get('core');
  const initBundle = urlParams.get('bundle');
  const initVendorParam = urlParams.get('vendor');
  const [tab, setTab] = useState(initCore ? "core" : initBundle ? "bundle" : "purchasing");
  const [showS, setShowS] = useState(false);
  const [stg, setStg] = useState({ buyer: '', domesticDoc: 90, intlDoc: 180, fA: "yes", fI: "blank", fV: "yes" });
  const [coreId, setCoreId] = useState(initCore || null);
  const [bundleId, setBundleId] = useState(initBundle || null);
  const [data, setData] = useState({ cores: [], bundles: [], vendors: [], sales: [], fees: [], inbound: [], abcA: [], abcT: [], abcSub: '', restock: [], priceComp: [], agedInv: [], killMgmt: [], workflow: [] });
  const [hist, setHist] = useState({ bundleSales: [], coreInv: [], bundleInv: [], priceHist: [] });
  const [daily, setDaily] = useState({ coreDays: [], bundleDays: [] });
  const [ov, setOv] = useState({});
  const [initV, setInitV] = useState(initVendorParam || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ts, setTs] = useState("");
  const [rdy, setRdy] = useState({ h: false, d: false });
  const [prevTab, setPrevTab] = useState(null);
  // Slide panel for core/bundle detail from vendor view
  const [panelCoreId, setPanelCoreId] = useState(null);
  const [panelBundleId, setPanelBundleId] = useState(null);
  // Quick sum
  const [sumCells, setSumCells] = useState([]);
  const addCell = useCallback((v, remove) => { if (remove) setSumCells(p => p.filter(x => x !== v)); else setSumCells(p => [...p, v]) }, []);
  const clearSum = useCallback(() => setSumCells([]), []);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api('live').then(d => {
      setData({ cores: d.cores || [], bundles: d.bundles || [], vendors: d.vendors || [], sales: d.sales || [], fees: d.fees || [], inbound: d.inbound || [], abcA: d.abcA || [], abcT: d.abcT || [], abcSub: d.abcSub || '', restock: d.restock || [], priceComp: d.priceComp || [], agedInv: d.agedInv || [], killMgmt: d.killMgmt || [], workflow: d.workflow || [] });
      setTs(d.timestamp || ""); setLoading(false);
      api('history').then(h => { setHist(h); setRdy(r => ({ ...r, h: true })) }).catch(() => setRdy(r => ({ ...r, h: true })));
      api('daily').then(d => { setDaily(d); setRdy(r => ({ ...r, d: true })) }).catch(() => setRdy(r => ({ ...r, d: true })));
    }).catch(e => { setError(e.message); setLoading(false) });
  }, []);
  useEffect(() => { load() }, [load]);

  const dataH = useMemo(() => ({ ...data, _coreInv: hist.coreInv }), [data, hist]);
  const sc = useMemo(() => {
    const c = { critical: 0, warning: 0, healthy: 0 };
    (data.cores || []).forEach(x => { if (x.active !== "Yes") return; const v = (data.vendors || []).find(v => v.name === x.ven); c[gS(x.doc, v?.lt || 30, x.buf || 14, stg)]++ });
    return c;
  }, [data, stg]);

  // Navigation: goCore opens slide panel if in vendor view, otherwise switches tab
  const goCore = useCallback(id => {
    if (tab === "purchasing") { setPanelCoreId(id); setPanelBundleId(null) }
    else { setPrevTab(tab); setCoreId(id); setTab("core") }
  }, [tab]);
  const goBundle = useCallback(id => {
    if (tab === "purchasing" || panelCoreId) { setPanelBundleId(id) }
    else { setPrevTab(tab); setBundleId(id); setTab("bundle") }
  }, [tab, panelCoreId]);
  const goVendor = useCallback(n => {
    window.open(window.location.pathname + '?vendor=' + encodeURIComponent(n), '_blank');
  }, []);
  const clearIV = useCallback(() => setInitV(null), []);
  const handleBackFromCore = useCallback(() => setTab("purchasing"), []);
  const handleBackFromBundle = useCallback(() => { if (prevTab === "core" && coreId) setTab("core"); else setTab("purchasing") }, [prevTab, coreId]);

  // Workflow save/delete
  const saveWorkflow = useCallback(async (note) => {
    try {
      await apiPost({ action: 'saveNote', ...note });
      // Optimistic update
      setData(prev => {
        const wf = [...(prev.workflow || [])];
        const idx = wf.findIndex(w => w.id === note.id);
        const entry = { id: note.id, type: note.type, status: note.status, note: note.note, ignoreUntil: note.ignoreUntil, lastOrder: note.lastOrder || '', updatedBy: note.updatedBy, updatedAt: new Date().toISOString() };
        if (idx >= 0) wf[idx] = entry; else wf.push(entry);
        return { ...prev, workflow: wf };
      });
    } catch (e) { console.error('Workflow save error:', e) }
  }, []);
  const deleteWorkflow = useCallback(async ({ id }) => {
    try {
      await apiPost({ action: 'deleteNote', id });
      setData(prev => ({ ...prev, workflow: (prev.workflow || []).filter(w => w.id !== id) }));
    } catch (e) { console.error('Workflow delete error:', e) }
  }, []);

  if (loading) return <div className="min-h-screen bg-gray-950"><Loader text="Loading..." /></div>;
  if (error) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-center"><p className="text-red-400 mb-4">{error}</p><button onClick={load} className="bg-blue-600 text-white px-6 py-2 rounded-lg">Retry</button></div></div>;

  return <SumCtx.Provider value={{ addCell }}>
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* HEADER */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-white font-bold text-lg">FBA Dashboard <span className="text-xs text-blue-400">V2.5</span></h1>
            <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded font-medium">LIVE — {data.cores.length}</span>
            {stg.buyer && <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{stg.buyer}</span>}
            {fTs(ts) && <span className="text-xs text-gray-500">{fTs(ts)}</span>}
            {(!rdy.h || !rdy.d) && <span className="text-xs text-yellow-500 animate-pulse">Loading...</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{sc.critical}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{sc.warning}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{sc.healthy}</span>
            </div>
            <button onClick={load} className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800">↻</button>
            <button onClick={() => setShowS(true)} className="text-gray-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-gray-800">⚙️</button>
          </div>
        </div>
      </header>
      {/* NAV */}
      <nav className="bg-gray-900/50 border-b border-gray-800 px-4 sticky top-[53px] z-30">
        <div className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">{TABS.map(t => <button key={t.id} onClick={() => { setPrevTab(tab); setTab(t.id); if (t.id !== "core") setCoreId(null); if (t.id !== "bundle") setBundleId(null); clearSum() }} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>{t.l}</button>)}</div>
      </nav>
      {/* MAIN */}
      <main className="max-w-7xl mx-auto">
        {tab === "purchasing" && <PurchTab data={dataH} stg={stg} goCore={goCore} goBundle={goBundle} goVendor={goVendor} ov={ov} setOv={setOv} initV={initV} clearIV={clearIV} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} />}
        {tab === "core" && <CoreTab data={data} stg={stg} hist={hist} daily={daily} coreId={coreId} onBack={handleBackFromCore} goBundle={goBundle} />}
        {tab === "bundle" && <BundleTab data={data} stg={stg} hist={hist} daily={daily} bundleId={bundleId} onBack={handleBackFromBundle} goCore={goCore} />}
        {tab === "vendors" && <VendorsTab data={data} stg={stg} goVendor={goVendor} workflow={data.workflow} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} />}
        {tab === "glossary" && <GlossTab />}
      </main>
      {/* SETTINGS MODAL */}
      {showS && <Stg s={stg} setS={setStg} onClose={() => setShowS(false)} />}
      {/* CORE/BUNDLE DETAIL SLIDE PANEL (from vendor view) */}
      <SlidePanel open={!!(panelCoreId || panelBundleId)} onClose={() => { setPanelCoreId(null); setPanelBundleId(null) }}>
        {panelBundleId ? <BundleTab data={data} stg={stg} hist={hist} daily={daily} bundleId={panelBundleId} onBack={() => { setPanelBundleId(null); if (!panelCoreId) { setPanelCoreId(null) } }} goCore={id => { setPanelBundleId(null); setPanelCoreId(id) }} />
        : panelCoreId ? <CoreTab data={data} stg={stg} hist={hist} daily={daily} coreId={panelCoreId} onBack={() => setPanelCoreId(null)} goBundle={id => setPanelBundleId(id)} />
        : null}
      </SlidePanel>
      {/* QUICK SUM BAR */}
      <QuickSum cells={sumCells} onClear={clearSum} />
    </div>
  </SumCtx.Provider>;
}
