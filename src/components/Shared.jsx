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

        {/* ─── v4 FORECASTING ENGINE ─── */}
        <div className="border-t border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-emerald-400 mb-1">v4 Forecasting Engine</h3>
          <p className="text-[10px] text-gray-500 mb-3">7-segment dispatch (STABLE / SEASONAL_PEAKED / GROWING / DECLINING / INTERMITTENT / NEW_OR_SPARSE / DORMANT_REVIVED). Damp values, distance thresholds, segment safety multipliers and trend caps live in code — see Glossary "v4 Parameters" for what each one does and where to find it.</p>

          <div className="flex items-center gap-3 mb-3">
            <input
              type="checkbox"
              id="segmentationEnabled"
              checked={l.segmentationEnabled !== false}
              onChange={e => setL({ ...l, segmentationEnabled: e.target.checked })}
              className="accent-emerald-500"
            />
            <label htmlFor="segmentationEnabled" className="text-sm text-gray-300">
              Segmentation enabled
              <span className="text-[10px] text-gray-500 ml-2">(emergency off → every bundle treated as STABLE)</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Service level for ABC-class A bundles. Default 97% (Z=1.88). Bumped to 99% near a SEASONAL_PEAKED peak.">
                Service Level — A bundles
              </label>
              <div className="flex gap-2">
                <input type="number" step="0.5" min="85" max="99.9" value={l.serviceLevelA ?? 97} onChange={e => setL({ ...l, serviceLevelA: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
                <span className="text-gray-500 text-xs self-center">%</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Default 97% · Z≈1.88. Bumped to 99% near a peak.</p>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1" title="Service level for all non-A bundles. Default 95% (Z=1.65).">
                Service Level — B/C/other
              </label>
              <div className="flex gap-2">
                <input type="number" step="0.5" min="85" max="99.9" value={l.serviceLevelOther ?? 95} onChange={e => setL({ ...l, serviceLevelOther: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
                <span className="text-gray-500 text-xs self-center">%</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">Default 95% · Z≈1.65</p>
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
              <label className="text-sm text-gray-400 block mb-1" title="Si el MOQ obliga a comprar más de Nx el need real, bloquear la compra. 3x es conservador, 5x más permisivo. No afecta a case-packs domésticos típicos (~1.1x).">
                MOQ Inflation Hard Cap
              </label>
              <input type="number" step="0.5" min="1" value={l.moqInflationHardCap ?? 3.0} onChange={e => setL({ ...l, moqInflationHardCap: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
              <p className="text-[10px] text-gray-500 mt-1">Default 3.0 · ratio &gt; cap ⇒ bloqueado</p>
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

