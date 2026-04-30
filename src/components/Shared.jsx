// src/components/Shared.jsx
import { createPortal } from "react-dom";
import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { dotCls, MN } from "../lib/utils";

export const SumCtx = createContext({ addCell: () => {} });

export function Dot({ status }) { return <span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${dotCls(status)}`} /> }
export function Loader({ text }) { return <div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-gray-400 text-sm">{text}</p></div></div> }
export function Toast({ msg, onClose, persist }) { useEffect(() => { if (persist) return; const t = setTimeout(onClose, 2500); return () => clearTimeout(t) }, [onClose, persist]); return <div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-3">{msg}<button onClick={onClose} className="text-white/70 hover:text-white text-lg ml-2">✕</button></div> }
export function CopyableId({ value, className, prefix }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const handleCopy = (e) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span
      onClick={handleCopy}
      title={copied ? "¡Copiado!" : `Click para copiar ${value}`}
      className={`cursor-pointer hover:bg-blue-500/20 rounded px-1 transition-colors select-none ${copied ? "bg-emerald-500/30" : ""} ${className || ""}`}
    >
      {prefix}{value}{copied && <span className="ml-1 text-[9px] text-emerald-400">✓</span>}
    </span>
  );
}
export function getEffectiveWfStatus(workflow, id) {
  const wf = (workflow || []).find(w => w.id === id);
  if (!wf || !wf.status) return "";
  if (!wf.ignoreUntil) return wf.status;
  const d = new Date(wf.ignoreUntil + 'T00:00:00');
  if (!isNaN(d.getTime()) && d < new Date(new Date().toDateString())) return "";
  return wf.status;
}
export function NumInput({ value, onChange, placeholder, className }) {
  const [local, setLocal] = useState(value || '');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused) setLocal(value || '') }, [value, focused]);
  const fmt = v => { if (!v && v !== 0) return ''; const n = parseFloat(String(v).replace(/,/g, '')); if (isNaN(n) || n === 0) return ''; return n.toLocaleString('en-US') };
  const fmtLive = v => { const clean = String(v).replace(/[^0-9.]/g, ''); if (!clean) return ''; const parts = clean.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return parts.join('.') };
  return <input ref={ref} type="text" inputMode="decimal" value={focused ? fmtLive(local) : fmt(value)} onFocus={() => { setFocused(true); setLocal(value || '') }} onChange={e => { const raw = e.target.value.replace(/[^0-9.,]/g, ''); setLocal(raw.replace(/,/g, '')) }} onBlur={() => { setFocused(false); onChange(Math.max(0, parseFloat(local) || 0)) }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} placeholder={placeholder || "0"} className={className || "bg-gray-800 border border-gray-600 text-white rounded px-1.5 py-1 w-16 text-center text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"} />;
}

export function TH({ children, tip, className }) { return <th className={className} title={tip}>{children}</th> }

export function NC({ v, fmt, className }) {
  const { addCell } = useContext(SumCtx); const [sel, setSel] = useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v); const valid = !isNaN(raw) && raw !== 0;
  const toggle = () => { if (!valid) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${valid ? "cursor-pointer select-none" : ""}`} onClick={toggle}>{fmt ? fmt(v) : v}</td>;
}

