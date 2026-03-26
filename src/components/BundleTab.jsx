import React, { useState, useMemo, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { R, D1, $, $2, P, MN, YC, TTP, gS, gY, cMo, fD } from "../lib/utils";
import { Dot, TH, AbcBadge, HealthBadge, KillBadge, SumCtx } from "./Shared";

function SC({ v, children, className }) {
  const { addCell } = React.useContext(SumCtx);
  const [sel, setSel] = React.useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

export default function BundleTab({ data, stg, hist, daily, bundleId, onBack, goCore }) {
  const [s, setS] = useState("");
  const [sel, setSel] = useState(bundleId || null);
  const [abcSort, setAbcSort] = useState("rev");
  const [abcFilter, setAbcFilter] = useState("");
  const [abcSF, setAbcSF] = useState("");
  const [abcLimit, setAbcLimit] = useState(50);
  useEffect(() => { if (bundleId) setSel(bundleId) }, [bundleId]);

  const b = sel ? (data.bundles || []).find(x => x.j === sel) : null;
  const fee = b ? (data.fees || []).find(f => f.j === b.j) : null;
  const sale = b ? (data.sales || []).find(s => s.j === b.j) : null;
  const core = b ? (data.cores || []).find(c => c.id === b.core1) : null;
  const abcA = useMemo(() => data.abcA || [], [data.abcA]);
  const abcT = useMemo(() => data.abcT || [], [data.abcT]);
  const bAbc = sel ? abcA.find(a => a.j === sel) : null;
  const bTrend = sel ? abcT.find(t => t.j === sel) : null;
  const agedMap = useMemo(() => { const m = {}; (data.agedInv || []).forEach(r => m[r.j] = r); return m }, [data.agedInv]);
  const killMap = useMemo(() => { const m = {}; (data.killMgmt || []).forEach(r => m[r.j] = r); return m }, [data.killMgmt]);
  const bAged = sel ? agedMap[sel] : null;
  const bKill = sel ? killMap[sel] : null;
  const bStatus = b ? gS(b.doc, 60, 30, { critDays: 30, warnDays: 60 }) : "healthy";

  // === INBOUND TO WAREHOUSE (from 7f inbound data, filtered by bundle's cores) ===
  const coreInbound = useMemo(() => {
    if (!b) return { pcs: 0, eta: null };
    const cores = [b.core1, b.core2, b.core3].filter(Boolean);
    const inbs = (data.inbound || []).filter(i => cores.includes(i.core));
    const totalPcs = inbs.reduce((s, i) => s + (i.pieces || 0), 0);
    // Get earliest future ETA
    const etas = inbs.map(i => i.eta).filter(Boolean).sort();
    return { pcs: totalPcs, eta: etas.length > 0 ? etas[etas.length - 1] : null };
  }, [data.inbound, b]);

  // Bundle inventory history (merged summary + daily aggregation) → Units = sum of Complete DSR
  const bInv = useMemo(() => (hist?.bundleInv || []).filter(h => h.j === sel), [hist, sel]);
  const uYrs = useMemo(() => gY(bInv), [bInv]);
  const yD = useMemo(() => MN.map((m, i) => {
    const r = { month: m };
    uYrs.forEach(y => {
      const x = bInv.find(h => h.y === y && h.m === i + 1);
      r["u_" + y] = x?.units > 0 ? x.units : (x?.avgDsr > 0 && x?.dataDays > 0 ? Math.round(x.avgDsr * x.dataDays) : null);
    });
    return r;
  }), [bInv, uYrs]);
  const uYTot = useMemo(() => {
    const t = {};
    uYrs.forEach(y => {
      t[y] = bInv.filter(h => h.y === y).reduce((s, x) => {
        const u = x.units > 0 ? x.units : (x.avgDsr > 0 && x.dataDays > 0 ? Math.round(x.avgDsr * x.dataDays) : 0);
        return s + u;
      }, 0);
    });
    return t;
  }, [bInv, uYrs]);

  // Daily (last 14d)
  const bDays = useMemo(() => (daily?.bundleDays || []).filter(d => d.j === sel).sort((a, x) => x.date.localeCompare(a.date)).slice(0, 14), [daily, sel]);

  // Price history
  const priceHist = useMemo(() => (hist?.priceHist || []).filter(h => h.j === sel).sort((a, b) => a.y === b.y ? a.m - b.m : a.y - b.y), [hist, sel]);
  const pYrs = useMemo(() => gY(priceHist), [priceHist]);
  const pCh = useMemo(() => MN.map((m, i) => { const r = { month: m }; pYrs.forEach(y => { const x = priceHist.find(h => h.y === y && h.m === i + 1); r["p_" + y] = x?.avgPrice ?? null }); return r }), [priceHist, pYrs]);

  // Active bundle filter set
  const activeBundleSet = useMemo(() => {
    const bA = stg.bA || "yes";
    const bI = stg.bI || "blank";
    const set = new Set();
    (data.bundles || []).forEach(b => {
      if (bA === "yes" && b.active !== "Yes") return;
      if (bA === "no" && b.active === "Yes") return;
      if (bI === "blank" && !!b.ignoreUntil) return;
      if (bI === "set" && !b.ignoreUntil) return;
      set.add(b.j);
    });
    return set;
  }, [data.bundles, stg]);

  // ABC sorted + deduped + filtered
  const abcSorted = useMemo(() => {
    let arr = [...abcA].filter(a => activeBundleSet.has(a.j)).sort((a, b) => abcSort === "rev" ? (b.rev - a.rev) : abcSort === "profit" ? (b.profit - a.profit) : (b.units - a.units));
    const seen = {};
    arr = arr.filter(a => { if (seen[a.j]) return false; seen[a.j] = true; return true });
    if (abcFilter) arr = arr.filter(a => a.profABC === abcFilter);
    if (abcSF) arr = arr.filter(a => a.t.toLowerCase().includes(abcSF.toLowerCase()) || a.j.toLowerCase().includes(abcSF.toLowerCase()));
    return arr;
  }, [abcA, abcSort, abcFilter, abcSF, activeBundleSet]);

  // === SEARCH VIEW ===
  if (!b) return <div className="p-4 max-w-5xl mx-auto">
    <div className="flex items-center gap-3 mb-4">
      <button onClick={onBack} className="text-gray-400 hover:text-white text-sm">← Back</button>
      <input type="text" placeholder="Search JLS# or ASIN..." value={s} onChange={e => setS(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 max-w-md text-sm" />
    </div>
    {s.length >= 2 ? <div className="space-y-1">{(data.bundles || []).filter(x => {
      if (!activeBundleSet.has(x.j)) return false;
      const q = s.toLowerCase(); return x.j.toLowerCase().includes(q) || x.t.toLowerCase().includes(q) || (x.asin && x.asin.toLowerCase().includes(q));
    }).slice(0, 12).map(x => {
      const xS = gS(x.doc, 60, 30, { critDays: 30, warnDays: 60 });
      const xA = agedMap[x.j]; const xK = killMap[x.j];
      return <button key={x.j} onClick={() => setSel(x.j)} className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3">
        <Dot status={xS} />
        <span className="text-blue-400 font-mono text-sm">{x.j}</span>
        <span className="text-gray-300 text-sm truncate flex-1">{x.t}</span>
        {x.asin && <span className="text-gray-500 text-xs">{x.asin}</span>}
        {xA && xA.fbaHealth !== "Healthy" && <span className={`text-xs ${xA.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{xA.fbaHealth}</span>}
        {xK && xK.forKill === "Yes" && <span className="text-xs text-red-400 font-bold">KILL</span>}
      </button>;
    })}</div> : <div>
      {abcA.length > 0 && <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-white font-semibold text-sm">ABC Analysis</h3>
          <div className="flex gap-2">
            <input type="text" placeholder="Filter..." value={abcSF} onChange={e => setAbcSF(e.target.value)} className="bg-gray-800 border border-gray-700 text-white text-xs rounded px-2 py-1 w-32" />
            <select value={abcFilter} onChange={e => setAbcFilter(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1"><option value="">All ABC</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select>
            <select value={abcSort} onChange={e => setAbcSort(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1"><option value="rev">Revenue ↓</option><option value="profit">Profit ↓</option><option value="units">Units ↓</option></select>
          </div>
        </div>
        {data.abcSub && <p className="text-gray-400 text-xs mb-3">{data.abcSub}</p>}
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase"><th className="py-1 px-2 w-6" /><th className="py-1 px-2 text-left">JLS</th><th className="py-1 px-2 text-left">Title</th><th className="py-1 px-2 text-right">Revenue</th><th className="py-1 px-2 text-right">Profit</th><th className="py-1 px-2 text-right">Units</th><th className="py-1 px-2 text-center">ABC</th></tr></thead>
          <tbody>{abcSorted.slice(0, abcLimit).map((a, i) => {
            const bs = gS(((data.bundles || []).find(x => x.j === a.j) || {}).doc || 999, 60, 30, { critDays: 30, warnDays: 60 });
            const xA = agedMap[a.j]; const xK = killMap[a.j];
            return <tr key={a.j + "-" + i} className="border-t border-gray-800/30 hover:bg-gray-800/20 cursor-pointer" onClick={() => setSel(a.j)}>
              <td className="py-1.5 px-2"><Dot status={bs} /></td>
              <td className="py-1.5 px-2 text-blue-400 font-mono">{a.j}</td>
              <td className="py-1.5 px-2 text-gray-200 truncate max-w-[200px]">
                {a.t}
                {xA && xA.fbaHealth !== "Healthy" && <span className={`ml-1 text-xs ${xA.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{xA.fbaHealth}</span>}
                {xK && xK.forKill === "Yes" && <span className="ml-1 text-xs text-red-400 font-bold">KILL</span>}
              </td>
              <td className="py-1.5 px-2 text-right">{$(a.rev)}</td>
              <td className="py-1.5 px-2 text-right text-emerald-400">{$(a.profit)}</td>
              <td className="py-1.5 px-2 text-right">{R(a.units)}</td>
              <td className="py-1.5 px-2 text-center"><AbcBadge grade={a.profABC} /></td>
            </tr>;
          })}</tbody></table></div>
          {abcLimit < abcSorted.length && <div className="mt-3 text-center"><button onClick={() => setAbcLimit(p => p + 50)} className="text-sm text-blue-400 hover:text-white bg-blue-400/10 px-4 py-2 rounded">Load More ({abcSorted.length - abcLimit} remaining)</button></div>}
      </div>}
    </div>}
  </div>;

  // === DETAIL VIEW ===
  return <div className="p-4 max-w-7xl mx-auto">
    <button onClick={() => { setSel(null); onBack() }} className="text-gray-400 hover:text-white text-sm mb-4">← Back</button>
    {/* Header */}
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-xl font-bold text-white">{b.j}</span>
        <Dot status={bStatus} />
        {core && <button onClick={() => goCore(core.id)} className="text-blue-400 text-xs bg-blue-400/10 px-2 py-0.5 rounded">→{core.id}</button>}
        {bAbc && <AbcBadge grade={bAbc.profABC} />}
        {bTrend && <><span className="text-xs text-gray-400">Q1'26: {bTrend.q1_26 || "—"}</span><span className="text-xs text-gray-400">Trend: {bTrend.movement || "—"}</span></>}
        {bAged && bAged.fbaHealth !== "Healthy" && <span className={`text-xs font-semibold ${bAged.fbaHealth === "At Risk" ? "text-amber-400" : "text-red-400"}`}>{bAged.fbaHealth}</span>}
        {bAged && bAged.action && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">AMZ: {bAged.action}</span>}
        {bKill && <KillBadge eval={bKill.latestEval || bKill.sellEval} />}
      </div>
      <p className="text-gray-300 text-sm">{b.t}</p>
      <p className="text-gray-500 text-xs">
        {b.asin && <a href={`https://sellercentral.amazon.com/myinventory/inventory?fulfilledBy=all&page=1&pageSize=25&searchField=all&searchTerm=${b.asin}&sort=date_created_desc&status=all`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline underline decoration-dotted">{b.asin} ↗</a>}
        {b.asin && " · "}{b.vendors}
      </p>
    </div>
    {/* KPI Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h4 className="text-gray-500 text-xs uppercase mb-3">Sales & Inventory</h4><div className="grid grid-cols-4 gap-y-4">{[
        { l: "C.DSR", v: D1(b.cd) },
        { l: "DOC", v: R(b.doc) },
        { l: "FIB DOC", v: R(b.fibDoc) },
        { l: "FIB Inventory", v: R(b.fibInv) },
        { l: "SC Inventory", v: R(b.scInv) },
        { l: "Pre-Processed", v: R(b.reserved) },
        { l: "Inbound to FBA", v: R(b.inbound) },
        { l: "Raw Pieces", v: R(core?.raw ?? 0) },
        ...(coreInbound.pcs > 0 ? [{ l: "Inbound to WH", v: R(coreInbound.pcs), sub: coreInbound.eta ? "ETA: " + fD(coreInbound.eta) : null }] : []),
      ].map(k => <div key={k.l}><div className="text-gray-500 text-xs">{k.l}</div><div className="text-white font-bold text-lg">{k.v}</div>{k.sub && <div className="text-blue-400 text-xs">{k.sub}</div>}</div>)}</div></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h4 className="text-gray-500 text-xs uppercase mb-3">Profitability</h4><div className="grid grid-cols-3 gap-y-4">{[{ l: "Price", v: fee?.pr }, { l: "COGS", v: fee?.pdmtCogs }, { l: "AICOGS", v: fee?.aicogs }, { l: "Fee", v: fee?.totalFee }, { l: "GP", v: fee?.gp, c: "text-emerald-400" }].map(k => <div key={k.l}><div className="text-gray-500 text-xs">{k.l}</div><div className={`font-bold text-lg ${k.c || "text-white"}`}>{k.v != null ? $2(k.v) : "—"}</div></div>)}</div></div>
    </div>
    {/* Revenue Table */}
    {sale && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Revenue</h3><table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs uppercase"><th className="py-2 text-left" /><th className="py-2 text-right border-r border-gray-700">Lifetime</th><th className="py-2 text-right">Last Year</th><th className="py-2 text-right border-r border-gray-700">%LT</th><th className="py-2 text-right">This Year</th><th className="py-2 text-right">%LT</th></tr></thead><tbody><tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Revenue</td><td className="py-2 text-right text-white border-r border-gray-700">{$(sale.ltR)}</td><td className="py-2 text-right">{$(sale.lyR)}</td><td className="py-2 text-right text-gray-400 text-xs border-r border-gray-700">{sale.ltR > 0 ? P(sale.lyR / sale.ltR * 100) : ""}</td><td className="py-2 text-right">{$(sale.tyR)}</td><td className="py-2 text-right text-gray-400 text-xs">{sale.ltR > 0 ? P(sale.tyR / sale.ltR * 100) : ""}</td></tr><tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Profit</td><td className="py-2 text-right text-emerald-400 border-r border-gray-700">{$(sale.ltP)}</td><td className="py-2 text-right text-emerald-400">{$(sale.lyP)}</td><td className="py-2 text-right text-gray-400 text-xs border-r border-gray-700">{sale.ltP > 0 ? P(sale.lyP / sale.ltP * 100) : ""}</td><td className="py-2 text-right text-emerald-400">{$(sale.tyP)}</td><td className="py-2 text-right text-gray-400 text-xs">{sale.ltP > 0 ? P(sale.tyP / sale.ltP * 100) : ""}</td></tr></tbody></table></div>}
    {/* Daily */}
    {bDays.length > 0 && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Daily ({bDays.length}d)</h3><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase"><th className="py-1 px-1 text-left">Date</th><th className="py-1 px-1 text-right">DSR</th><th className="py-1 px-1 text-right">1D</th><th className="py-1 px-1 text-right">3D</th><th className="py-1 px-1 text-right">7D</th><th className="py-1 px-1 text-right">DOC</th><th className="py-1 px-1 text-right">FIB</th><th className="py-1 px-1 text-right">SC</th><th className="py-1 px-1 text-right">Res</th><th className="py-1 px-1 text-right">Inb</th><th className="py-1 px-1 text-right">Cash</th></tr></thead><tbody>{bDays.map((d, i) => <tr key={d.date} className={i % 2 === 0 ? "bg-gray-800/30" : ""}><td className="py-1 px-1 text-gray-300 whitespace-nowrap">{fD(d.date)}</td><td className="py-1 px-1 text-right text-white font-semibold">{D1(d.dsr)}</td><td className="py-1 px-1 text-right">{D1(d.d1)}</td><td className="py-1 px-1 text-right">{D1(d.d3)}</td><td className="py-1 px-1 text-right">{D1(d.d7)}</td><td className="py-1 px-1 text-right">{R(d.doc)}</td><td className="py-1 px-1 text-right">{R(d.fib)}</td><td className="py-1 px-1 text-right">{R(d.sc)}</td><td className="py-1 px-1 text-right">{R(d.res)}</td><td className="py-1 px-1 text-right">{R(d.inb)}</td><td className="py-1 px-1 text-right">{$(d.cash)}</td></tr>)}</tbody></table></div></div>}
    {/* Recent Sales */}
    {sale && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Recent</h3><div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{[{ l: "This Mo", u: sale.tmU, r: sale.tmR, p: sale.tmP }, { l: "Last Mo", u: sale.lmU, r: sale.lmR, p: sale.lmP }, { l: "7d", u: sale.l7U, r: sale.l7R, p: sale.l7P }, { l: "28d", u: sale.l28U, r: sale.l28R, p: sale.l28P }].map(x => <div key={x.l}><div className="text-gray-500 text-xs">{x.l}</div><div className="text-white font-semibold">{R(x.u)} u</div><div className="text-gray-400 text-xs">{$(x.r)}</div><div className="text-emerald-400 text-xs">{$(x.p)}</div></div>)}</div></div>}
    {/* YoY Units (sum of Complete DSR) + Price History */}
    {bInv.length > 0 && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <h3 className="text-white font-semibold text-sm mb-2">YoY Units & Price</h3>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={yD}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <Tooltip {...TTP} />
              <Legend />
              {uYrs.map(y => <Bar key={y} dataKey={"u_" + y} fill={YC[y] || "#6b7280"} opacity={0.85} radius={[2, 2, 0, 0]} name={"Units " + y} />)}
            </BarChart>
          </ResponsiveContainer>
          {priceHist.length > 0 && <ResponsiveContainer width="100%" height={140}>
            <LineChart data={pCh}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip {...TTP} />
              <Legend />
              {pYrs.map(y => <Line key={y} dataKey={"p_" + y} stroke={YC[y] || "#6b7280"} strokeWidth={2} dot={{ r: 2 }} connectNulls name={"$" + y} />)}
            </LineChart>
          </ResponsiveContainer>}
        </div>
        <div className="lg:w-72 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500">
              <th className="py-1 px-1 text-left">Mo</th>
              {uYrs.map(y => <th key={y} className="py-1 px-1 text-right" style={{ color: YC[y] || "#6b7280" }}>{y}</th>)}
            </tr></thead>
            <tbody>
              {yD.map((r, i) => <tr key={i} className={i % 2 === 0 ? "bg-gray-800/20" : ""}>
                <td className="py-0.5 px-1 text-gray-300">{r.month}</td>
                {uYrs.map(y => <SC key={y} v={r["u_" + y]} className="py-0.5 px-1 text-right text-white">{r["u_" + y] != null ? R(r["u_" + y]) : ""}</SC>)}
              </tr>)}
              <tr className="border-t border-gray-700 font-semibold">
                <td className="py-1 px-1">Total</td>
                {uYrs.map(y => <SC key={y} v={uYTot[y]} className="py-1 px-1 text-right text-white">{R(uYTot[y])}</SC>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>}
  </div>;
}
