import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { R, D1, $, $2, P, MN, YC, TTP, BL, TL, gS, cAI, cNQ, cOQ, cDA, gTD, dc, fE, fD, cMo, gY, cSeas } from "../lib/utils";
import { Dot, TH, SumCtx } from "./Shared";

// Clickable cell for Quick Sum
function SC({ v, children, className }) {
  const { addCell } = React.useContext(SumCtx);
  const [sel, setSel] = React.useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

// Derive DSR: use avgDsr if available, otherwise units/dataDays
const getDsr = (h) => {
  if (!h) return null;
  if (h.avgDsr && h.avgDsr > 0) return h.avgDsr;
  if (h.units > 0 && h.dataDays > 0) return Math.round(h.units / h.dataDays * 100) / 100;
  return null;
};

export default function CoreTab({ data, stg, hist, daily, coreId, onBack, goBundle }) {
  const [s, setS] = useState("");
  const [sel, setSel] = useState(coreId || null);
  useEffect(() => { if (coreId) setSel(coreId) }, [coreId]);

  const core = sel ? (data.cores || []).find(c => c.id === sel) : null;
  const ven = core ? (data.vendors || []).find(v => v.name === core.ven) : null;
  const lt = ven?.lt || 30; const tg = gTD(ven, stg);
  const feM = useMemo(() => { const m = {}; (data.fees || []).forEach(f => m[f.j] = f); return m }, [data.fees]);
  const saM = useMemo(() => { const m = {}; (data.sales || []).forEach(s => m[s.j] = s); return m }, [data.sales]);
  const cH = useMemo(() => (hist?.coreInv || []).filter(h => h.core === sel), [hist, sel]);
  const cHF = cH;
  const yrs = useMemo(() => gY(cHF), [cHF]);

  // Monthly DSR chart data — show raw sum (units = sum of 1-day DSR)
  const dsrCh = useMemo(() => MN.map((m, i) => {
    const r = { month: m };
    yrs.forEach(y => {
      const h = cHF.find(x => x.y === y && x.m === i + 1);
      r["d_" + y] = h?.units > 0 ? h.units : null;
      r["oos_" + y] = (h?.oosDays && h.oosDays > 0) ? h.oosDays : null;
    });
    return r;
  }), [cHF, yrs]);

  // Bundle association — Attached JLS #s first (robust matching), then core1 fallback
  const bA = stg.bA || "yes"; const bI = stg.bI || "blank";
  const bundleFilter = b => {
    if (bA === "yes" && b.active !== "Yes") return false;
    if (bA === "no" && b.active === "Yes") return false;
    if (bI === "blank" && !!b.ignoreUntil) return false;
    if (bI === "set" && !b.ignoreUntil) return false;
    return true;
  };
  const cBA = useMemo(() => {
    if (!core) return [];
    // Parse Attached JLS #s — handle commas, semicolons, newlines, spaces
    const raw = (core.jlsList || "").split(/[,;|\n\r]+/).map(j => j.trim()).filter(Boolean);
    if (raw.length > 0) {
      const jlsSet = new Set(raw.map(j => j.toLowerCase()));
      const matched = (data.bundles || []).filter(b =>
        jlsSet.has(b.j.trim().toLowerCase()) && bundleFilter(b)
      );
      if (matched.length > 0) return matched;
    }
    // Fallback: match by core1
    return (data.bundles || []).filter(b => b.core1 === sel && bundleFilter(b));
  }, [core, sel, data.bundles, stg]);

  const bIds = useMemo(() => cBA.map(b => b.j), [cBA]);
  const inbS = useMemo(() => {
    if (!sel || !data.inbound) return [];
    const ids = new Set([sel, ...bIds].map(x => (x || "").trim().toLowerCase()));
    return data.inbound.filter(s => ids.has((s.core || "").trim().toLowerCase()));
  }, [data.inbound, sel, bIds]);

  const ai = core ? cAI(core) : 0;
  const status = core ? gS(core.doc, lt, core.buf || 14, stg) : "healthy";
  const nq = core ? cNQ(core, tg) : 0;
  const oq = core ? cOQ(nq, core.moq, core.casePack) : 0;
  const da = core ? cDA(core, oq) : 0;
  const seas = core ? cSeas(core.id, hist?.coreInv || []) : null;

  const pipe = core ? [
    { l: "Raw", v: core.raw }, { l: "Inb", v: core.inb }, { l: "PP", v: core.pp },
    { l: "JFN", v: core.jfn }, { l: "PQ", v: core.pq }, { l: "JI", v: core.ji }, { l: "FBA", v: core.fba }
  ] : [];
  const mxP = Math.max(...pipe.map(p => p.v), 1);

  const tBD = useMemo(() => cBA.reduce((s, b) => s + (b.cd || 0), 0), [cBA]);
  const agedMap = useMemo(() => { const m = {}; (data.agedInv || []).forEach(r => m[r.j] = r); return m }, [data.agedInv]);
  const killMap = useMemo(() => { const m = {}; (data.killMgmt || []).forEach(r => m[r.j] = r); return m }, [data.killMgmt]);

  const cB = useMemo(() => {
    const totL28 = cBA.reduce((s, b) => { const sa = saM[b.j]; return s + (sa?.l28U || 0) }, 0);
    return cBA.map(b => {
      const sa = saM[b.j]; const f = feM[b.j]; const l28 = sa?.l28U || 0;
      return {
        ...b, fee: f, sale: sa,
        pct: tBD > 0 ? +((b.cd / tBD) * 100).toFixed(1) : 0,
        l28pct: totL28 > 0 ? +((l28 / totL28) * 100).toFixed(1) : 0, l28
      };
    }).sort((a, b) => (a.fibDoc || 0) - (b.fibDoc || 0));
  }, [cBA, feM, saM, tBD]);

  const etaT = useMemo(() => inbS.filter(s => s.eta).map(s => fE(s.eta)).join(", "), [inbS]);
  const cDays = useMemo(() => (daily?.coreDays || []).filter(d => d.core === sel).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14), [daily, sel]);
  const bT = useMemo(() => {
    let d = 0, lr = 0, lp = 0;
    cB.forEach(b => { d += b.cd || 0; if (b.sale) { lr += b.sale.ltR || 0; lp += b.sale.ltP || 0 } });
    return { d, lr, lp };
  }, [cB]);

  // === SEARCH VIEW ===
  if (!core) return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Back</button>
        <input type="text" placeholder="Search core..." value={s} onChange={e => setS(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 max-w-md text-sm" />
      </div>
      {s.length >= 2 ? (
        <div className="space-y-1">
          {(data.cores || []).filter(c => {
            const q = s.toLowerCase();
            return c.id.toLowerCase().includes(q) || c.ti.toLowerCase().includes(q);
          }).slice(0, 12).map(c => (
            <button key={c.id} onClick={() => setSel(c.id)}
              className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3">
              <Dot status={gS(c.doc, (data.vendors || []).find(v => v.name === c.ven)?.lt || 30, c.buf, stg)} />
              <span className="text-blue-400 font-mono text-sm">{c.id}</span>
              <span className="text-gray-300 text-sm truncate">{c.ti}</span>
            </button>
          ))}
        </div>
      ) : <p className="text-gray-500 text-sm">Type 2+ chars</p>}
    </div>
  );

// === DETAIL VIEW ===
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <button onClick={() => setSel(null)} className="text-gray-400 hover:text-white text-sm mb-4">← Back</button>

      {/* Header */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="text-xl font-bold text-white">{core.id}</span>
          <Dot status={status} />
          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${status === "critical" ? "bg-red-500/20 text-red-400" : status === "warning" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
            {status.toUpperCase()}
          </span>
          {seas && <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-semibold">SEASONAL {seas.peak}</span>}
        </div>
        <p className="text-gray-300 text-sm mb-1">{core.ti}</p>
        <p className="text-gray-500 text-xs">{core.ven} · VSKU:{core.vsku || "—"} · {$2(core.cost)} · LT:{lt}d · Buf:{core.buf || 14}d · Tgt:{tg}d</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          { l: "C.DSR", v: D1(core.dsr) },
          { l: "7D", v: D1(core.d7) },
          { l: "DOC", v: R(core.doc), c: dc(core.doc, lt, lt + (core.buf || 14)) },
          { l: "All-In Own Pcs", v: R(ai) },
          { l: "Inbound (sheet)", v: R(core.inb) }, { l: "Inbound 7f", v: R(inbS.reduce((s, i) => s + (i.pieces || 0), 0)), sub: etaT }
        ].map(k => (
          <div key={k.l} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
            <div className="text-gray-500 text-xs mb-1">{k.l}</div>
            <div className={`text-lg font-bold ${k.c || "text-white"}`}>{k.v}</div>
            {k.sub && <div className="text-emerald-400 text-xs mt-1">ETA: {k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Inbound Shipments */}
      {inbS.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-3">Inbound Shipments</h3>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 uppercase">
              <th className="py-1 px-2 text-left">Order#</th>
              <th className="py-1 px-2 text-left">Core#</th>
              <th className="py-1 px-2 text-left">Title</th>
              <th className="py-1 px-2 text-left">Vendor</th>
              <th className="py-1 px-2 text-right">Pcs</th>
              <th className="py-1 px-2 text-right">Missing</th>
              <th className="py-1 px-2 text-right">ETA</th>
            </tr></thead>
            <tbody>{inbS.map((s, i) => {
              const daysLeft = s.eta ? Math.ceil((new Date(s.eta) - new Date()) / 86400000) : null;
              return (
              <tr key={i}>
                <td className="py-1.5 px-2 text-gray-300">{s.orderNum}</td>
                <td className="py-1.5 px-2 text-blue-400 font-mono">{s.core}</td>
                <td className="py-1.5 px-2 text-gray-300 truncate max-w-[140px]">{s.shortTitle || "—"}</td>
                <td className="py-1.5 px-2 text-gray-400">{s.vendor}</td>
                <td className="py-1.5 px-2 text-right text-white">{R(s.pieces)}</td>
                <td className="py-1.5 px-2 text-right text-red-400">{s.piecesMissing > 0 ? R(s.piecesMissing) : "—"}</td>
                <td className="py-1.5 px-2 text-right text-emerald-400">{s.eta ? fE(s.eta) : "—"}{daysLeft != null && <span className="ml-1 text-gray-500 text-[10px]">({daysLeft}d)</span>}</td>
              </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {/* Daily */}
      {cDays.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-3">Daily ({cDays.length}d)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 uppercase">
                <th className="py-1 px-1 text-left">Date</th><th className="py-1 px-1 text-right">DSR</th>
                <th className="py-1 px-1 text-right">1D</th><th className="py-1 px-1 text-right">3D</th>
                <th className="py-1 px-1 text-right">7D</th><th className="py-1 px-1 text-right">DOC</th>
                <th className="py-1 px-1 text-right">Δ#</th><th className="py-1 px-1 text-right">Δ%</th>
                <th className="py-1 px-1 text-right">Cash</th><th className="py-1 px-1 text-right">Own</th>
                <th className="py-1 px-1 text-right">Raw</th><th className="py-1 px-1 text-right">Inb</th>
                <th className="py-1 px-1 text-right">PP</th><th className="py-1 px-1 text-right">JFN</th>
                <th className="py-1 px-1 text-right">PQ</th><th className="py-1 px-1 text-right">JI</th>
                <th className="py-1 px-1 text-right">FBA</th>
              </tr></thead>
              <tbody>{cDays.map((d, i) => {
                const p = cDays[i + 1];
                const dC = p ? d.doc - p.doc : null;
                const dP = p && p.doc > 0 ? ((d.doc - p.doc) / p.doc * 100) : null;
                const bigChange = dP != null && Math.abs(dP) > 10;
                return (
                  <tr key={d.date} className={i % 2 === 0 ? "bg-gray-800/30" : ""}>
                    <td className="py-1 px-1 text-gray-300 whitespace-nowrap">{fD(d.date)}</td>
                    <td className="py-1 px-1 text-right text-white font-semibold">{D1(d.dsr)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{D1(d.d1)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{D1(d.d3)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{D1(d.d7)}</td>
                    <td className={`py-1 px-1 text-right font-semibold ${dc(d.doc, lt, lt + (core.buf || 14))}`}>{R(d.doc)}</td>
                    <td className={`py-1 px-1 text-right ${bigChange ? (dC > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold") : "text-gray-500"}`}>
                      {dC != null ? (dC > 0 ? "+" : "") + Math.round(dC) : "—"}
                    </td>
                    <td className={`py-1 px-1 text-right ${bigChange ? (dP > 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold") : "text-gray-500"}`}>
                      {dP != null ? (dP > 0 ? "+" : "") + dP.toFixed(1) + "%" : "—"}
                    </td>
                    <td className="py-1 px-1 text-right text-gray-500">{$(d.cash)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.own)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.raw)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.inb)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.pp)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.jfn)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.pq)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.ji)}</td>
                    <td className="py-1 px-1 text-right text-gray-500">{R(d.fba)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly DSR (YoY) — clean line chart, OOS as subtle indicator in table */}
      {cHF.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <h3 className="text-white font-semibold text-sm mb-2">Monthly 1-Day DSR (YoY)</h3>
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 min-w-0">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dsrCh}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={v => v >= 1000 ? Math.round(v / 1000) + 'K' : v} />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px", fontSize: 12 }} formatter={(v) => v != null ? Math.round(v).toLocaleString('en-US') : '—'} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {yrs.map(y => (
                    <Line key={y} dataKey={"d_" + y}
                      stroke={YC[y] || "#6b7280"} strokeWidth={2.5}
                      dot={{ r: 3, fill: YC[y] || "#6b7280", strokeWidth: 0 }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
                      connectNulls name={String(y)} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Table: DSR per year + OOS dot */}
            <div className="lg:w-80 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b border-gray-700">
                  <th className="py-1.5 px-1 text-left">Mo</th>
                  {yrs.map(y => (
                    <th key={y} className="py-1.5 px-2 text-right font-semibold" style={{ color: YC[y] || "#6b7280" }}>{y}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {dsrCh.map((r, i) => {
                    const hasOos = yrs.some(y => r["oos_" + y] > 0);
                    return (
                      <tr key={i} className={`${i % 2 === 0 ? "bg-gray-800/20" : ""} ${hasOos ? "border-l-2 border-red-500/60" : ""}`}>
                        <td className="py-0.5 px-1 text-gray-400">{r.month}</td>
                        {yrs.map(y => {
                          const oos = r["oos_" + y] || 0;
                          const val = r["d_" + y];
                          return (
                            <SC key={y} v={val} className="py-0.5 px-2 text-right">
                              <span className="text-white">{val != null ? R(val) : ""}</span>
                              {oos > 0 && <span className="ml-1 text-red-400 text-[9px]" title={oos + " OOS days"}>●</span>}
                            </SC>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="border-t border-gray-600 font-semibold">
                    <td className="py-1.5 px-1 text-gray-300">Avg</td>
                    {yrs.map(y => {
                      const vals = cHF.filter(h => h.y === y && h.units > 0);
                      const avg = vals.length > 0
                        ? vals.reduce((s, x) => s + (x.units || 0), 0) / vals.length
                        : 0;
                      return (
                        <SC key={y} v={avg} className="py-1.5 px-2 text-right text-white">
                          {avg > 0 ? R(avg) : ""}
                        </SC>
                      );
                    })}
                  </tr>
                  <tr className="border-t border-gray-700/50">
                    <td className="py-1 px-1 text-gray-400">Total</td>
                    {yrs.map(y => {
                      const tot = cHF.filter(h => h.y === y).reduce((s, x) => s + (x.units || 0), 0);
                      return (
                        <SC key={y} v={tot} className="py-1 px-2 text-right text-gray-300">
                          {tot > 0 ? R(tot) : ""}
                        </SC>
                      );
                    })}
                  </tr>
                  {/* OOS summary row */}
                  {cHF.some(x => x.oosDays > 0) && (
                    <tr className="border-t border-gray-700/50">
                      <td className="py-1 px-1 text-red-400 text-[10px]">OOS</td>
                      {yrs.map(y => {
                        const tot = cHF.filter(h => h.y === y).reduce((s, x) => s + (x.oosDays || 0), 0);
                        return (
                          <td key={y} className="py-1 px-2 text-right text-red-400 text-[10px]">
                            {tot > 0 ? tot + "d" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
        <h3 className="text-white font-semibold text-sm mb-3">Pipeline</h3>
        <div className="flex items-end gap-2 h-28">
          {pipe.map((p, i) => (
            <div key={p.l} className="flex-1 flex flex-col items-center">
              <span className="text-white text-xs font-semibold mb-1">{R(p.v)}</span>
              <div className="w-full rounded-t-md"
                style={{
                  height: Math.max((p.v / mxP) * 70, 4) + "px",
                  backgroundColor: i === pipe.length - 1 ? BL : i === 0 ? TL : "#6b7280"
                }} />
              <span className="text-gray-500 text-xs mt-1">{p.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bundles */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800 overflow-x-auto">
        <h3 className="text-white font-semibold text-sm mb-3">
          Bundles ({cB.length}) <span className="text-gray-500 text-xs font-normal">%28d = L28d unit weight</span>
        </h3>
        {cB.length > 0 ? (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 uppercase">
              <th className="py-2 px-1 text-left">JLS</th>
              <th className="py-2 px-1 text-left">Title</th>
              <TH tip="% of L28d units from this core" className="py-2 px-1 text-right">%28d</TH>
              <TH tip="FIB DOC" className="py-2 px-1 text-right">FIB DOC</TH>
              <TH tip="FBA DOC (Complete DOC)" className="py-2 px-1 text-right">FBA DOC</TH>
              <TH tip="Complete DSR" className="py-2 px-1 text-right">C.DSR</TH>
              <th className="py-2 px-1 border-l border-gray-700" />
              <TH tip="Gross Profit" className="py-2 px-1 text-right">GP</TH>
              <TH tip="All-In COGS" className="py-2 px-1 text-right">AICOGS</TH>
              <TH tip="Margin %" className="py-2 px-1 text-right">Margin</TH>
              <th className="py-2 px-1 border-l border-gray-700" />
              <TH tip="SC Inventory" className="py-2 px-1 text-right">SC</TH>
              <TH tip="Replen Target" className="py-2 px-1 text-right">Replen</TH>
              <th className="py-2 px-1 border-l border-gray-700" />
              <TH tip="Lifetime Revenue" className="py-2 px-1 text-right">LT Rev</TH>
              <TH tip="Lifetime Profit" className="py-2 px-1 text-right">LT Prof</TH>
              <th className="py-2 px-1 w-8" />
            </tr></thead>
            <tbody>
              {cB.map(b => {
                const f = b.fee; const sa = b.sale;
                const margin = f && f.aicogs > 0 ? ((f.gp / f.aicogs) * 100) : 0;
                const aged = agedMap[b.j]; const kill = killMap[b.j];
                return (
                  <tr key={b.j} className="border-t border-gray-800/50 hover:bg-gray-800/20">
                    <td className="py-1.5 px-1 text-blue-400 font-mono">{b.j}</td>
                    <td className="py-1.5 px-1 text-gray-200 truncate max-w-[130px]">
                      {b.t}
                      {aged && aged.fbaHealth !== "Healthy" && (
                        <span className={`ml-1 ${aged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{aged.fbaHealth}</span>
                      )}
                      {aged && aged.storageLtsf > 0 && <span className="ml-1 text-red-300">${aged.storageLtsf.toFixed(0)}</span>}
                      {kill && kill.forKill === "Yes" && <span className="ml-1 text-red-400 font-bold">KILL</span>}
                      {kill && kill.sellEval && kill.sellEval.toLowerCase().includes('sell') && <span className="ml-1 text-amber-400 font-bold">ST</span>}
                    </td>
                    <td className="py-1.5 px-1 text-right text-teal-400">{b.l28pct}%</td>
                    <td className="py-1.5 px-1 text-right">{R(b.fibDoc)}</td>
                    <td className="py-1.5 px-1 text-right">{R(b.doc)}</td>
                    <td className="py-1.5 px-1 text-right">{D1(b.cd)}</td>
                    <td className="py-1.5 px-1 border-l border-gray-700" />
                    <td className="py-1.5 px-1 text-right text-emerald-400">{f ? $2(f.gp) : "—"}</td>
                    <td className="py-1.5 px-1 text-right">{f ? $2(f.aicogs) : "—"}</td>
                    <td className="py-1.5 px-1 text-right">{margin > 0 ? P(margin) : "—"}</td>
                    <td className="py-1.5 px-1 border-l border-gray-700" />
                    <td className="py-1.5 px-1 text-right">{R(b.scInv)}</td>
                    <td className="py-1.5 px-1 text-right">{b.replenTag || "—"}</td>
                    <td className="py-1.5 px-1 border-l border-gray-700" />
                    <td className="py-1.5 px-1 text-right">{sa ? $(sa.ltR) : "—"}</td>
                    <td className="py-1.5 px-1 text-right text-emerald-400">{sa ? $(sa.ltP) : "—"}</td>
                    <td className="py-1.5 px-1">
                      <button onClick={() => goBundle(b.j)} className="text-blue-400 px-0.5 bg-blue-400/10 rounded">V</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-gray-900/60 border-t-2 border-gray-700 font-semibold">
                <td colSpan={2} className="py-2 px-1 text-gray-300">Tot</td>
                <td /><td /><td />
                <td className="py-2 px-1 text-right text-white">{D1(bT.d)}</td>
                <td />
                <td colSpan={3} />
                <td />
                <td colSpan={2} />
                <td />
                <td className="py-2 px-1 text-right text-white">{$(bT.lr)}</td>
                <td className="py-2 px-1 text-right text-emerald-400">{$(bT.lp)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        ) : <p className="text-gray-500 text-sm">No bundles.</p>}
      </div>

      {/* Purchase Rec */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h3 className="text-white font-semibold text-sm mb-3">Purchase Rec</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { l: "DOC", v: R(core.doc), c: dc(core.doc, lt, lt + (core.buf || 14)) },
            { l: "Need " + tg + "d", v: R(nq) },
            { l: "Order(MOQ:" + R(core.moq) + ")", v: R(oq) },
            { l: "Cost", v: $(oq * core.cost), c: "text-amber-300" },
            { l: "After DOC", v: oq > 0 ? R(da) : "—", c: "text-emerald-400" }
          ].map(k => (
            <div key={k.l}>
              <div className="text-gray-500 text-xs">{k.l}</div>
              <div className={`text-lg font-bold ${k.c || "text-white"}`}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
