import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { dotCls } from "../lib/utils";

export const SumCtx = createContext({ addCell: () => {} });

export function Dot({ status }) { return <span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${dotCls(status)}`} /> }
export function Loader({ text }) { return <div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-gray-400 text-sm">{text}</p></div></div> }
export function Toast({ msg, onClose }) { useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t) }, [onClose]); return <div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50">✅ {msg}</div> }

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
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
      <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
      <div className="space-y-4">
        <div><label className="text-sm text-gray-400 block mb-1">Buyer Initials</label><input type="text" value={l.buyer || ''} onChange={e => setL({ ...l, buyer: e.target.value })} placeholder="e.g. FS" className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm text-gray-400 block mb-1">Domestic DOC</label><input type="number" value={l.domesticDoc} onChange={e => setL({ ...l, domesticDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
          <div><label className="text-sm text-gray-400 block mb-1">Intl DOC</label><input type="number" value={l.intlDoc} onChange={e => setL({ ...l, intlDoc: +e.target.value })} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full" /></div>
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

export function WorkflowChip({ id, type, workflow, onSave, onDelete, buyer }) {
  const [open, setOpen] = useState(false);
  const existing = (workflow || []).find(w => w.id === id);
  const [status, setStatus] = useState(existing?.status || "");
  const [note, setNote] = useState(existing?.note || "");
  const [ignoreUntil, setIgnoreUntil] = useState(existing?.ignoreUntil || "");
  useEffect(() => { const ex = (workflow || []).find(w => w.id === id); if (ex) { setStatus(ex.status || ""); setNote(ex.note || ""); setIgnoreUntil(ex.ignoreUntil || "") } }, [workflow, id]);
  const save = () => { onSave({ id, type, status, note, ignoreUntil, updatedBy: buyer || "" }); setOpen(false) };
  const del = () => { onDelete({ id }); setOpen(false); setStatus(""); setNote(""); setIgnoreUntil("") };
  if (!open) return <button onClick={() => setOpen(true)} className={`text-xs px-1.5 py-0.5 rounded ${existing?.status ? WF_COLORS[existing.status] || "bg-gray-700 text-gray-300" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}>{existing?.status ? <>{existing.status}{existing.note ? " · " + existing.note.substring(0, 15) + (existing.note.length > 15 ? "…" : "") : ""}</> : "📝"}</button>;
  return <div className="absolute z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 w-64" onClick={e => e.stopPropagation()}>
    <div className="space-y-2">
      <div><label className="text-xs text-gray-500 block mb-1">Status</label><div className="flex gap-1 flex-wrap">{WF_STATUSES.filter(Boolean).map(s => <button key={s} onClick={() => setStatus(s)} className={`text-xs px-2 py-1 rounded ${status === s ? WF_COLORS[s] : "bg-gray-800 text-gray-400"}`}>{s}</button>)}</div></div>
      <div><label className="text-xs text-gray-500 block mb-1">Note</label><input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Negotiating price..." className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 w-full text-xs" /></div>
      <div><label className="text-xs text-gray-500 block mb-1">Ignore Until</label><input type="date" value={ignoreUntil} onChange={e => setIgnoreUntil(e.target.value)} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 w-full text-xs" /></div>
      <div className="flex gap-2 pt-1"><button onClick={save} className="flex-1 bg-blue-600 text-white text-xs rounded py-1">Save</button>{existing && <button onClick={del} className="bg-red-600/20 text-red-400 text-xs rounded py-1 px-2">Delete</button>}<button onClick={() => setOpen(false)} className="bg-gray-700 text-gray-300 text-xs rounded py-1 px-2">Cancel</button></div>
    </div>
  </div>;
}

const VC_CATS = ["Communication", "Lead Time", "Pricing", "Discount", "Quality", "Other"];
const VC_COLORS = { Communication: "text-blue-400", "Lead Time": "text-amber-400", Pricing: "text-emerald-400", Discount: "text-purple-400", Quality: "text-red-400", Other: "text-gray-400" };

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

