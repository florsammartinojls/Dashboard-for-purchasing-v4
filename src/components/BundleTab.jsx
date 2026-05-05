import React, { useState, useMemo, useEffect, useContext } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { R, D1, $, $2, P, MN, YC, TTP, gS, gY, cMo, fD, resolveVendorFromBundle } from "../lib/utils";
import { Dot, TH, AbcBadge, HealthBadge, KillBadge, SumCtx, CopyableId } from "./Shared";
import { SegmentCtx, WhyBuyCtx } from "../App";
import { SegmentBadge, ConfidenceBadge } from "./SegmentBadges";

function SC({ v, children, className }) {
  const { addCell } = React.useContext(SumCtx);
  const [sel, setSel] = React.useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

// Sprint 2: BundleTab now reads buy/coverage figures from the v4
// waterfall (vendorRecs[v].bundleDetails). DOC, buyNeed, coresUsed,
// segment etc. all come from the engine — never recomputed here.
// Legacy raw fields (b.cd, FIB DOC, sale, fee, replen) stay for the
// operational sections that don't depend on the engine.
export default function BundleTab({ data, stg, vendorRecs, hist, daily, bundleId, onBack, goCore }) {
  const [s, setS] = useState("");
  const [sel, setSel] = useState(bundleId || null);
  const [abcSort, setAbcSort] = useState("rev");
  const [abcFilter, setAbcFilter] = useState("");
  const [abcSF, setAbcSF] = useState("");
  const [abcLimit, setAbcLimit] = useState(50);
  useEffect(() => { if (bundleId) setSel(bundleId) }, [bundleId]);

  const segCtx = useContext(SegmentCtx);
  const whyBuy = useContext(WhyBuyCtx);
  const segRec = sel ? segCtx.effectiveMap[sel] : null;
  const b = sel ? (data.bundles || []).find(x => x.j === sel) : null;
  const fee = b ? (data.fees || []).find(f => f.j === b.j) : null;
  const replen = b ? (data.replenRec || []).find(r => r.j === b.j) : null;

  // ─── v4 waterfall lookup (single source of truth) ───
  // Walks vendorRecs and returns the first {rec, bd} pair that contains
  // this bundle. Also returns vendorName so callers (Why buy?) get a
  // resolved key without needing to re-split b.vendors.
  const bundleDetail = useMemo(() => {
    if (!sel || !vendorRecs) return null;
    for (const [vendorName, rec] of Object.entries(vendorRecs)) {
      const bd = rec?.bundleDetails?.find(x => x.bundleId === sel);
      if (bd) return { rec, bd, vendorName };
    }
    return null;
  }, [sel, vendorRecs]);
  const bd = bundleDetail?.bd || null;
  const recVendorName = bundleDetail?.vendorName || null;

  // First core: prefer waterfall coresUsed; fall back to legacy core1.
  const firstCoreId = bd?.coresUsed?.[0]?.coreId || b?.core1 || null;
  const core = firstCoreId ? (data.cores || []).find(c => c.id === firstCoreId) : null;
  const abcA = useMemo(() => data.abcA || [], [data.abcA]);
  const abcT = useMemo(() => data.abcT || [], [data.abcT]);
  const bAbc = sel ? abcA.find(a => a.j === sel) : null;
  const bTrend = sel ? abcT.find(t => t.j === sel) : null;
  const agedMap = useMemo(() => { const m = {}; (data.agedInv || []).forEach(r => m[r.j] = r); return m }, [data.agedInv]);
  const killMap = useMemo(() => { const m = {}; (data.killMgmt || []).forEach(r => m[r.j] = r); return m }, [data.killMgmt]);
  const bAged = sel ? agedMap[sel] : null;
  const bKill = sel ? killMap[sel] : null;
  // Engine DOC takes precedence over the legacy sheet doc once the rec
  // is present. When the engine doesn't process this bundle we fall back
  // to the sheet so the header isn't blank, but the KPI grid below will
  // show "—" to make the absence explicit.
  const docForStatus = bd?.currentCoverDOC ?? b?.doc ?? 0;
  const bStatus = b ? gS(docForStatus, 60, 30, { critDays: 30, warnDays: 60 }) : "healthy";
  const sale = b ? (data.sales || []).find(s => s.j === b.j) : null;

  // === INBOUND 7f — split into core units + bundle units ===
  // Sprint 3 Fix 11 isolated core-tagged rows so the "core units"
  // KPI matched its label. The mini-fix that follows surfaces
  // bundle-tagged rows (vendor delivers fully assembled bundles)
  // alongside, since the operator needs visibility on both. Same
  // filtering pattern as pre-Sprint-3, just split into two groups.
  const inb7fCore = useMemo(() => {
    if (!b) return { rows: [], pieces: 0, lastDate: null };
    const cores = [b.core1, b.core2, b.core3].filter(Boolean);
    const ids = new Set(cores.map(x => (x || "").trim().toLowerCase()));
    if (ids.size === 0) return { rows: [], pieces: 0, lastDate: null };
    const rows = (data.inbound || []).filter(i => ids.has((i.core || "").trim().toLowerCase()));
    const pieces = rows.reduce((s, i) => s + (Number(i.pieces) || 0), 0);
    // `eta` is the operator-curated arrival; falls back to `origEta`
    // (the originally-promised date) when eta hasn't been refreshed.
    const dates = rows.map(i => i.eta || i.origEta).filter(Boolean).sort();
    return { rows, pieces, lastDate: dates.length ? dates[dates.length - 1] : null };
  }, [data.inbound, b]);
  const inb7fBundle = useMemo(() => {
    if (!b || !b.j) return { rows: [], pieces: 0, lastDate: null };
    const target = b.j.trim().toLowerCase();
    const rows = (data.inbound || []).filter(i => (i.core || "").trim().toLowerCase() === target);
    const pieces = rows.reduce((s, i) => s + (Number(i.pieces) || 0), 0);
    const dates = rows.map(i => i.eta || i.origEta).filter(Boolean).sort();
    return { rows, pieces, lastDate: dates.length ? dates[dates.length - 1] : null };
  }, [data.inbound, b]);
  
  // Bundle inventory history (merged summary + daily aggregation) → Units = sum of Complete DSR
  const bInv = useMemo(() => (hist?.bundleSales || []).filter(h => h.j === sel), [hist, sel]);
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

  // Sprint 3 Fix 12: distinguish "past month with 0 sales" from "future
  // month, no data yet" in the YoY table. Past-empty → render 0; future
  // → render "—". Computed once per render so YoY cells can branch.
  const today = useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const isMonthInPast = (y, m) => (y < currentYear) || (y === currentYear && m <= currentMonth);
  const isMonthInFuture = (y, m) => (y > currentYear) || (y === currentYear && m > currentMonth);

  // Sprint 3 Fix 13: month-to-date units (sum of daily DSR for the
  // current month). Sourced from the full daily series (not the 14-day
  // slice) so it captures the whole month even early in the month.
  const mtdUnits = useMemo(() => {
    if (!sel || !daily?.bundleDays) return 0;
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    let sum = 0;
    for (const d of daily.bundleDays) {
      if (!d || d.j !== sel || !d.date) continue;
      const dt = new Date(d.date);
      if (isNaN(dt.getTime())) continue;
      if (dt >= monthStart && dt <= today) sum += Number(d.dsr) || 0;
    }
    return Math.round(sum);
  }, [sel, daily, currentYear, currentMonth, today]);

  // Price history (bundle-level YoY from history pipeline)
  const priceHist = useMemo(() => (hist?.priceHist || []).filter(h => h.j === sel).sort((a, b) => a.y === b.y ? a.m - b.m : a.y - b.y), [hist, sel]);

 // === YoY series — all four metrics derive from hist.bundleSales ===
  // Sprint 6 overhaul: replaces the priceHist + CPP fallback chain.
  // bundleSales has ~95.6% avgPrice coverage and 100% profit coverage,
  // so the legacy fallback path (derivedPriceHist using priceCompFull
  // CPP) is no longer needed. Profit can be negative — null check is
  // explicit (`!= null`), not truthy.
  const pCh = useMemo(() => MN.map((m, i) => {
    const r = { month: m };
    uYrs.forEach(y => {
      const x = bInv.find(h => h.y === y && h.m === i + 1);
      r["p_" + y] = x?.avgPrice > 0 ? x.avgPrice : null;
    });
    return r;
  }), [bInv, uYrs]);

  const rCh = useMemo(() => MN.map((m, i) => {
    const r = { month: m };
    uYrs.forEach(y => {
      const x = bInv.find(h => h.y === y && h.m === i + 1);
      r["r_" + y] = x?.rev > 0 ? x.rev : null;
    });
    return r;
  }), [bInv, uYrs]);

  const profCh = useMemo(() => MN.map((m, i) => {
    const r = { month: m };
    uYrs.forEach(y => {
      const x = bInv.find(h => h.y === y && h.m === i + 1);
      r["pr_" + y] = x?.profit != null ? x.profit : null;
    });
    return r;
  }), [bInv, uYrs]);

  // Year totals (used in legends — weighted avg price = totalRev/totalUnits).
  const totals = useMemo(() => {
    const t = {};
    uYrs.forEach(y => {
      const rows = bInv.filter(h => h.y === y);
      const totalRev = rows.reduce((s, x) => s + (x.rev || 0), 0);
      const totalProfit = rows.reduce((s, x) => s + (x.profit || 0), 0);
      const totalUnits = rows.reduce((s, x) => {
        const u = x.units > 0 ? x.units : (x.avgDsr > 0 && x.dataDays > 0 ? Math.round(x.avgDsr * x.dataDays) : 0);
        return s + u;
      }, 0);
      t[y] = { rev: totalRev, profit: totalProfit, avgPrice: totalUnits > 0 ? totalRev / totalUnits : null };
    });
    return t;
  }, [bInv, uYrs]);

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
    <button onClick={() => { if (bundleId) onBack(); else setSel(null); }} className="text-gray-400 hover:text-white text-sm mb-4">← Back</button>
    {/* Header */}
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <CopyableId value={b.j} className="text-xl font-bold text-white" />
        <Dot status={bStatus} />
        {core && <button onClick={() => goCore(core.id)} className="text-blue-400 text-xs bg-blue-400/10 px-2 py-0.5 rounded">→{core.id}</button>}
        {bAbc && <AbcBadge grade={bAbc.profABC} />}
        {segRec && (
          <span className="flex items-center gap-1.5" title={segRec.reason}>
            <SegmentBadge segment={segRec.segment} override={segRec.override !== segRec.segment ? segRec.override : null} />
            <ConfidenceBadge confidence={segRec.confidence} />
          </span>
        )}
        {b && (
          <button
            onClick={() => whyBuy.open({ bundleId: b.j, vendorName: recVendorName || resolveVendorFromBundle(b.vendors, vendorRecs) })}
            className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
            title="Why Buy? — full audit trail"
          >📊 Why buy?</button>
        )}
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
    {/* Engine status banner — visible whenever the bundle isn't in any rec */}
    {!bd && (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3 text-xs text-amber-300">
        ⚠ Bundle not processed by the engine — check configuration (active/ignoreUntil/no vendor mapped). Waterfall figures shown as "—".
      </div>
    )}
    {/* KPI Cards — Sprint 3 Fix 11: split into Sheet Data, Engine Calculations, Profitability */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h4 className="text-gray-500 text-xs uppercase mb-3 flex items-center gap-2">
          Sheet Data
          <span className="text-[9px] text-gray-600 normal-case font-normal" title="Values read directly from the live sheet — no engine logic applied.">direct from sheet</span>
        </h4>
        <div className="grid grid-cols-2 gap-y-4">{[
          { l: "C.DSR", v: D1(b.cd) },
          { l: "FIB Inventory", v: R(b.fibInv) },
          { l: "SC Inventory", v: R(b.scInv) },
          { l: "Pre-Processed", v: R(replen?.pprcUnits ?? b.reserved) },
          { l: "Inbound to FBA", v: R(b.inbound) },
          { l: "Raw Pieces (core)", v: R(core?.raw ?? 0) },
          // Sprint 3 mini-fix: Inbound 7f split into core + bundle so
          // the operator can see assembled-bundle inbound separately.
          // Adjacent in the grid for easy comparison. Subtitle is the
          // most recent ETA among contributing rows (origEta when the
          // operator hasn't refreshed eta yet); shows "—" when empty.
          {
            l: "Inbound 7f (core units)",
            v: R(inb7fCore.pieces),
            sub: inb7fCore.lastDate ? "Last update: " + fD(inb7fCore.lastDate) : "Last update: —",
          },
          {
            l: "Inbound 7f (bundle units)",
            v: R(inb7fBundle.pieces),
            sub: inb7fBundle.lastDate ? "Last update: " + fD(inb7fBundle.lastDate) : "Last update: —",
          },
        ].map(k => <div key={k.l}><div className="text-gray-500 text-xs">{k.l}</div><div className={`font-bold text-lg ${k.c || "text-white"}`}>{k.v}</div>{k.sub && <div className="text-gray-500 text-[10px] mt-0.5">{k.sub}</div>}</div>)}</div>
      </div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h4 className="text-emerald-400/90 text-xs uppercase mb-3 flex items-center gap-2">
          ⚙ Engine Calculations
          <span className="text-[9px] text-gray-600 normal-case font-normal" title="Computed by the v4 recommender (segment-aware forecast + waterfall). See the Why Buy panel for the full audit trail.">v4 waterfall</span>
        </h4>
        <div className="grid grid-cols-2 gap-y-4">{[
          // Engine DOC = currentCoverDOC from waterfall — same number as Purchasing's "After/effective" column.
          { l: "DOC (engine)", v: bd ? R(bd.currentCoverDOC) : "—", c: bd ? "text-white" : "text-gray-600" },
          { l: "Buy Need", v: bd ? (bd.buyNeed > 0 ? R(bd.buyNeed) : "0") : "—", c: bd && bd.buyNeed > 0 ? "text-amber-300" : (bd ? "text-gray-400" : "text-gray-600") },
          { l: "Coverage demand", v: bd ? R(bd.coverageDemand) : "—" },
          { l: "Total available", v: bd ? R(bd.totalAvailable) : "—" },
          { l: "FIB DOC", v: R(b.fibDoc) },
        ].map(k => <div key={k.l}><div className="text-gray-500 text-xs">{k.l}</div><div className={`font-bold text-lg ${k.c || "text-white"}`}>{k.v}</div></div>)}</div>
      </div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h4 className="text-gray-500 text-xs uppercase mb-3">Profitability</h4>
        <div className="grid grid-cols-2 gap-y-4">{[{ l: "Price", v: fee?.pr }, { l: "COGS", v: fee?.pdmtCogs }, { l: "AICOGS", v: fee?.aicogs }, { l: "Fee", v: fee?.totalFee }, { l: "GP", v: fee?.gp, c: "text-emerald-400" }].map(k => <div key={k.l}><div className="text-gray-500 text-xs">{k.l}</div><div className={`font-bold text-lg ${k.c || "text-white"}`}>{k.v != null ? $2(k.v) : "—"}</div></div>)}</div>
      </div>
    </div>
    {/* Revenue Table */}
    {sale && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Revenue</h3><table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs uppercase"><th className="py-2 text-left" /><th className="py-2 text-right border-r border-gray-700">Lifetime</th><th className="py-2 text-right">Last Year</th><th className="py-2 text-right border-r border-gray-700">%LT</th><th className="py-2 text-right">This Year</th><th className="py-2 text-right">%LT</th></tr></thead><tbody><tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Revenue</td><td className="py-2 text-right text-white border-r border-gray-700">{$(sale.ltR)}</td><td className="py-2 text-right">{$(sale.lyR)}</td><td className="py-2 text-right text-gray-400 text-xs border-r border-gray-700">{sale.ltR > 0 ? P(sale.lyR / sale.ltR * 100) : ""}</td><td className="py-2 text-right">{$(sale.tyR)}</td><td className="py-2 text-right text-gray-400 text-xs">{sale.ltR > 0 ? P(sale.tyR / sale.ltR * 100) : ""}</td></tr><tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Profit</td><td className="py-2 text-right text-emerald-400 border-r border-gray-700">{$(sale.ltP)}</td><td className="py-2 text-right text-emerald-400">{$(sale.lyP)}</td><td className="py-2 text-right text-gray-400 text-xs border-r border-gray-700">{sale.ltP > 0 ? P(sale.lyP / sale.ltP * 100) : ""}</td><td className="py-2 text-right text-emerald-400">{$(sale.tyP)}</td><td className="py-2 text-right text-gray-400 text-xs">{sale.ltP > 0 ? P(sale.tyP / sale.ltP * 100) : ""}</td></tr></tbody></table></div>}
    {/* Daily */}
    {bDays.length > 0 && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Daily ({bDays.length}d)</h3><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase"><th className="py-1 px-1 text-left">Date</th><th className="py-1 px-1 text-right">DSR</th><th className="py-1 px-1 text-right">1D</th><th className="py-1 px-1 text-right">3D</th><th className="py-1 px-1 text-right">7D</th><th className="py-1 px-1 text-right">DOC</th><th className="py-1 px-1 text-right">FIB DOC</th><th className="py-1 px-1 text-right">FIB Inv</th><th className="py-1 px-1 text-right">SC Inv</th><th className="py-1 px-1 text-right">Res</th><th className="py-1 px-1 text-right">Inb</th><th className="py-1 px-1 text-right">BRaw</th><th className="py-1 px-1 text-right">BPPR</th></tr></thead><tbody>{bDays.map((d, i) => <tr key={d.date} className={i % 2 === 0 ? "bg-gray-800/30" : ""}><td className="py-1 px-1 text-gray-300 whitespace-nowrap">{fD(d.date)}</td><td className="py-1 px-1 text-right text-white font-semibold">{D1(d.dsr)}</td><td className="py-1 px-1 text-right">{D1(d.d1)}</td><td className="py-1 px-1 text-right">{D1(d.d3)}</td><td className="py-1 px-1 text-right">{D1(d.d7)}</td><td className="py-1 px-1 text-right">{R(d.doc)}</td><td className="py-1 px-1 text-right">{d.dsr > 0 && d.fib > 0 ? R(Math.round(d.fib / d.dsr)) : "—"}</td><td className="py-1 px-1 text-right">{R(d.fib)}</td><td className="py-1 px-1 text-right">{R(d.sc)}</td><td className="py-1 px-1 text-right">{R(d.res)}</td><td className="py-1 px-1 text-right">{R(d.inb)}</td><td className="py-1 px-1 text-right">{R(d.bRaw)}</td><td className="py-1 px-1 text-right">{R(d.bPprc)}</td></tr>)}</tbody></table></div></div>}
    {/* Recent Sales */}
    {sale && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Recent</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div title="Month-to-date — sum of daily DSR for the current month so far. Computed from the daily forecast series, not the sales summary.">
          <div className="text-gray-500 text-xs">MTD</div>
          <div className="text-white font-semibold">{R(mtdUnits)} u</div>
          <div className="text-gray-500 text-[10px]">this month so far</div>
        </div>
        {[{ l: "This Mo", u: sale.tmU, r: sale.tmR, p: sale.tmP }, { l: "Last Mo", u: sale.lmU, r: sale.lmR, p: sale.lmP }, { l: "7d", u: sale.l7U, r: sale.l7R, p: sale.l7P }, { l: "28d", u: sale.l28U, r: sale.l28R, p: sale.l28P }].map(x => <div key={x.l}><div className="text-gray-500 text-xs">{x.l}</div><div className="text-white font-semibold">{R(x.u)} u</div><div className="text-gray-400 text-xs">{$(x.r)}</div><div className="text-emerald-400 text-xs">{$(x.p)}</div></div>)}
      </div>
    </div>}
    {/* YoY Units (sum of Complete DSR) + Price History */}
{/* === YoY Performance — Units → Price → Revenue → Profit === */}
    {bInv.length > 0 && <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <h3 className="text-white font-semibold text-sm mb-3">YoY Performance</h3>

      <div className="space-y-5 mb-5">

        {/* 1. UNITS */}
        <div>
          <h4 className="text-gray-400 text-xs font-semibold mb-1">Units</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={yD}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <Tooltip {...TTP} formatter={(v) => v != null ? Math.round(v).toLocaleString('en-US') : '—'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {uYrs.map(y => <Line key={y} dataKey={"u_" + y} stroke={YC[y] || "#6b7280"} strokeWidth={y === currentYear ? 3 : 1.5} dot={{ r: 2.5 }} connectNulls={false} name={`${y} (${R(uYTot[y])} u)`} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 2. AVG SELLING PRICE */}
        <div>
          <h4 className="text-gray-400 text-xs font-semibold mb-1">Avg selling price</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={pCh}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => '$' + v.toFixed(2)} />
              <Tooltip {...TTP} formatter={(v) => v != null ? '$' + Number(v).toFixed(2) : '—'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {uYrs.map(y => <Line key={y} dataKey={"p_" + y} stroke={YC[y] || "#6b7280"} strokeWidth={y === currentYear ? 3 : 1.5} dot={{ r: 2.5 }} connectNulls={false} name={totals[y]?.avgPrice != null ? `${y} ($${totals[y].avgPrice.toFixed(2)} avg)` : `${y}`} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 3. REVENUE */}
        <div>
          <h4 className="text-gray-400 text-xs font-semibold mb-1">Revenue</h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={rCh}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickFormatter={(v) => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0))} />
              <Tooltip {...TTP} formatter={(v) => v != null ? $(v) : '—'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {uYrs.map(y => <Line key={y} dataKey={"r_" + y} stroke={YC[y] || "#6b7280"} strokeWidth={y === currentYear ? 3 : 1.5} dot={{ r: 2.5 }} connectNulls={false} name={`${y} (${$(totals[y]?.rev || 0)} total)`} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 4. PROFIT — with breakeven reference line */}
        <div>
          <h4 className="text-gray-400 text-xs font-semibold mb-1 flex items-center gap-2">
            Profit
            <span className="text-[10px] font-normal text-gray-500 normal-case">dashed = breakeven</span>
          </h4>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={profCh}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} tickFormatter={(v) => '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0))} />
              <Tooltip {...TTP} formatter={(v) => v != null ? $(v) : '—'} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
              {uYrs.map(y => <Line key={y} dataKey={"pr_" + y} stroke={YC[y] || "#6b7280"} strokeWidth={y === currentYear ? 3 : 1.5} dot={{ r: 2.5 }} connectNulls={false} name={`${y} (${$(totals[y]?.profit || 0)} total)`} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* YoY Units Table — sin cambios desde Sprint 3 Fix 12 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs max-w-2xl">
          <thead><tr className="text-gray-500">
            <th className="py-1 px-1 text-left">Mo</th>
            {uYrs.map((y) => <th key={y} className="py-1 px-1 text-right" style={{ color: YC[y] || "#6b7280" }}>{y}</th>)}
            {uYrs.length >= 2 && <th className="py-1 px-1 text-right text-gray-500">Var %<br/>{String(uYrs[uYrs.length - 1]).slice(-2)} vs {String(uYrs[uYrs.length - 2]).slice(-2)}</th>}
          </tr></thead>
          <tbody>
            {yD.map((r, i) => {
              const monthIdx = MN.indexOf(r.month) + 1;
              return <tr key={i} className={i % 2 === 0 ? "bg-gray-800/20" : ""}>
                <td className="py-0.5 px-1 text-gray-300">{r.month}</td>
                {uYrs.map((y) => {
                  const raw = r["u_" + y];
                  let display;
                  if (raw != null) display = R(raw);
                  else if (isMonthInFuture(y, monthIdx)) display = "—";
                  else if (isMonthInPast(y, monthIdx)) display = "0";
                  else display = "";
                  return <SC key={y} v={raw} className="py-0.5 px-1 text-right text-white">{display}</SC>;
                })}
                {uYrs.length >= 2 && (() => {
                  const curY = uYrs[uYrs.length - 1];
                  const prevY = uYrs[uYrs.length - 2];
                  const norm = (raw, y) => {
                    if (raw != null) return raw;
                    if (isMonthInPast(y, monthIdx)) return 0;
                    return null;
                  };
                  const cur = norm(r["u_" + curY], curY);
                  const prev = norm(r["u_" + prevY], prevY);
                  const showPct = cur != null && prev != null && prev > 0;
                  const pct = showPct ? ((cur - prev) / prev * 100) : null;
                  return <td className={`py-0.5 px-1 text-right ${pct == null ? "text-gray-600" : pct >= 0 ? "text-emerald-400" : "text-red-400"}`} title={prev != null ? `${curY}: ${cur ?? "—"} vs ${prevY}: ${prev}` : ""}>{pct != null ? (pct >= 0 ? "+" : "") + pct.toFixed(0) : "—"}</td>;
                })()}
              </tr>;
            })}
           <tr className="border-t border-gray-700 font-semibold">
              <td className="py-1 px-1">Total</td>
              {uYrs.map(y => <SC key={y} v={uYTot[y]} className="py-1 px-1 text-right text-white">{R(uYTot[y])}</SC>)}
              {uYrs.length >= 2 && (() => {
                const curY = uYrs[uYrs.length - 1];
                const prevY = uYrs[uYrs.length - 2];
                const cur = uYTot[curY];
                const prev = uYTot[prevY];
                const pct = prev > 0 ? ((cur - prev) / prev * 100) : null;
                return <td className={`py-1 px-1 text-right ${pct == null ? "text-gray-600" : pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pct != null ? (pct >= 0 ? "+" : "") + pct.toFixed(0) : "—"}</td>;
              })()}
            </tr>
          </tbody>
        </table>
      </div>

    </div>}
  </div>;
}
