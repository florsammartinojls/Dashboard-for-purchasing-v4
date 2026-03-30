import React, { useState, useMemo, useCallback, useEffect } from "react";
import { api, apiPost } from "./lib/api";
import { R, D1, gS, fTs, gTD, isD, cAI, cNQ } from "./lib/utils";
import { Loader, Stg, QuickSum, SumCtx, SlidePanel, Dot, WorkflowChip, VendorNotes } from "./components/Shared";
import PurchTab from "./components/PurchTab";
import CoreTab from "./components/CoreTab";
import BundleTab from "./components/BundleTab";
import OrdersTab from "./components/OrdersTab";

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
  { term: "Critical", desc: "DOC ≤ Lead Time. Needs immediate action — you may run out before new stock arrives." },
  { term: "Warning", desc: "DOC ≤ Lead Time + Buffer Days. Monitor closely — tight but not yet critical." },
  { term: "Healthy", desc: "DOC > Lead Time + Buffer. Sufficient inventory." },
  { term: "Buffer Days", desc: "Extra safety margin days per core (set in source sheet). Default ~14 days." },
  { term: "⚡ Spike", desc: "7D DSR is 25%+ above composite DSR. Need calculation uses 7D DSR instead to cover the demand spike." },
  // === SEASONAL FORECASTING ===
  { term: "📊 Seasonal Breakdown", desc: "Click the 📊 button on any core row to see the full 5-step seasonal forecast: 1) Consumption during lead time, 2) Inventory at arrival, 3) Coverage window need, 4) Last-year shape × sustained growth, 5) Purchase frequency safety. Shows plain English summary + month-by-month projection tables." },
  { term: "Inv at Arrival (Step 1)", desc: "Projects how much inventory you'll have left when the order actually arrives. = Current inventory − Σ(projected consumption during lead time). If negative → ⚠ STOCKOUT before arrival. Example: 15,000 pcs today, DSR ~100/day, LT 120 days → consumed ~12,000-14,000 (seasonal) → arrival inventory ~1,000-3,000." },
  { term: "Coverage Window (Step 2)", desc: "After arrival: how much demand must your order cover? Projected demand from arrival date → arrival + target DOC, month by month using seasonal shape. The need = coverage demand − remaining inventory at arrival." },
  { term: "Last-Year Shape (Step 4)", desc: "The 'curve' of last year's sales, normalized. If June sold 2× the monthly average last year → shape factor = 2.0. Formula: projectedDSR(month) = currentDSR × shapeFactor × sustainedGrowthFactor × safetyMultiplier. This follows the pattern of last year but at today's sales level." },
  { term: "Sustained Growth Factor", desc: "Compares YTD total sales this year vs same period last year. If this year you've sold 30% more through March → factor = 1.30. This validates whether spikes are sustained or just seasonal. If total annual sales are flat but Q4 spiked → factor ~1.0, Q4 spike is seasonal only." },
  { term: "CV (Coefficient of Variation)", desc: "Measures how seasonal a product is. CV < 0.15 = flat. CV 0.15–0.35 = mild. CV > 0.35 = strong (e.g. Q4 products). Used to determine product type for shape weighting." },
  { term: "Purchase Frequency (Step 5)", desc: "Inferred from PO history: how many times/year do you order from this vendor? ≤2 orders/yr → Low frequency → safety ×1.10 (buy extra). 3-6/yr → Normal → ×1.05. >6/yr → High → ×1.0. Shows ⚠ comment when low frequency detected. Never recommends less than lead time coverage." },
  { term: "Fill Rec v2", desc: "Cores: Need = coverage window demand − inventory at arrival (5-step seasonal). Bundles (Mix/Bundle mode): ALSO uses seasonal projection from bundle sales history. AGL toggle changes bundle lead time to 80d. Order = max(Need, MOQ), rounded to case pack." },
  { term: "Fill to MOQ", desc: "When Fill Rec total < vendor MOQ$, distributes extra intelligently. Priority: 1) cores with peak season in coverage window, 2) cores with high sustained growth factor, 3) cores with lowest DOC ratio. Adds one case pack at a time to highest-scored core." },
  { term: "AGL Toggle", desc: "Per-vendor toggle in Bundles/Mix mode. When ON, bundles use 80-day lead time instead of the vendor's standard LT. Used when bundles ship direct via AGL (faster route)." },
  { term: "⚠ Unbundle Warning", desc: "When Fill Rec allocates bundles and the total order exceeds core need by +15 DOC or more, shows a warning. This happens when PPRC is imbalanced — one bundle has lots of PPRC (already covered) but others need stock, forcing you to over-order at core level. Consider: 1) rebalancing PPRC allocation, 2) sending some bundles direct (AGL), 3) accepting the stretch if it's temporary." },
  { term: "Fill Rec: Distribution", desc: "In Mix/Bundles mode, Fill Rec uses core seasonal need as the TOTAL reference. Distributes proportionally by %28d weight. For each bundle: gap = proportional demand − (FIB + PPRC + batched). If gap > 0 → order. If gap ≤ 0 → bundle is already covered (PPRC/FIB sufficient). Stretching a bit beyond core need is OK when PPRC is unevenly distributed." },
  // === EXISTING TERMS ===
  { term: "Fill Rec: Bundles", desc: "Need = (Target DOC × bundle DSR) − FIB Inventory. Order = Need (no MOQ on bundles)." },
  { term: "Fill Rec: Mix", desc: "1) For each bundle: Effective DOC = current DOC + (core inbound ÷ qty_per_bundle ÷ bundle DSR). 2) Need = (Target DOC − Effective DOC) × bundle DSR. 3) If need < vendor MOQ → don't order bundle, convert to core pieces instead. 4) Core order = own need + converted bundle pieces, rounded to case pack." },
  { term: "FIBDOC", desc: "FBA Inbound Days of Coverage." },
  { term: "PFIBDOC", desc: "Projected FIB DOC after restock." },
  { term: "+RS", desc: "Toggle Bundle detail columns: FIB Pcs, SC Inv, Reserved, Inbound, 7f Missing." },
  { term: "+$", desc: "Toggle cost columns: InbS, CogP, CogC." },
  { term: "FBA Pcs", desc: "Total FBA & Inbound Pieces for the core." },
  { term: "7f", desc: "Receiving Ledger (clipboard copy for spreadsheet)." },
  { term: "7g", desc: "COGS Ledger (clipboard copy for spreadsheet)." },
  { term: "7f Miss", desc: "Pieces Missing from 7f Receiving — inbound shipments not fully received." },
  { term: "B.FIB", desc: "Bundle FIB Inventory (sum of all active bundles for a core)." },
  { term: "B.SC", desc: "Bundle SC Inventory (sum of all active bundles for a core)." },
  { term: "B.Res", desc: "Bundle Reserved units (sum of all active bundles for a core)." },
  { term: "B.Inb", desc: "Bundle Inbound units (sum of all active bundles for a core)." },
  { term: "RFQ", desc: "Request for Quote — like PO but without pricing columns." },
  { term: "AICOGS", desc: "All-In Cost of Goods Sold." },
  { term: "InbS", desc: "Inbound Shipping cost." },
  { term: "CogP", desc: "Cost per Piece." },
  { term: "CogC", desc: "Cost per Case." },
  { term: "$", desc: "Toggle purchase history (last 4 orders) + receiving (7f) for a core." },
  { term: "%28d", desc: "Bundle % weight = units sold L28d for this bundle / total L28d units for all bundles of the same core." },
  { term: "FBA Health", desc: "From Aged Inventory sheet — Healthy, At Risk, or Unhealthy." },
  { term: "LTSF", desc: "Long-Term Storage Fee — charges for aged inventory at FBA." },
  { term: "KILL", desc: "ASIN flagged for discontinuation in Kill Management sheet." },
  { term: "ST", desc: "Sell-Through — ASIN in sell-through evaluation mode." },
  { term: "+/−", desc: "Expand or collapse detail columns per core row." },
  { term: "✕", desc: "Dismiss a core row (hide it temporarily while reviewing). 'Show All' brings them back." },
  { term: "7f Inbound", desc: "Pieces still in transit from 7f Receiving — used as 'Inbound' in bundle DOC calculations instead of the standard inbound field." },
  { term: "B.CasePack", desc: "Bundle case pack derived from 7f Receiving (pieces ÷ cases from most recent receiving entry)." },
  { term: "B.MOQ", desc: "Bundle MOQ per vendor (editable, only in Bundles/Mix view). When Fill Rec runs: if a bundle's need ≥ B.MOQ → order as bundle (rounded up to B.MOQ). If need < B.MOQ → skip bundle, convert to core pieces instead (need × qty_per_bundle)." },
  { term: "After DOC (Bundle)", desc: "Always shown. Base = (FIB Inv + 7f Inbound + PPRC) ÷ DSR + raw waterfall allocation + order qty. Uses 7f receiving data for inbound (pieces still in transit)." },
  { term: "After DOC (Core)", desc: "Core inventory after orders. = (All-In + Core Order + Mix Adj - Bundle Orders × qty_per_bundle) ÷ DSR. Subtracts bundle orders that consume core pieces." },
  { term: "Raw 20d Min", desc: "When Fill Rec recommends core, minimum order covers 20 days of DSR as raw material = DSR × 20." },
  { term: "Raw Waterfall", desc: "Core raw units are allocated across its bundles by priority: lowest effective DOC gets raw first until reaching Target DOC, then next bundle. When raw runs out, remaining bundles get nothing." },
  { term: "PO#", desc: "Auto-generated: PO-ExcelSerial-VendorCode. Override with manual entry." },
  { term: "💬 Vendor Notes", desc: "Click to view/add notes about a vendor. Categories: Communication, Lead Time, Pricing, Discount, Quality, Other. Notes are persistent and shared — visible to all users. Blue badge shows count." },
  { term: "Orders Tab", desc: "PO History from 7f Receiving. View by PO (newest first), by Vendor (highest spend first), or by Core/JLS. Click to expand and see line items. Search by PO#, vendor, or core/JLS#." },
  { term: "Quick Sum", desc: "Click numeric cells to select them. Sum & Avg appear in the bottom bar. Click ✕ to clear." },
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

