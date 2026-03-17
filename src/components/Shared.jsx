import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { dotCls } from "../lib/utils";

// === Quick Sum Context ===
export const SumCtx = createContext({ addCell: () => {} });

// === Dot indicator ===
export function Dot({ status }) {
  return <span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${dotCls(status)}`} />;
}

// === Loading spinner ===
export function Loader({ text }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">{text}</p>
      </div>
    </div>
  );
}

// === Toast notification ===
export function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t) }, [onClose]);
  return <div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50">✅ {msg}</div>;
}

// === Editable Number Input (keeps focus while typing) ===
export function NumInput({ value, onChange, placeholder, className }) {
  const [local, setLocal] = useState(value || '');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!focused) setLocal(value || '');
  }, [value, focused]);

  const fmt = v => {
    if (!v && v !== 0) return '';
    const n = parseFloat(String(v).replace(/,/g, ''));
    if (isNaN(n) || n === 0) return '';
    return n.toLocaleString('en-US');
  };

  return <input
    ref={ref}
    type="text"
    inputMode="decimal"
    value={focused ? local : fmt(value)}
    onFocus={() => { setFocused(true); setLocal(value || '') }}
    onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setLocal(v) }}
    onBlur={() => { setFocused(false); onChange(Math.max(0, parseFloat(local) || 0)) }}
    onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
    placeholder={placeholder || "0"}
    className={className || "bg-gray-800 border border-gray-600 text-white rounded px-1.5 py-1 w-16 text-center text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"}
  />;
}

// === Tooltip header cell ===
export function TH({ children, tip, className }) {
  return <th className={className} title={tip}>{children}</th>;
}

// === Clickable numeric cell for Quick Sum ===
export function NC({ v, fmt, className }) {
  const { addCell } = useContext(SumCtx);
  const [sel, setSel] = useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const valid = !isNaN(raw) && raw !== 0;
  const toggle = () => {
    if (!valid) return;
    if (sel) { addCell(raw, true); setSel(false) }
    else { addCell(raw, false); setSel(true) }
  };
  return (
    <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${valid ? "cursor-pointer select-none" : ""}`} onClick={toggle}>
      {fmt ? fmt(v) : v}
    </td>
  );
}