export function QuickSum({ cells, onClear }) {
  if (!cells.length) return null;
  const sum = cells.reduce((a, b) => a + b, 0); const avg = sum / cells.length;
  return <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-lg px-5 py-2.5 shadow-xl z-50 flex items-center gap-5 text-sm">
    <span className="text-gray-400">Selected: <span className="text-white font-semibold">{cells.length}</span></span>
    <span className="text-gray-400">Sum: <span className="text-emerald-400 font-semibold">{sum.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
    <span className="text-gray-400">Avg: <span className="text-blue-400 font-semibold">{avg.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
    <button onClick={onClear} className="text-gray-500 hover:text-white text-xs ml-2">✕</button>
  </div>;
}

export function SS({ value, onChange, options, placeholder }) {
  const [o, setO] = useState(false); const [q, setQ] = useState(""); const ref = useRef(null);
  useEffect(() => { function h(e) { if (ref.current && !ref.current.contains(e.target)) setO(false) } document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h) }, []);
  const f = options.filter(x => x.toLowerCase().includes(q.toLowerCase()));
  return <div ref={ref} className="relative">
    <input type="text" value={o ? q : (value || "")} placeholder={placeholder || "All Vendors"} onFocus={() => { setO(true); setQ("") }} onChange={e => { setQ(e.target.value); setO(true) }} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5 w-48" />
    {o && <div className="absolute z-40 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-80 overflow-auto w-56">
      <button onClick={() => { onChange(""); setO(false) }} className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700">All</button>
      {f.map(x => <button key={x} onClick={() => { onChange(x); setO(false); setQ("") }} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 ${x === value ? "text-blue-400" : "text-gray-300"}`}>{x}</button>)}
    </div>}
  </div>;
}

export function Stg({ s, setS, onClose }) {
  const [l, setL] = useState({ ...s });
  return <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}>
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
      <div className="space-y-4">
        <div><label className="text-sm text-gray-400 block mb-1">Buyer Initials</label><input type="text" value={l.buyer || ''} onChange={e => setL({ ...l, buyer: e.target.value })} placeholder="e.g. FS" className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-sm text-gray-400 block mb-1">Domestic DOC</label><input type="number" value={l.domesticDoc} onChange={e => setL({ ...l, domesticDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
          <div><label className="text-sm text-gray-400 block mb-1">Intl DOC</label><input type="number" value={l.intlDoc} onChange={e => setL({ ...l, intlDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
          <div><label className="text-sm text-gray-400 block mb-1" title="Floor DOC for replen waterfall (Phase 1 minimum)">Replen Floor</label><input type="number" value={l.replenFloorDoc || 80} onChange={e => setL({ ...l, replenFloorDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
        </div>

        {/* ─── v3 FORECASTING ENGINE ─── */}
        <div className="border-t border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-emerald-400 mb-1">v3 Forecasting Engine</h3>
          <p className="text-[10px] text-gray-500 mb-3">Industry-standard: Hampel filter → Holt linear → Z × σ_LT safety stock.</p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Service level for ABC-class A bundles (top revenue/profit). Higher = less chance of stockout but more capital tied up. Default 97% (Z=1.88).">
                Service Level — A bundles
              </label>
              <div className="flex gap-2">
                <input type="number" step="0.5" min="85" max="99.9" value={l.serviceLevelA ?? 97} onChange={e => setL({ ...l, serviceLevelA: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
                <span className="text-gray-500 text-xs self-center">%</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Default 97% · Z≈1.88</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Service level for all non-A bundles (B, C, unclassified). Default 95% (Z=1.65).">
                Service Level — B/C/other
              </label>
              <div className="flex gap-2">
                <input type="number" step="0.5" min="85" max="99.9" value={l.serviceLevelOther ?? 95} onChange={e => setL({ ...l, serviceLevelOther: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
                <span className="text-gray-500 text-xs self-center">%</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Default 95% · Z≈1.65</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Holt α: how quickly the level adapts to new data. 0 = never changes (trusts history). 1 = ignores history (jumpy). Default 0.2 — conservative, industry-standard for daily sales.">
                Holt α (level)
              </label>
              <input type="number" step="0.05" min="0.05" max="0.9" value={l.holtAlpha ?? 0.2} onChange={e => setL({ ...l, holtAlpha: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 0.2 · lower = smoother</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Holt β: how quickly the trend adapts. Lower = more stable trend. Default 0.1.">
                Holt β (trend)
              </label>
              <input type="number" step="0.05" min="0.05" max="0.9" value={l.holtBeta ?? 0.1} onChange={e => setL({ ...l, holtBeta: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 0.1 · lower = smoother trend</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Hampel filter window (days to each side). Detects outliers by comparing each day to its neighbors. Default 7 (14-day total window).">
                Hampel Window (±days)
              </label>
              <input type="number" step="1" min="3" max="14" value={l.hampelWindow ?? 7} onChange={e => setL({ ...l, hampelWindow: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 7 · wider = fewer outliers caught</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Hampel threshold in MAD units. 3 is standard. Lower = aggressive outlier removal.">
                Hampel Threshold (×MAD)
              </label>
              <input type="number" step="0.5" min="1" max="6" value={l.hampelThreshold ?? 3} onChange={e => setL({ ...l, hampelThreshold: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 3 · lower = stricter</p>
            </div>
          </div>
        </div>

        {/* ─── v3 ANOMALY DETECTION ─── */}
        <div className="border-t border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-orange-400 mb-1">Inventory Anomaly Detection</h3>
          <p className="text-[10px] text-gray-500 mb-3">Flags cores with unexplained inventory drops and uses a reconstructed value for recommendations.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Drop is flagged when |today - expected| > multiplier × DSR. Default 3 (anything larger than 3 days of sales counts as anomaly).">
                Anomaly Multiplier (× DSR)
              </label>
              <input type="number" step="0.5" min="1" max="10" value={l.inventoryAnomalyMultiplier ?? 3} onChange={e => setL({ ...l, inventoryAnomalyMultiplier: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 3 · lower = more sensitive</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="How many days back to scan for anomalies. Default 7.">
                Lookback (days)
              </label>
              <input type="number" step="1" min="2" max="30" value={l.anomalyLookbackDays ?? 7} onChange={e => setL({ ...l, anomalyLookbackDays: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 7</p>
            </div>
          </div>
        </div>

        {/* ─── BRIDGE TAB (NEW) ─── */}
        <div className="border-t border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-cyan-400 mb-1">Bridge Tab</h3>
          <p className="text-[10px] text-gray-500 mb-3">Settings for the USA bridge analysis tab. Used only in BridgeTab; does not affect v3 recommender.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Days from China warehouse arrival to FBA-live (processing + shipping to Amazon). Default 25.">
                Pipeline Days
              </label>
              <input type="number" step="1" min="0" max="90" value={l.pipeline_days ?? 25} onChange={e => setL({ ...l, pipeline_days: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 25 · processing + shipping to Amazon</p>
            </div>
          </div>
        </div>

        {/* ─── LEGACY / UI TUNABLES ─── */}
        <div className="border-t border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-amber-400 mb-3">UI & MOQ Tunables</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="d7/cd ratio above which the ⚡ spike badge is shown. UI-only — no longer affects forecast calculations.">
                Spike Badge Threshold
              </label>
              <input type="number" step="0.05" min="1" value={l.spikeThreshold ?? 1.25} onChange={e => setL({ ...l, spikeThreshold: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 1.25 · visual only in v3</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="finalQty/need ratio at or above which the ⚠MOQ badge fires. Default 1.5.">
                MOQ Inflation Warn
              </label>
              <input type="number" step="0.1" min="1" value={l.moqInflationThreshold ?? 1.5} onChange={e => setL({ ...l, moqInflationThreshold: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 1.5 · ≥ triggers ⚠MOQ</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="When Bundle MOQ forces more than needed, max extra DOC days before suggesting 'wait'. Default 30.">
                MOQ Extra DOC Threshold
              </label>
              <input type="number" step="5" min="0" value={l.moqExtraDocThreshold ?? 30} onChange={e => setL({ ...l, moqExtraDocThreshold: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 30</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4"><h3 className="text-sm font-semibold text-blue-400 mb-3">Core Filters</h3><div className="space-y-3">
          {[["Active", "fA"], ["Visible", "fV"]].map(([lb, k]) => <div key={k} className="flex items-center justify-between"><span className="text-sm text-gray-300">{lb}</span><select value={l[k]} onChange={e => setL({ ...l, [k]: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="yes">Yes</option><option value="no">No</option><option value="all">All</option></select></div>)}
          <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Ignored</span><select value={l.fI} onChange={e => setL({ ...l, fI: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="blank">Blank</option><option value="set">Set</option><option value="all">All</option></select></div>
        </div></div>
        <div className="border-t border-gray-700 pt-4"><h3 className="text-sm font-semibold text-indigo-400 mb-3">Bundle Filters</h3><div className="space-y-3">
          <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Active</span><select value={l.bA || 'yes'} onChange={e => setL({ ...l, bA: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="yes">Yes</option><option value="no">No</option><option value="all">All</option></select></div>
          <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Ignored</span><select value={l.bI || 'blank'} onChange={e => setL({ ...l, bI: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="blank">Blank</option><option value="set">Set</option><option value="all">All</option></select></div>
        </div></div>
      </div>
      <div className="flex gap-3 mt-6"><button onClick={() => { setS(l); onClose() }} className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium">Save</button><button onClick={onClose} className="flex-1 bg-gray-700 text-white rounded-lg py-2 font-medium">Cancel</button></div>
    </div>
  </div>;
}

export function AbcBadge({ grade }) { if (!grade) return null; const cls = grade === "A" ? "bg-emerald-500/20 text-emerald-400" : grade === "B" ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400"; return <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${cls}`}>{grade}</span> }
export function HealthBadge({ health, ltsf }) { if (!health) return null; const cls = health === "Healthy" ? "text-emerald-400" : health === "At Risk" ? "text-amber-400" : "text-red-400"; return <span className="flex items-center gap-1"><span className={`text-xs font-semibold ${cls}`}>{health}</span>{ltsf > 0 && <span className="text-xs text-red-300">${ltsf.toFixed(2)}</span>}</span> }
export function KillBadge({ eval: ev }) { if (!ev) return null; const isK = ev.toLowerCase().includes('kill'); const isS = ev.toLowerCase().includes('sell'); if (!isK && !isS) return null; return <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${isK ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{isK ? "KILL" : "SELLTHROUGH"}</span> }

export function SlidePanel({ open, onClose, children }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex"><div className="absolute inset-0 bg-black/50" onClick={onClose} /><div className="relative ml-auto w-full max-w-4xl bg-gray-950 border-l border-gray-800 overflow-y-auto shadow-2xl"><button onClick={onClose} className="sticky top-4 right-4 float-right z-10 text-gray-400 hover:text-white text-xl bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center mr-4 mt-4">✕</button>{children}</div></div>;
}

const WF_STATUSES = ["Buy", "Reviewing", "Ignore", "Done", ""];
const WF_COLORS = { Buy: "bg-emerald-500/20 text-emerald-400", Reviewing: "bg-amber-500/20 text-amber-400", Ignore: "bg-red-500/20 text-red-400", Done: "bg-blue-500/20 text-blue-400" };
const VC_CATS = ["Quality","Pricing","Lead Time","Reliability","Relationship","Other"];
const VC_COLORS = { Quality: "text-orange-400", Pricing: "text-amber-400", "Lead Time": "text-blue-400", Reliability: "text-red-400", Relationship: "text-emerald-400", Other: "text-gray-400" };

function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  const parts = s.split('/');
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if (a > 12) return new Date(c, b - 1, a);
    return new Date(c, a - 1, b);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDateUS(s) {
  const d = parseDate(s);
  if (!d) return s || "";
  return (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0') + '/' + d.getFullYear();
}

export function WorkflowChip({ id, type, workflow, onSave, onDelete, buyer, country }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const existing = (workflow || []).find(w => w.id === id);
  const [status, setStatus] = useState(existing?.status || "");
  const [note, setNote] = useState(existing?.note || "");
  const [ignoreUntil, setIgnoreUntil] = useState(existing?.ignoreUntil || "");
  const [days, setDays] = useState('');

  useEffect(() => {
    const ex = (workflow || []).find(w => w.id === id);
    if (ex) {
      setStatus(ex.status || "");
      setNote(ex.note || "");
      setIgnoreUntil(ex.ignoreUntil || "");
      if (ex.ignoreUntil) {
        const d = new Date(ex.ignoreUntil + 'T00:00:00');
        const diff = Math.ceil((d - new Date()) / 86400000);
        setDays(diff > 0 ? String(diff) : '0');
      } else {
        setDays('');
      }
    }
  }, [workflow, id]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const openMenu = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuW = 260;
      const menuH = 240;
      let left = rect.left;
      if (left + menuW > window.innerWidth - 10) left = window.innerWidth - menuW - 10;
      if (left < 10) left = 10;
      let top = rect.bottom + 4;
      if (top + menuH > window.innerHeight - 10) top = Math.max(10, rect.top - menuH - 4);
      setPos({ top, left });
    }
    setOpen(true);
  };

  const getDefaultDays = () => {
    const isDom = ['us','usa','united states',''].includes((country || '').toLowerCase().trim());
    return isDom ? 1 : 5;
  };
  const daysToDate = (d) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + parseInt(d));
    return dt.toISOString().split('T')[0];
  };
  const pickStatus = (s) => {
    setStatus(s);
    if (!days) {
      const def = getDefaultDays();
      setDays(String(def));
      setIgnoreUntil(daysToDate(def));
    }
  };
  const save = () => { onSave({ id, type, status, note, ignoreUntil, updatedBy: buyer || "" }); setOpen(false); };
  const del = () => { onDelete({ id }); setOpen(false); setStatus(""); setNote(""); setIgnoreUntil(""); };

  const effStatus = (() => {
    if (!existing?.status) return "";
    if (!existing.ignoreUntil) return existing.status;
    const d = parseDate(existing.ignoreUntil);
    if (d && d < new Date(new Date().toDateString())) return "";
    return existing.status;
  })();

  const button = (
    <button ref={btnRef} onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openMenu(); }} className={`text-xs px-1.5 py-0.5 rounded ${effStatus ? WF_COLORS[effStatus] || "bg-gray-700 text-gray-300" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}>
      {effStatus ? <>{effStatus}{existing.ignoreUntil && parseDate(existing.ignoreUntil) >= new Date(new Date().toDateString()) ? " · " + fmtDateUS(existing.ignoreUntil) : ""}{existing.note ? " · " + existing.note.substring(0, 15) + (existing.note.length > 15 ? "…" : "") : ""}</> : "📝"}
    </button>
  );

  if (!open) return button;

  const menu = (
    <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }} className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-3 w-64" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-semibold">{id}</span>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white text-sm">✕</button>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Status</label>
          <div className="flex gap-1 flex-wrap">
            {WF_STATUSES.filter(Boolean).map(s =>
              <button key={s} onClick={() => pickStatus(s)} className={`text-xs px-2 py-1 rounded ${status === s ? WF_COLORS[s] : "bg-gray-800 text-gray-400"}`}>{s}</button>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Note</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} placeholder="e.g. Negotiating price..." className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 w-full text-xs" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Ignore for (days)</label>
          <div className="flex gap-2 items-center">
            <input type="number" value={days} onChange={e => { const v = e.target.value; setDays(v); if (parseInt(v) > 0) setIgnoreUntil(daysToDate(v)); }} onKeyDown={e => { if (e.key === 'Enter') save(); }} placeholder={String(getDefaultDays())} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 w-16 text-xs text-center" />
            {ignoreUntil && <span className="text-gray-500 text-[10px]">→ {ignoreUntil.includes('-') ? ignoreUntil.split('-')[1] + '/' + ignoreUntil.split('-')[2] + '/' + ignoreUntil.split('-')[0] : ignoreUntil}</span>}
          </div>
        </div>
        <div className="flex gap-2 pt-2 border-t border-gray-700">
          <button onClick={save} className="flex-1 bg-emerald-600 text-white rounded py-1 text-xs font-medium">Save</button>
          {existing && <button onClick={del} className="bg-red-600/30 text-red-300 rounded px-2 py-1 text-xs">Delete</button>}
        </div>
      </div>
    </div>
  );

  return <>{button}{createPortal(menu, document.body)}</>;
}

export function VendorNotes({ vendor, comments, onSave, buyer }) {
  const [open, setOpen] = useState(false); const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState("Other"); const [text, setText] = useState("");
  const notes = (comments || []).filter(c => c.vendor === vendor).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const count = notes.length;
  const save = () => { if (!text.trim()) return; onSave({ vendor, author: buyer || "", category: cat, comment: text.trim() }); setText(""); setAdding(false) };
  if (!open) return <button onClick={() => setOpen(true)} className={`text-xs px-1.5 py-0.5 rounded ${count > 0 ? "bg-blue-500/20 text-blue-400" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}>💬{count > 0 ? " " + count : ""}</button>;
  return <div className="absolute z-50 mt-1 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-80 max-h-96 overflow-hidden" onClick={e => e.stopPropagation()}>
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700"><span className="text-white text-sm font-semibold">Notes — {vendor}</span><div className="flex gap-2"><button onClick={() => setAdding(!adding)} className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">+ Add</button><button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white text-xs">✕</button></div></div>
    {adding && <div className="px-3 py-2 border-b border-gray-700 space-y-2"><div className="flex gap-1 flex-wrap">{VC_CATS.map(c => <button key={c} onClick={() => setCat(c)} className={`text-[10px] px-1.5 py-0.5 rounded ${cat === c ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>{c}</button>)}</div><textarea value={text} onChange={e => setText(e.target.value)} placeholder="Add a note..." rows={2} className="w-full bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs resize-none" /><div className="flex gap-2"><button onClick={save} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded">Save</button><button onClick={() => { setAdding(false); setText("") }} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">Cancel</button></div></div>}
    <div className="overflow-y-auto max-h-60">{notes.length > 0 ? notes.map((n, i) => <div key={i} className={`px-3 py-2 ${i > 0 ? "border-t border-gray-800/50" : ""}`}><div className="flex items-center gap-2 mb-0.5"><span className={`text-[10px] font-semibold ${VC_COLORS[n.category] || "text-gray-400"}`}>{n.category}</span><span className="text-gray-500 text-[10px]">{n.date}</span>{n.author && <span className="text-gray-600 text-[10px]">— {n.author}</span>}</div><p className="text-gray-300 text-xs">{n.comment}</p></div>) : <p className="text-gray-500 text-xs text-center py-4">No notes yet</p>}</div>
  </div>;
}

// === CALC BREAKDOWN LEGACY (v2) — kept for backward compat ===
export function CalcBreakdown({ data: d, onClose }) {
  if (!d) return null;
  return <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center overflow-auto p-4" onClick={onClose}>
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-start mb-3">
        <div><h2 className="text-lg font-bold text-white">{d.coreId} — Legacy breakdown</h2></div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
      </div>
      <p className="text-gray-400 text-xs">Legacy core-level view kept for reference.</p>
    </div>
  </div>;
}

// === CALC BREAKDOWN V2/V3 — with forecast detail ===
export function CalcBreakdownV2({ core, vendor, vendorRec, profile, stg, onClose }) {
  if (!core || !vendor || !vendorRec) return null;

  const fmtN = (n) => (n == null || isNaN(n)) ? "—" : Math.round(n).toLocaleString("en-US");
  const fmt$ = (n) => (n == null || isNaN(n)) ? "—" : "$" + Math.round(n).toLocaleString("en-US");
  const fmt1 = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(1);
  const fmt3 = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(3);

  const bundlesForThisCore = (vendorRec.bundleDetails || [])
    .filter(bd => (bd.coresUsed || []).some(cu => cu.coreId === core.id))
    .map(bd => {
      const cu = (bd.coresUsed || []).find(c => c.coreId === core.id);
      const qtyPerBundle = cu?.qty || 1;
      const initialDOC = bd.effectiveDSR > 0 ? bd.assignedInv / bd.effectiveDSR : null;
      const rawUsedFromThisCore = (bd.rawAssignedFromWaterfall || 0) * qtyPerBundle;
      return { ...bd, qtyPerBundle, initialDOC, rawUsedFromThisCore };
    });

  const coreDetail = (vendorRec.coreDetails || []).find(cd => cd.coreId === core.id);
  const rawOnHand = Number(coreDetail?.rawOnHand ?? core.raw ?? 0);
  const rawEffective = Number(coreDetail?.rawEffective ?? rawOnHand);
  const pendingInbound = Number(coreDetail?.pendingInbound || 0);
  const initialPool = rawEffective + pendingInbound;
  const consumedFromWaterfall = bundlesForThisCore.reduce((s, b) => s + b.rawUsedFromThisCore, 0);
  const remainingAfterWaterfall = initialPool - consumedFromWaterfall;
  const anomalyInfo = coreDetail?.anomalyInfo;

  const coreModeBundles = bundlesForThisCore.filter(b => b.buyMode === 'core' && b.buyNeed > 0);
  const bundleModeBundles = bundlesForThisCore.filter(b => b.buyMode === 'bundle' && b.buyNeed > 0);
  const coreNeedPieces = coreDetail?.needPieces || 0;
  const coreFinalQty = coreDetail?.finalQty || 0;
  const coreCost = coreDetail?.cost || 0;

  const bundlePcsEquiv = bundleModeBundles.reduce((s, b) => s + b.buyNeed * b.qtyPerBundle, 0);
  const bundleCostTotal = bundleModeBundles.reduce((s, b) => {
    const price = vendorRec.priceMap?.[b.bundleId] || 0;
    return s + b.buyNeed * price;
  }, 0);

  const needPieces = coreNeedPieces + bundlePcsEquiv;
  const finalQty = coreFinalQty + bundlePcsEquiv;
  const cost = coreCost + bundleCostTotal;
  const moqInflated = coreDetail?.moqInflated || false;
  const moqRatio = coreDetail?.moqInflationRatio || 1;
  const excessFromMoq = coreDetail?.excessFromMoq || 0;
  const excessCostFromMoq = coreDetail?.excessCostFromMoq || 0;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center overflow-auto p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <div>
            <h2 className="text-lg font-bold text-white">{core.id} — Why buy? <span className="text-[10px] text-emerald-400 ml-2">v3</span></h2>
            <p className="text-gray-400 text-sm">{core.ti} · {vendor.name} · ${Number(core.cost || 0).toFixed(3)}/pc · LT {vendor.lt}d · Target DOC {vendorRec.targetDoc}d</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        {/* ANOMALY BANNER */}
        {anomalyInfo && anomalyInfo.detected && (
          <div className="bg-red-500/15 border border-red-500/40 rounded-lg p-3 mb-4">
            <div className="flex items-start gap-2">
              <span className="text-red-400 text-lg">⚠</span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-300 mb-1">Inventory anomaly detected</h3>
                <p className="text-xs text-gray-300 mb-2">{anomalyInfo.message}</p>
                {anomalyInfo.anomalies && anomalyInfo.anomalies.length > 0 && (
                  <div className="text-[10px] text-gray-400 space-y-0.5">
                    {anomalyInfo.anomalies.slice(0, 3).map((a, i) => (
                      <div key={i}>
                        <span className="text-gray-500">{a.date}:</span> expected {fmtN(a.expectedToday)} (yesterday {fmtN(a.actualYesterday)} − sales {fmtN(a.expectedSales)} + shipments {fmtN(a.shipments)}), actual {fmtN(a.actualToday)} <span className={a.diff < 0 ? "text-red-400" : "text-amber-400"}>(Δ {a.diff > 0 ? '+' : ''}{fmtN(a.diff)})</span>
                      </div>
                    ))}
                  </div>
                )}
                {anomalyInfo.override && (
                  <p className="text-[11px] text-emerald-300 mt-2">
                    ✓ Recommender using reconstructed raw = <span className="font-semibold">{fmtN(anomalyInfo.override.rawEffective)}</span> (instead of sheet value {fmtN(rawOnHand)}). Verify data before ordering.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className={`rounded-lg p-3 mb-4 ${needPieces > 0 ? "bg-blue-500/10 border border-blue-500/30" : "bg-gray-800/60"}`}>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Real need</div>
              <div className="text-white font-bold text-xl">{fmtN(needPieces)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Order (w/ MOQ)</div>
              <div className={`font-bold text-xl ${moqInflated ? "text-orange-300" : "text-white"}`}>{fmtN(finalQty)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Cost</div>
              <div className="text-amber-300 font-bold text-xl">{fmt$(cost)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Bundles involved</div>
              <div className="text-white font-bold text-xl">{bundlesForThisCore.length}</div>
            </div>
          </div>
          {moqInflated && (
            <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-orange-300">
              ⚠ MOQ inflation: {Math.round(moqRatio * 100)}% of real need · excess: {fmtN(excessFromMoq)} pcs ({fmt$(excessCostFromMoq)})
            </div>
          )}
        </div>

        {/* ─── FORECAST DETAIL (v3) ─── */}
        <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-emerald-300">Forecast Detail (per bundle)</h3>
            <span className="text-[10px] text-gray-500">Hampel → Holt → Safety</span>
          </div>
          <p className="text-gray-400 text-xs mb-3">
            Each bundle gets its own Holt-smoothed forecast (level + trend) on outlier-cleaned history, plus Z×σ_LT safety stock based on its ABC service level.
          </p>
          {bundlesForThisCore.length === 0 ? (
            <p className="text-gray-500 text-xs">No active bundles depend on this core.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 uppercase border-b border-gray-700">
                    <th className="py-1.5 text-left">Bundle</th>
                    <th className="py-1.5 text-right" title="ABC class">ABC</th>
                    <th className="py-1.5 text-right" title="Complete DSR del bundle (referencia, viene de la sheet)">C.DSR</th>
                    <th className="py-1.5 text-right" title="Holt-smoothed level (units/day)">Level</th>
                    <th className="py-1.5 text-right" title="Holt trend (Δ units/day/day). Positive = rising.">Trend</th>
                    <th className="py-1.5 text-right" title="Outliers cleaned by Hampel filter">Outl</th>
                    <th className="py-1.5 text-right" title="σ_LT: demand std dev during lead time">σ_LT</th>
                    <th className="py-1.5 text-right" title="Z multiplier from service level">Z</th>
                    <th className="py-1.5 text-right" title="Safety stock = Z × σ_LT">Safety</th>
                    <th className="py-1.5 text-right" title="Tracking signal. |TS|>4 = biased forecast">TS</th>
                  </tr>
                </thead>
                <tbody>
                  {bundlesForThisCore.slice().sort((a, b) => (a.currentCoverDOC || 0) - (b.currentCoverDOC || 0)).map(b => {
                    const f = b.forecast || {};
                    const ss = b.safetyStock || {};
                    const fl = b.flags || {};
                    const trendColor = (f.trend || 0) > 0.02 ? "text-emerald-300" : (f.trend || 0) < -0.02 ? "text-red-300" : "text-gray-400";
                    const tsExceeded = fl.trackingSignalExceeded;
                    return (
                      <tr key={b.bundleId} className="border-t border-gray-800/40">
                        <td className="py-1.5">
                          <span className="text-blue-300 font-mono">{b.bundleId}</span>
                          {fl.shortHistory && <span className="ml-1 text-[9px] text-amber-400" title="Short history — Holt fell back to mean">short</span>}
                          {fl.trendCapped && <span className="ml-1 text-[9px] text-amber-400" title="Negative trend capped">cap</span>}
                          {!f.usedHolt && !fl.shortHistory && <span className="ml-1 text-[9px] text-gray-500" title="No data — fallback to 0">no-data</span>}
                        </td>
                        <td className="py-1.5 text-right">{ss.profABC ? <AbcBadge grade={ss.profABC} /> : <span className="text-gray-600">—</span>}</td>
                        <td className="py-1.5 text-right text-gray-400">{fmt1(b.completeDSR ?? b.cd)}</td>
                        <td className="py-1.5 text-right text-white font-semibold">{fmt1(f.level)}</td>
                        <td className={`py-1.5 text-right ${trendColor}`}>{f.trend != null ? (f.trend > 0 ? '+' : '') + fmt3(f.trend) : "—"}</td>
                        <td className={`py-1.5 text-right ${f.outliersRemoved > 0 ? "text-amber-300" : "text-gray-600"}`}>{f.outliersRemoved || 0}</td>
                        <td className={`py-1.5 text-right ${ss.fallback ? "text-amber-300" : "text-gray-300"}`} title={ss.fallback ? "Fallback: not enough history for σ_LT, using CV=30%" : ""}>{fmt1(ss.sigmaLT)}</td>
                        <td className="py-1.5 text-right text-gray-300">{ss.Z != null ? fmt1(ss.Z) : "—"}</td>
                        <td className="py-1.5 text-right text-emerald-300 font-semibold">{fmtN(ss.amount)}</td>
                        <td className={`py-1.5 text-right ${tsExceeded ? "text-red-400 font-bold" : "text-gray-500"}`} title={tsExceeded ? "Forecast is biased — review" : "Tracking signal OK"}>{fl.trackingSignal != null ? fmt1(fl.trackingSignal) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Demand breakdown per bundle */}
          {bundlesForThisCore.some(b => b.demandBreakdown) && (
            <div className="mt-3 pt-3 border-t border-emerald-500/20">
              <h4 className="text-xs text-gray-400 font-semibold mb-2">Coverage demand decomposition</h4>
              <div className="space-y-1">
                {bundlesForThisCore.filter(b => b.demandBreakdown && b.buyNeed > 0).map(b => {
                  const bd = b.demandBreakdown;
                  const ss = b.safetyStock?.amount || 0;
                  return (
                    <div key={b.bundleId} className="flex items-center gap-2 bg-gray-900/40 rounded px-2 py-1 text-[11px]">
                      <span className="text-blue-300 font-mono min-w-[80px]">{b.bundleId}</span>
                      <span className="text-gray-500">level</span><span className="text-gray-200">{fmtN(bd.fromLevel)}</span>
                      <span className={`${bd.fromTrend > 0 ? "text-emerald-400" : bd.fromTrend < 0 ? "text-red-400" : "text-gray-500"}`}>{bd.fromTrend >= 0 ? '+' : ''}{fmtN(bd.fromTrend)}<span className="text-gray-500 ml-0.5">trend</span></span>
                      <span className={`${bd.fromSeasonal > 0 ? "text-purple-400" : bd.fromSeasonal < 0 ? "text-cyan-400" : "text-gray-500"}`}>{bd.fromSeasonal >= 0 ? '+' : ''}{fmtN(bd.fromSeasonal)}<span className="text-gray-500 ml-0.5">seas</span></span>
                      <span className="text-emerald-300">+{fmtN(ss)}<span className="text-gray-500 ml-0.5">safety</span></span>
                      <span className="ml-auto text-white font-semibold">= {fmtN(b.coverageDemand)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Seasonal Shape Heatmap */}
        {profile?.hasHistory && Array.isArray(profile.lastYearShape) && (
          <div className="bg-gray-800/40 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-white">Core seasonal shape (last year)</h3>
                <p className="text-[10px] text-gray-500">Normalized monthly demand. 1.0x = average. Green = above avg, red = below.</p>
              </div>
              {profile.cv != null && (
                <div className="text-right">
                  <div className="text-[9px] text-gray-500 uppercase">CV</div>
                  <div className={`text-xs font-bold ${profile.cv > 0.35 ? "text-purple-400" : "text-gray-400"}`}>
                    {profile.cv.toFixed(2)} <span className="text-[9px] font-normal">{profile.cv > 0.35 ? "seasonal" : "flat"}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-12 gap-1 text-center">
              {profile.lastYearShape.map((shape, i) => {
                const s = Number(shape) || 1;
                const bg = s > 1.3 ? "bg-emerald-500/40 text-emerald-100 border-emerald-400/40"
                         : s > 1.1 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/20"
                         : s < 0.7 ? "bg-red-500/40 text-red-100 border-red-400/40"
                         : s < 0.9 ? "bg-red-500/20 text-red-300 border-red-500/20"
                         : "bg-gray-700/60 text-gray-300 border-gray-600/40";
                const isCurMonth = i === new Date().getMonth();
                return (
                  <div key={i} className={`rounded border py-1 ${bg} ${isCurMonth ? "ring-2 ring-blue-400" : ""}`} title={isCurMonth ? "Current month" : ""}>
                    <div className="text-[9px] font-semibold opacity-80">{MN[i].substring(0, 3)}</div>
                    <div className="text-xs font-bold">{s.toFixed(2)}x</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 1: Core raw pool */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-white mb-2">Step 1: Core raw pool (waterfall input)</h3>
          <p className="text-gray-400 text-xs mb-3">
            The waterfall pool = raw on hand + 7f inbound to JLS. Inbound to Amazon (FBA) is NOT in the pool.
            {anomalyInfo?.override && <span className="text-red-300"> Using reconstructed raw due to detected anomaly.</span>}
          </p>
          <div className="grid grid-cols-5 gap-2 text-center">
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">{anomalyInfo?.override ? "Raw (reconstructed)" : "Raw on hand"}</div>
              <div className={`font-bold ${anomalyInfo?.override ? "text-red-300" : "text-white"}`}>{fmtN(rawEffective)}</div>
              {anomalyInfo?.override && <div className="text-[9px] text-gray-500 line-through">sheet: {fmtN(rawOnHand)}</div>}
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">+ 7f Inbound</div>
              <div className={`font-bold ${pendingInbound > 0 ? "text-blue-300" : "text-gray-600"}`}>{pendingInbound > 0 ? "+" + fmtN(pendingInbound) : "—"}</div>
            </div>
            <div className="bg-gray-900 rounded p-2 border border-gray-700">
              <div className="text-gray-500 text-[10px] uppercase">= Total Pool</div>
              <div className="text-white font-bold">{fmtN(initialPool)}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">− Waterfall Used</div>
              <div className="text-cyan-300 font-bold">{fmtN(consumedFromWaterfall)}</div>
            </div>
            <div className="bg-gray-900 rounded p-2">
              <div className="text-gray-500 text-[10px] uppercase">Remaining</div>
              <div className={`font-bold ${remainingAfterWaterfall > 0 ? "text-emerald-400" : "text-gray-500"}`}>{fmtN(remainingAfterWaterfall)}</div>
            </div>
          </div>
        </div>

        {/* Step 2: Bundles */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-white mb-2">Step 2: Bundles depending on this core ({bundlesForThisCore.length})</h3>
          <p className="text-gray-400 text-xs mb-2">
            DOC₀ = before waterfall. DOC₁ = after waterfall. Buy = short of coverage demand (= Holt + seasonal + safety).
          </p>
          {bundlesForThisCore.length === 0 ? (
            <p className="text-gray-500 text-xs">No active bundles depend on this core.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 uppercase border-b border-gray-700">
                    <th className="py-1.5 text-left">Bundle</th>
                    <th className="py-1.5 text-right" title="Holt level">Level</th>
                    <th className="py-1.5 text-right">Qty</th>
                    <th className="py-1.5 text-right">Inv</th>
                    <th className="py-1.5 text-right">DOC₀</th>
                    <th className="py-1.5 text-right">+Raw</th>
                    <th className="py-1.5 text-right">DOC₁</th>
                    <th className="py-1.5 text-right" title="Coverage demand (Holt × targetDoc × seasonal + safety stock)">Need</th>
                    <th className="py-1.5 text-right">Buy</th>
                    <th className="py-1.5 text-center">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {bundlesForThisCore.slice().sort((a, b) => (a.currentCoverDOC || 0) - (b.currentCoverDOC || 0)).map(b => {
                    const docBefore = b.initialDOC;
                    const docAfter = b.currentCoverDOC;
                    const docColor = docAfter <= 30 ? "text-red-400" : docAfter <= 60 ? "text-amber-400" : "text-emerald-400";
                    return (
                      <tr key={b.bundleId} className={`border-t border-gray-800/40 ${b.urgent ? "bg-red-900/10" : ""}`}>
                        <td className="py-1.5 text-blue-300 font-mono">
                          {b.bundleId}
                          {b.urgent && <span className="ml-1 text-red-400 text-[9px]" title="Will stockout before LT">⚠</span>}
                          {b.spikeVisual && <span className="ml-1 text-orange-400 text-[9px]" title="7D trending >25% above composite">⚡</span>}
                        </td>
                        <td className="py-1.5 text-right text-gray-300">{fmt1(b.forecast?.level ?? b.forecastLevelRaw ?? b.effectiveDSR)}</td>
                        <td className="py-1.5 text-right text-gray-500">×{b.qtyPerBundle}</td>
                        <td className="py-1.5 text-right text-gray-300">{fmtN(b.assignedInv)}</td>
                        <td className="py-1.5 text-right text-gray-400">{docBefore != null ? fmtN(docBefore) : "—"}</td>
                        <td className="py-1.5 text-right text-cyan-300">{b.rawAssignedFromWaterfall > 0 ? "+" + fmtN(b.rawAssignedFromWaterfall) : "—"}</td>
                        <td className={`py-1.5 text-right font-semibold ${docColor}`}>{fmtN(docAfter)}</td>
                        <td className="py-1.5 text-right text-gray-300 font-semibold">{fmtN(b.coverageDemand)}</td>
                        <td className={`py-1.5 text-right font-semibold ${b.buyNeed > 0 ? "text-amber-300" : "text-gray-600"}`}>{b.buyNeed > 0 ? fmtN(b.buyNeed) : "—"}</td>
                        <td className={`py-1.5 text-center text-[10px] font-semibold ${b.buyMode === 'bundle' ? "text-cyan-400" : "text-purple-400"}`}>{b.buyMode}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Step 3: Aggregate */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-white mb-2">Step 3: Aggregate to core need</h3>
          {coreModeBundles.length > 0 ? (
            <div className="space-y-1 text-xs">
              {coreModeBundles.map(b => (
                <div key={b.bundleId} className="flex items-center gap-2 bg-gray-900/50 rounded px-2 py-1">
                  <span className="text-blue-300 font-mono min-w-[80px]">{b.bundleId}</span>
                  <span className="text-gray-400">buy {fmtN(b.buyNeed)} × {b.qtyPerBundle} pc/bundle =</span>
                  <span className="text-white font-semibold ml-auto">{fmtN(b.buyNeed * b.qtyPerBundle)} pcs</span>
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-gray-700 pt-2 mt-2">
                <span className="text-gray-400 text-xs">Total raw need for this core</span>
                <span className="text-white font-bold ml-auto">{fmtN(needPieces)} pcs</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-xs">No core-mode bundles need this core right now.</p>
          )}
        </div>

        {/* Step 4: MOQ */}
        <div className={`rounded-lg p-4 ${moqInflated ? "bg-orange-500/10 border border-orange-500/30" : "bg-gray-800/50"}`}>
          <h3 className="text-sm font-semibold text-white mb-2">Step 4: Apply MOQ & casepack</h3>
          <div className="grid grid-cols-4 gap-3 text-center text-xs">
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Raw need</div>
              <div className="text-white font-bold text-base">{fmtN(needPieces)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase">MOQ</div>
              <div className="text-gray-300 font-bold text-base">{fmtN(core.moq || 0)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Casepack</div>
              <div className="text-gray-300 font-bold text-base">{fmtN(core.casePack || 1)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[10px] uppercase">Final order</div>
              <div className={`font-bold text-base ${moqInflated ? "text-orange-300" : "text-emerald-400"}`}>{fmtN(finalQty)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