// === MAIN APP ===
const TABS = [{ id: "purchasing", l: "Purchasing" }, { id: "core", l: "Core Detail" }, { id: "bundle", l: "Bundle Detail" }, { id: "orders", l: "Orders" }, { id: "vendors", l: "Vendors" }, { id: "glossary", l: "Glossary" }];

export default function App() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initCore = urlParams.get('core');
  const initBundle = urlParams.get('bundle');
  const initVendorParam = urlParams.get('vendor');
  const [tab, setTab] = useState(initCore ? "core" : initBundle ? "bundle" : "purchasing");
  const [showS, setShowS] = useState(false);
  const [stg, setStg] = useState({ buyer: '', domesticDoc: 90, intlDoc: 180, fA: "yes", fI: "blank", fV: "yes" });
  const [coreId, setCoreId] = useState(initCore || null);
  const [bundleId, setBundleId] = useState(initBundle || null);
  const [data, setData] = useState({ cores: [], bundles: [], vendors: [], sales: [], fees: [], inbound: [], abcA: [], abcT: [], abcSub: '', restock: [], priceComp: [], agedInv: [], killMgmt: [], workflow: [], receiving: [], replenRec: [], receivingFull: [], vendorComments: [] });
  const [hist, setHist] = useState({ bundleSales: [], coreInv: [], bundleInv: [], priceHist: [] });
  const [daily, setDaily] = useState({ coreDays: [], bundleDays: [] });
  const [ov, setOv] = useState({});
  const [initV, setInitV] = useState(initVendorParam || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ts, setTs] = useState("");
  const [rdy, setRdy] = useState({ h: false, d: false });
  const [prevTab, setPrevTab] = useState(null);
  const [panelCoreId, setPanelCoreId] = useState(null);
  const [panelBundleId, setPanelBundleId] = useState(null);
  const [sumCells, setSumCells] = useState([]);
  const addCell = useCallback((v, remove) => { if (remove) setSumCells(p => p.filter(x => x !== v)); else setSumCells(p => [...p, v]) }, []);
  const clearSum = useCallback(() => setSumCells([]), []);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api('live').then(d => {
      setData({ cores: d.cores || [], bundles: d.bundles || [], vendors: d.vendors || [], sales: d.sales || [], fees: d.fees || [], inbound: d.inbound || [], abcA: d.abcA || [], abcT: d.abcT || [], abcSub: d.abcSub || '', restock: d.restock || [], priceComp: d.priceComp || [], agedInv: d.agedInv || [], killMgmt: d.killMgmt || [], workflow: d.workflow || [], receiving: d.receiving || [], replenRec: d.replenRec || [], receivingFull: d.receivingFull || [], vendorComments: d.vendorComments || [] });
      setTs(d.timestamp || ""); setLoading(false);
      api('history').then(h => { setHist(h); setRdy(r => ({ ...r, h: true })) }).catch(() => setRdy(r => ({ ...r, h: true })));
      api('daily').then(d => { setDaily(d); setRdy(r => ({ ...r, d: true })) }).catch(() => setRdy(r => ({ ...r, d: true })));
    }).catch(e => { setError(e.message); setLoading(false) });
  }, []);
  useEffect(() => { load() }, [load]);

  // UPDATED: pass _coreInv, _coreDays, _bundleSales for seasonal forecasting v2
  const dataH = useMemo(() => ({ ...data, _coreInv: hist.coreInv, _coreDays: daily.coreDays, _bundleSales: hist.bundleSales }), [data, hist, daily]);

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

  const goCore = useCallback(id => { if (tab === "purchasing") { setPanelCoreId(id); setPanelBundleId(null) } else { setPrevTab(tab); setCoreId(id); setTab("core") } }, [tab]);
  const goBundle = useCallback(id => { if (tab === "purchasing" || panelCoreId) { setPanelBundleId(id) } else { setPrevTab(tab); setBundleId(id); setTab("bundle") } }, [tab, panelCoreId]);
  const goVendor = useCallback(n => { window.open(window.location.pathname + '?vendor=' + encodeURIComponent(n), '_blank') }, []);
  const clearIV = useCallback(() => setInitV(null), []);
  const handleBackFromCore = useCallback(() => setTab("purchasing"), []);
  const handleBackFromBundle = useCallback(() => { if (prevTab === "core" && coreId) setTab("core"); else setTab("purchasing") }, [prevTab, coreId]);

  const saveWorkflow = useCallback(async (note) => {
    try {
      await apiPost({ action: 'saveNote', ...note });
      setData(prev => { const wf = [...(prev.workflow || [])]; const idx = wf.findIndex(w => w.id === note.id); const entry = { id: note.id, type: note.type, status: note.status, note: note.note, ignoreUntil: note.ignoreUntil, lastOrder: note.lastOrder || '', updatedBy: note.updatedBy, updatedAt: new Date().toISOString() }; if (idx >= 0) wf[idx] = entry; else wf.push(entry); return { ...prev, workflow: wf } });
    } catch (e) { console.error('Workflow save error:', e) }
  }, []);
  const deleteWorkflow = useCallback(async ({ id }) => {
    try { await apiPost({ action: 'deleteNote', id }); setData(prev => ({ ...prev, workflow: (prev.workflow || []).filter(w => w.id !== id) })) } catch (e) { console.error('Workflow delete error:', e) }
  }, []);
  const saveVendorComment = useCallback(async (comment) => {
    try {
      await apiPost({ action: 'saveVendorComment', ...comment });
      setData(prev => ({ ...prev, vendorComments: [...(prev.vendorComments || []), { vendor: comment.vendor, date: new Date().toISOString().split('T')[0], author: comment.author, category: comment.category, comment: comment.comment }] }));
    } catch (e) { console.error('Vendor comment save error:', e) }
  }, []);

  if (loading) return <div className="min-h-screen bg-gray-950"><Loader text="Loading..." /></div>;
  if (error) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-center"><p className="text-red-400 mb-4">{error}</p><button onClick={load} className="bg-blue-600 text-white px-6 py-2 rounded-lg">Retry</button></div></div>;

  return <SumCtx.Provider value={{ addCell }}>
    <div className="min-h-screen bg-gray-950 text-gray-200">
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
      <nav className="bg-gray-900/50 border-b border-gray-800 px-4 sticky top-[53px] z-30">
        <div className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">{TABS.map(t => <button key={t.id} onClick={() => { setPrevTab(tab); setTab(t.id); if (t.id !== "core") setCoreId(null); if (t.id !== "bundle") setBundleId(null); clearSum() }} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>{t.l}</button>)}</div>
      </nav>
      <main className="max-w-7xl mx-auto">
        {tab === "purchasing" && <PurchTab data={dataH} stg={stg} goCore={goCore} goBundle={goBundle} goVendor={goVendor} ov={ov} setOv={setOv} initV={initV} clearIV={clearIV} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} saveVendorComment={saveVendorComment} />}
        {tab === "core" && <CoreTab data={data} stg={stg} hist={hist} daily={daily} coreId={coreId} onBack={handleBackFromCore} goBundle={goBundle} />}
        {tab === "bundle" && <BundleTab data={data} stg={stg} hist={hist} daily={daily} bundleId={bundleId} onBack={handleBackFromBundle} goCore={goCore} />}
        {tab === "orders" && <OrdersTab data={data} />}
        {tab === "vendors" && <VendorsTab data={data} stg={stg} goVendor={goVendor} workflow={data.workflow} saveWorkflow={saveWorkflow} deleteWorkflow={deleteWorkflow} vendorComments={data.vendorComments} saveVendorComment={saveVendorComment} />}
        {tab === "glossary" && <GlossTab />}
      </main>
      {showS && <Stg s={stg} setS={setStg} onClose={() => setShowS(false)} />}
      <SlidePanel open={!!(panelCoreId || panelBundleId)} onClose={() => { setPanelCoreId(null); setPanelBundleId(null) }}>
        {panelBundleId ? <BundleTab data={data} stg={stg} hist={hist} daily={daily} bundleId={panelBundleId} onBack={() => { setPanelBundleId(null); if (!panelCoreId) setPanelCoreId(null) }} goCore={id => { setPanelBundleId(null); setPanelCoreId(id) }} />
        : panelCoreId ? <CoreTab data={data} stg={stg} hist={hist} daily={daily} coreId={panelCoreId} onBack={() => setPanelCoreId(null)} goBundle={id => setPanelBundleId(id)} />
        : null}
      </SlidePanel>
      <QuickSum cells={sumCells} onClear={clearSum} />
    </div>
  </SumCtx.Provider>;
}