// === Quick Sum floating bar ===
export function QuickSum({ cells, onClear }) {
  if (!cells.length) return null;
  const sum = cells.reduce((a, b) => a + b, 0);
  const avg = sum / cells.length;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-lg px-5 py-2.5 shadow-xl z-50 flex items-center gap-5 text-sm">
      <span className="text-gray-400">Selected: <span className="text-white font-semibold">{cells.length}</span></span>
      <span className="text-gray-400">Sum: <span className="text-emerald-400 font-semibold">{sum.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
      <span className="text-gray-400">Avg: <span className="text-blue-400 font-semibold">{avg.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>
      <button onClick={onClear} className="text-gray-500 hover:text-white text-xs ml-2">✕</button>
    </div>
  );
}

// === Searchable Select ===
export function SS({ value, onChange, options, placeholder }) {
  const [o, setO] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setO(false) }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const f = options.filter(x => x.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <input type="text" value={o ? q : (value || "")} placeholder={placeholder || "All Vendors"}
        onFocus={() => { setO(true); setQ("") }}
        onChange={e => { setQ(e.target.value); setO(true) }}
        className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5 w-48" />
      {o && (
        <div className="absolute z-40 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-80 overflow-auto w-56">
          <button onClick={() => { onChange(""); setO(false) }} className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700">All</button>
          {f.map(x => (
            <button key={x} onClick={() => { onChange(x); setO(false); setQ("") }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 ${x === value ? "text-blue-400" : "text-gray-300"}`}>{x}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// === Settings Modal ===
export function Stg({ s, setS, onClose }) {
  const [l, setL] = useState({ ...s });
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Buyer Initials</label>
            <input type="text" value={l.buyer || ''} onChange={e => setL({ ...l, buyer: e.target.value })} placeholder="e.g. FS" className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm text-gray-400 block mb-1">Domestic DOC</label><input type="number" value={l.domesticDoc} onChange={e => setL({ ...l, domesticDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
            <div><label className="text-sm text-gray-400 block mb-1">Intl DOC</label><input type="number" value={l.intlDoc} onChange={e => setL({ ...l, intlDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
          </div>
          {/* CORE FILTERS */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-sm font-semibold text-blue-400 mb-3">Core Filters</h3>
            <div className="space-y-3">
              {[["Active", "fA"], ["Visible", "fV"]].map(([lb, k]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">{lb}</span>
                  <select value={l[k]} onChange={e => setL({ ...l, [k]: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28">
                    <option value="yes">Yes</option><option value="no">No</option><option value="all">All</option>
                  </select>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Ignored</span>
                <select value={l.fI} onChange={e => setL({ ...l, fI: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28">
                  <option value="blank">Blank</option><option value="set">Set</option><option value="all">All</option>
                </select>
              </div>
            </div>
          </div>
          {/* BUNDLE FILTERS */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-sm font-semibold text-indigo-400 mb-3">Bundle Filters</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Active</span>
                <select value={l.bA || 'yes'} onChange={e => setL({ ...l, bA: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28">
                  <option value="yes">Yes</option><option value="no">No</option><option value="all">All</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Ignored</span>
                <select value={l.bI || 'blank'} onChange={e => setL({ ...l, bI: e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28">
                  <option value="blank">Blank</option><option value="set">Set</option><option value="all">All</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={() => { setS(l); onClose() }} className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium">Save</button>
          <button onClick={onClose} className="flex-1 bg-gray-700 text-white rounded-lg py-2 font-medium">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// === Badge helpers ===
export function AbcBadge({ grade }) {
  if (!grade) return null;
  const cls = grade === "A" ? "bg-emerald-500/20 text-emerald-400" : grade === "B" ? "bg-blue-500/20 text-blue-400" : "bg-gray-500/20 text-gray-400";
  return <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${cls}`}>{grade}</span>;
}

export function HealthBadge({ health, ltsf }) {
  if (!health) return null;
  const cls = health === "Healthy" ? "text-emerald-400" : health === "At Risk" ? "text-amber-400" : "text-red-400";
  return (
    <span className="flex items-center gap-1">
      <span className={`text-xs font-semibold ${cls}`}>{health}</span>
      {ltsf > 0 && <span className="text-xs text-red-300">${ltsf.toFixed(2)}</span>}
    </span>
  );
}

export function KillBadge({ eval: ev }) {
  if (!ev) return null;
  const isKill = ev.toLowerCase().includes('kill');
  const isSell = ev.toLowerCase().includes('sell');
  if (!isKill && !isSell) return null;
  return <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${isKill ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{isKill ? "KILL" : "SELLTHROUGH"}</span>;
}

// === Core Detail Modal (slide-over panel) ===
export function SlidePanel({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-4xl bg-gray-950 border-l border-gray-800 overflow-y-auto shadow-2xl">
        <button onClick={onClose} className="sticky top-4 right-4 float-right z-10 text-gray-400 hover:text-white text-xl bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center mr-4 mt-4">✕</button>
        {children}
      </div>
    </div>
  );
}

// === Workflow Note Chip ===
const WF_STATUSES = ["Buy", "Reviewing", "Ignore", "Done", ""];
const WF_COLORS = { Buy: "bg-emerald-500/20 text-emerald-400", Reviewing: "bg-amber-500/20 text-amber-400", Ignore: "bg-red-500/20 text-red-400", Done: "bg-blue-500/20 text-blue-400" };

export function WorkflowChip({ id, type, workflow, onSave, onDelete, buyer }) {
  const [open, setOpen] = useState(false);
  const existing = (workflow || []).find(w => w.id === id);
  const [status, setStatus] = useState(existing?.status || "");
  const [note, setNote] = useState(existing?.note || "");
  const [ignoreUntil, setIgnoreUntil] = useState(existing?.ignoreUntil || "");

  useEffect(() => {
    const ex = (workflow || []).find(w => w.id === id);
    if (ex) { setStatus(ex.status || ""); setNote(ex.note || ""); setIgnoreUntil(ex.ignoreUntil || "") }
  }, [workflow, id]);

  const save = () => {
    onSave({ id, type, status, note, ignoreUntil, updatedBy: buyer || "" });
    setOpen(false);
  };
  const del = () => { onDelete({ id }); setOpen(false); setStatus(""); setNote(""); setIgnoreUntil("") };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`text-xs px-1.5 py-0.5 rounded ${existing?.status ? WF_COLORS[existing.status] || "bg-gray-700 text-gray-300" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}>
        {existing?.status ? <>{existing.status}{existing.note ? " · " + existing.note.substring(0, 15) + (existing.note.length > 15 ? "…" : "") : ""}</> : "📝"}
      </button>
    );
  }

  return (
    <div className="absolute z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 w-64" onClick={e => e.stopPropagation()}>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Status</label>
          <div className="flex gap-1 flex-wrap">{WF_STATUSES.filter(Boolean).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`text-xs px-2 py-1 rounded ${status === s ? WF_COLORS[s] : "bg-gray-800 text-gray-400"}`}>{s}</button>
          ))}</div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Note</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Negotiating price..." className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 w-full text-xs" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Ignore Until</label>
          <input type="date" value={ignoreUntil} onChange={e => setIgnoreUntil(e.target.value)} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 w-full text-xs" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={save} className="flex-1 bg-blue-600 text-white text-xs rounded py-1">Save</button>
          {existing && <button onClick={del} className="bg-red-600/20 text-red-400 text-xs rounded py-1 px-2">Delete</button>}
          <button onClick={() => setOpen(false)} className="bg-gray-700 text-gray-300 text-xs rounded py-1 px-2">Cancel</button>
        </div>
      </div>
    </div>
  );
}