// === CALC BREAKDOWN MODAL (v2 — 5 steps) ===
export function CalcBreakdown({ data: d, onClose }) {
  if (!d) return null;
  const shC = v => v > 1.3 ? "bg-emerald-500/20 text-emerald-400" : v > 1.1 ? "bg-blue-500/20 text-blue-300" : v < 0.7 ? "bg-red-500/20 text-red-400" : v < 0.9 ? "bg-amber-500/20 text-amber-400" : "bg-gray-700 text-gray-400";
  const MTab = ({ rows, label }) => <table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase border-b border-gray-700"><th className="py-1.5 text-left">Month</th><th className="py-1.5 text-right">Days</th><th className="py-1.5 text-right">Shape</th><th className="py-1.5 text-right">Growth</th><th className="py-1.5 text-right">Proj DSR</th><th className="py-1.5 text-right">Units</th></tr></thead>
    <tbody>{rows.map((m, i) => <tr key={i} className={`${i % 2 === 0 ? "bg-gray-800/30" : ""} border-t border-gray-800/30`}><td className="py-1.5 text-gray-300">{m.label}</td><td className="py-1.5 text-right text-gray-400">{m.days}d</td><td className={`py-1.5 text-right ${m.shapeFactor > 1.2 ? "text-emerald-400" : m.shapeFactor < 0.8 ? "text-red-400" : "text-gray-300"}`}>{m.shapeFactor}x</td><td className="py-1.5 text-right text-blue-400">{m.growthFactor}x</td><td className="py-1.5 text-right text-white font-semibold">{m.projDsr}</td><td className="py-1.5 text-right text-white">{m.units.toLocaleString()}</td></tr>)}</tbody>
    <tfoot><tr className="border-t-2 border-gray-600 font-semibold"><td className="py-2 text-gray-300">Total</td><td className="py-2 text-right">{rows.reduce((s, m) => s + m.days, 0)}d</td><td colSpan={3} /><td className="py-2 text-right text-white text-sm">{rows.reduce((s, m) => s + m.units, 0).toLocaleString()}</td></tr></tfoot>
  </table>;

  return <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center overflow-auto p-4" onClick={onClose}>
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-start mb-3">
        <div><h2 className="text-lg font-bold text-white">{d.coreId} — Seasonal Forecast v2</h2><p className="text-gray-400 text-sm">{d.title} · {d.vendor}</p></div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
      </div>

      {/* Summary */}
      <div className={`rounded-lg p-3 mb-4 text-sm leading-relaxed ${d.urgent ? "bg-red-500/10 border border-red-500/30 text-red-200" : "bg-gray-800/60 text-gray-300"}`}>{d.summaryText}</div>

      {/* KPIs */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        {[{ l: "DSR", v: d.currentDSR.toFixed(1) }, { l: "DOC", v: Math.round(d.currentDOC) }, { l: "Inventory", v: d.inventory.toLocaleString() }, { l: "Lead Time", v: d.leadTime + "d" }, { l: "Target DOC", v: d.targetDOC + "d" }, { l: "Growth", v: d.growthFactor + "x", c: d.growthFactor > 1.05 ? "text-emerald-400" : d.growthFactor < 0.95 ? "text-red-400" : "" }].map(k =>
          <div key={k.l} className="bg-gray-800 rounded-lg p-2 text-center"><div className="text-gray-500 text-[10px] uppercase">{k.l}</div><div className={`font-bold text-sm ${k.c || "text-white"}`}>{k.v}</div></div>
        )}
      </div>

      {/* Step 4: Seasonal Shape */}
      <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-white mb-2">Step 4: Last-Year Shape (from {d.shapeYear})</h3>
        {!d.hasHistory && <p className="text-amber-400 text-xs mb-2">⚠ Not enough history. Using flat shape (1.0).</p>}
        <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
          <div><div className="text-gray-500 text-xs">CV</div><div className="text-white">{d.cv} — <span className={d.cv > 0.35 ? "text-purple-400" : "text-gray-400"}>{d.cvLabel}</span></div></div>
          <div><div className="text-gray-500 text-xs">Sustained Growth (YTD)</div><div className={`font-semibold ${d.growthFactor > 1.05 ? "text-emerald-400" : d.growthFactor < 0.95 ? "text-red-400" : "text-gray-300"}`}>{d.growthFactor}x — {d.growthLabel}</div></div>
          {d.purchFreq && <div><div className="text-gray-500 text-xs">Purchase Freq</div><div className="text-gray-300">{d.purchFreq.label} ({d.purchFreq.ordersPerYear}/yr){d.purchFreq.comment && <span className="text-amber-400 ml-1 text-xs">{d.purchFreq.comment}</span>}</div></div>}
        </div>
        <div className="text-xs text-gray-500 mb-2">Monthly shape factors (last year's curve normalized):</div>
        <div className="grid grid-cols-12 gap-1 text-center text-[10px]">
          {d.seasonalShape.map((s, i) => <div key={i} className={`rounded py-1.5 ${shC(s.shape)}`}><div className="font-semibold">{s.month.substring(0, 3)}</div><div className="font-bold text-sm">{s.shape}</div><div className="text-[8px] opacity-70">{s.interpretation}</div></div>)}
        </div>
        {Object.keys(d.yearlyTotals).length > 0 && <div className="mt-2 text-xs text-gray-500">Yearly DSR totals: {Object.entries(d.yearlyTotals).map(([y, t]) => `${y}: ${t.toLocaleString()}`).join(' · ')}</div>}
        <div className="mt-1 text-xs text-gray-600">Formula: projectedDSR = currentDSR × shape[month] × growthFactor × safetyMultiplier({d.safetyMultiplier})</div>
      </div>

      {/* Step 1: Lead Time Consumption */}
      <div className={`rounded-lg p-4 mb-4 ${d.urgent ? "bg-red-500/10 border border-red-500/30" : "bg-gray-800/50"}`}>
        <h3 className="text-sm font-semibold text-white mb-2">Step 1: Consumption During Lead Time ({d.leadTime}d)</h3>
        <p className="text-gray-400 text-xs mb-2">Today → arrival {d.arrivalDate}. How much inventory will be consumed before the order arrives?</p>
        {d.ltMonths.length > 0 && <MTab rows={d.ltMonths} />}
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <div><div className="text-gray-500 text-xs">Current Inventory</div><div className="text-white font-bold">{d.inventory.toLocaleString()}</div></div>
          <div><div className="text-gray-500 text-xs">LT Consumption</div><div className="text-red-400 font-bold">− {d.ltConsumption.toLocaleString()}</div></div>
          <div><div className="text-gray-500 text-xs">Inventory at Arrival</div><div className={`font-bold ${d.inventoryAtArrival < 0 ? "text-red-400" : "text-emerald-400"}`}>{d.inventoryAtArrival.toLocaleString()}</div></div>
        </div>
        {d.urgent && <p className="text-red-400 text-xs font-semibold mt-2">⚠ STOCKOUT: will run out {d.shortfall.toLocaleString()} units before arrival!</p>}
      </div>

      {/* Step 2: Coverage Need */}
      <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-white mb-2">Step 2: Coverage After Arrival ({d.targetDOC}d)</h3>
        <p className="text-gray-400 text-xs mb-2">{d.windowStart} → {d.windowEnd}. Projected demand with safety ×{d.safetyMultiplier}.</p>
        {d.covMonths.length > 0 && <MTab rows={d.covMonths} />}
      </div>

      {/* Step 3: Final Need */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Step 3: Final Need</h3>
        <div className="grid grid-cols-3 gap-4 text-center mb-3">
          <div><div className="text-gray-400 text-xs">Coverage Need</div><div className="text-white font-bold text-xl">{d.coverageNeed.toLocaleString()}</div></div>
          <div><div className="text-gray-400 text-xs">Inv at Arrival</div><div className="text-white font-bold text-xl">− {Math.max(0, d.inventoryAtArrival).toLocaleString()}</div></div>
          <div><div className="text-gray-400 text-xs">Need to Order</div><div className="text-emerald-400 font-bold text-xl">= {d.need.toLocaleString()}</div></div>
        </div>
        <div className="pt-3 border-t border-gray-700 flex flex-wrap gap-4 text-xs justify-center">
          <span className="text-gray-500">Old flat: <span className="text-gray-300 font-semibold">{d.targetDOC}d × {d.currentDSR.toFixed(1)} − {d.inventory.toLocaleString()} = {d.flatNeed.toLocaleString()}</span></span>
          <span className={`font-semibold ${d.difference > 0 ? "text-amber-400" : d.difference < 0 ? "text-emerald-400" : "text-gray-400"}`}>{d.differenceLabel}</span>
        </div>
      </div>
    </div>
  </div>;
}
