import React, { useState, useMemo, useContext } from "react";
import { R, D1, $, $2, $4, fDateUS, fE } from "../lib/utils";
import { SumCtx, SS } from "./Shared";

function SC({ v, children, className }) {
  const { addCell } = useContext(SumCtx);
  const [sel, setSel] = useState(false);
  const raw = typeof v === "number" ? v : parseFloat(v);
  const ok = !isNaN(raw) && raw !== 0;
  const tog = () => { if (!ok) return; if (sel) { addCell(raw, true); setSel(false) } else { addCell(raw, false); setSel(true) } };
  return <td className={`${className || ''} ${sel ? "bg-blue-500/20 ring-1 ring-blue-500" : ""} ${ok ? "cursor-pointer select-none" : ""}`} onClick={tog}>{children}</td>;
}

export default function OrdersTab({ data }) {
  const [search, setSearch] = useState("");
  const [vendorF, setVendorF] = useState("");
  const [viewBy, setViewBy] = useState("po");
  const [source, setSource] = useState("7f");
  const [expanded, setExpanded] = useState({});
  const [limit, setLimit] = useState(30);

  const rows7f = data.receivingFull || [];
  const rows7g = data.priceCompFull || [];
  const rows = source === "7g" ? rows7g : rows7f;
  const vendors = useMemo(() => [...new Set(rows7f.map(r => r.vendor).filter(Boolean)), ...new Set(rows7g.map(r => r.name).filter(Boolean))].filter((v, i, a) => a.indexOf(v) === i).sort(), [rows7f, rows7g]);

  // === PO GROUPS (7f) ===
  const poGroups = useMemo(() => {
    const g = {};
    rows7f.forEach(r => {
      const po = r.orderNum || "NO-PO";
      if (!g[po]) g[po] = { po, vendor: r.vendor, date: r.date, eta: r.eta, country: r.country, terms: r.terms, items: [], totalPcs: 0, totalCases: 0, totalValue: 0, missing: 0 };
      g[po].items.push(r);
      g[po].totalPcs += r.pcs || 0;
      g[po].totalCases += r.cases || 0;
      g[po].totalValue += (r.pcs || 0) * (r.price || 0);
      g[po].missing += r.piecesMissing || 0;
      if (!g[po].date || r.date > g[po].date) g[po].date = r.date;
    });
    return Object.values(g).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [rows7f]);

  // === VENDOR GROUPS ===
  const vendorGroups = useMemo(() => {
    const g = {};
    poGroups.forEach(po => {
      const v = po.vendor || "Unknown";
      if (!g[v]) g[v] = { vendor: v, pos: [], totalValue: 0, totalPcs: 0 };
      g[v].pos.push(po);
      g[v].totalValue += po.totalValue;
      g[v].totalPcs += po.totalPcs;
    });
    return Object.values(g).sort((a, b) => b.totalValue - a.totalValue);
  }, [poGroups]);

  // === CORE GROUPS (7f) ===
  const coreGroups7f = useMemo(() => {
    const g = {};
    rows7f.forEach(r => {
      const cid = r.core || "Unknown";
      if (!g[cid]) g[cid] = { core: cid, title: r.shortTitle || "", orders: [], totalPcs: 0, totalValue: 0, vendors: new Set() };
      g[cid].orders.push(r);
      g[cid].totalPcs += r.pcs || 0;
      g[cid].totalValue += (r.pcs || 0) * (r.price || 0);
      if (r.vendor) g[cid].vendors.add(r.vendor);
      if (!g[cid].title && r.shortTitle) g[cid].title = r.shortTitle;
    });
    return Object.values(g).map(c => ({ ...c, vendors: [...c.vendors].join(", "), orderCount: c.orders.length }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [rows7f]);

  // === CORE GROUPS (7g) ===
  const coreGroups7g = useMemo(() => {
    const g = {};
    rows7g.forEach(r => {
      const cid = r.core || "Unknown";
      if (!g[cid]) g[cid] = { core: cid, title: r.shortTitle || "", orders: [], totalPcs: 0, totalCost: 0, vendors: new Set() };
      g[cid].orders.push(r);
      g[cid].totalPcs += r.pcs || 0;
      g[cid].totalCost += r.totalCost || 0;
      if (r.name) g[cid].vendors.add(r.name);
      if (!g[cid].title && r.shortTitle) g[cid].title = r.shortTitle;
    });
    return Object.values(g).map(c => ({ ...c, vendors: [...c.vendors].join(", "), orderCount: c.orders.length }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [rows7g]);

  const coreGroups = source === "7g" ? coreGroups7g : coreGroups7f;

  // === FILTERS ===
  const q = search.toLowerCase();
  const filteredPOs = useMemo(() => {
    let arr = poGroups;
    if (vendorF) arr = arr.filter(p => p.vendor === vendorF);
    if (q) arr = arr.filter(p =>
      p.po.toLowerCase().includes(q) || p.vendor.toLowerCase().includes(q) ||
      p.items.some(i => i.core.toLowerCase().includes(q) || (i.shortTitle || "").toLowerCase().includes(q))
    );
    return arr;
  }, [poGroups, vendorF, q]);

  const filteredVendors = useMemo(() => {
    let arr = vendorGroups;
    if (vendorF) arr = arr.filter(v => v.vendor === vendorF);
    if (q) arr = arr.filter(v => v.vendor.toLowerCase().includes(q) || v.pos.some(p => p.po.toLowerCase().includes(q)));
    return arr;
  }, [vendorGroups, vendorF, q]);

  const filteredCores = useMemo(() => {
    let arr = coreGroups;
    if (vendorF) arr = arr.filter(c => c.orders.some(o => (o.vendor || o.name || "").toLowerCase() === vendorF.toLowerCase()));
    if (q) arr = arr.filter(c => c.core.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.vendors.toLowerCase().includes(q));
    return arr;
  }, [coreGroups, vendorF, q]);

  const tog = id => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const totalOrders = filteredPOs.length;
  const totalValue = filteredPOs.reduce((s, p) => s + p.totalValue, 0);
  const totalPcs = filteredPOs.reduce((s, p) => s + p.totalPcs, 0);

  return <div className="p-4 max-w-7xl mx-auto">
    <h2 className="text-xl font-bold text-white mb-4">Order History</h2>
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <input type="text" placeholder="Search PO#, vendor, core..." value={search} onChange={e => setSearch(e.target.value)}
        className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2 w-full max-w-xs text-sm" />
      <SS value={vendorF} onChange={setVendorF} options={vendors} placeholder="All Vendors" />
      <div className="flex bg-gray-800 rounded-lg p-0.5">
        {[["po", "By PO"], ["vendor", "By Vendor"], ["core", "By Core/JLS"]].map(([k, l]) =>
          <button key={k} onClick={() => setViewBy(k)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewBy === k ? "bg-blue-600 text-white" : "text-gray-400"}`}>{l}</button>
        )}
      </div>
      {viewBy === "core" && <div className="flex bg-gray-800 rounded-lg p-0.5">
        {[["7f", "7f Receiving"], ["7g", "7g COGS"]].map(([k, l]) =>
          <button key={k} onClick={() => setSource(k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${source === k ? "bg-teal-600 text-white" : "text-gray-400"}`}>{l}</button>
        )}
      </div>}
      <div className="ml-auto flex gap-4 text-xs text-gray-400">
        <span>{R(totalOrders)} POs</span>
        <span>{R(totalPcs)} pcs</span>
        <span className="text-amber-300">{$(totalValue)}</span>
      </div>
    </div>

    {/* === BY PO VIEW === */}
    {viewBy === "po" && <>
      <div className="space-y-1">
        {filteredPOs.slice(0, limit).map(po => {
          const isOpen = expanded[po.po];
          return <div key={po.po} className="border border-gray-800 rounded-lg overflow-hidden">
            <button onClick={() => tog(po.po)} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800 text-left">
              <span className="text-xs text-gray-500 w-5">{isOpen ? "▼" : "▶"}</span>
              <span className="text-blue-400 font-mono text-sm min-w-[140px]">{po.po}</span>
              <span className="text-white text-sm flex-1 truncate">{po.vendor}</span>
              <span className="text-gray-400 text-xs">{fDateUS(po.date)}</span>
              {po.eta && <span className="text-emerald-400 text-xs">ETA:{fE(po.eta)}</span>}
              <span className="text-gray-300 text-xs">{po.items.length} items</span>
              <span className="text-gray-300 text-xs">{R(po.totalPcs)} pcs</span>
              <span className="text-amber-300 text-xs font-semibold">{$(po.totalValue)}</span>
              {po.missing > 0 && <span className="text-red-400 text-xs">{R(po.missing)} miss</span>}
            </button>
            {isOpen && <div className="bg-gray-900/30 px-4 py-2">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 uppercase">
                  <th className="py-1 px-2 text-left">Core/JLS</th><th className="py-1 px-2 text-left">Title</th><th className="py-1 px-2 text-left">VSKU</th>
                  <th className="py-1 px-2 text-right">Pcs</th><th className="py-1 px-2 text-right">Cases</th><th className="py-1 px-2 text-right">Price</th>
                  <th className="py-1 px-2 text-right">Total</th><th className="py-1 px-2 text-right">Missing</th><th className="py-1 px-2 text-right">ETA</th>
                </tr></thead>
                <tbody>{po.items.map((r, i) => {
                  const lineTotal = (r.pcs || 0) * (r.price || 0);
                  return <tr key={i} className={`border-t border-gray-800/30 ${i % 2 === 0 ? "bg-gray-800/20" : ""}`}>
                    <td className="py-1.5 px-2 text-blue-400 font-mono">{r.core}</td>
                    <td className="py-1.5 px-2 text-gray-300 truncate max-w-[200px]">{r.shortTitle}</td>
                    <td className="py-1.5 px-2 text-gray-500">{r.vsku}</td>
                    <SC v={r.pcs} className="py-1.5 px-2 text-right text-white">{R(r.pcs)}</SC>
                    <SC v={r.cases} className="py-1.5 px-2 text-right">{r.cases > 0 ? R(r.cases) : "—"}</SC>
                    <td className="py-1.5 px-2 text-right text-gray-400">{r.price > 0 ? $4(r.price) : "—"}</td>
                    <SC v={lineTotal} className="py-1.5 px-2 text-right text-amber-300">{lineTotal > 0 ? $(lineTotal) : "—"}</SC>
                    <td className={`py-1.5 px-2 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-600"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td>
                    <td className="py-1.5 px-2 text-right text-emerald-400">{r.eta ? fE(r.eta) : "—"}</td>
                  </tr>;
                })}</tbody>
                <tfoot><tr className="border-t-2 border-gray-700 font-semibold">
                  <td colSpan={3} className="py-2 px-2 text-gray-400">{po.items.length} lines</td>
                  <td className="py-2 px-2 text-right text-white">{R(po.totalPcs)}</td>
                  <td className="py-2 px-2 text-right">{R(po.totalCases)}</td><td />
                  <td className="py-2 px-2 text-right text-amber-300">{$(po.totalValue)}</td>
                  <td className={`py-2 px-2 text-right ${po.missing > 0 ? "text-red-400" : ""}`}>{po.missing > 0 ? R(po.missing) : ""}</td><td />
                </tr></tfoot>
              </table>
            </div>}
          </div>;
        })}
      </div>
      {limit < filteredPOs.length && <div className="mt-4 text-center"><button onClick={() => setLimit(p => p + 30)} className="text-sm text-blue-400 hover:text-white bg-blue-400/10 px-4 py-2 rounded">Load More ({filteredPOs.length - limit} remaining)</button></div>}
    </>}

    {/* === BY VENDOR VIEW === */}
    {viewBy === "vendor" && <div className="space-y-3">
      {filteredVendors.map(vg => {
        const isVOpen = expanded["_v_" + vg.vendor];
        return <div key={vg.vendor} className="border border-gray-800 rounded-lg overflow-hidden">
          <button onClick={() => tog("_v_" + vg.vendor)} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800 text-left">
            <span className="text-xs text-gray-500 w-5">{isVOpen ? "▼" : "▶"}</span>
            <span className="text-white font-semibold flex-1">{vg.vendor}</span>
            <span className="text-gray-400 text-xs">{vg.pos.length} POs</span>
            <span className="text-gray-300 text-xs">{R(vg.totalPcs)} pcs</span>
            <span className="text-amber-300 text-xs font-semibold">{$(vg.totalValue)}</span>
          </button>
          {isVOpen && <div className="bg-gray-900/30 px-2 py-1 space-y-1">
            {vg.pos.map(po => {
              const isPOpen = expanded[po.po];
              return <div key={po.po}>
                <button onClick={() => tog(po.po)} className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-800 text-left">
                  <span className="text-xs text-gray-500 w-4">{isPOpen ? "▾" : "▸"}</span>
                  <span className="text-blue-400 font-mono text-xs min-w-[130px]">{po.po}</span>
                  <span className="text-gray-400 text-xs">{fDateUS(po.date)}</span>
                  {po.eta && <span className="text-emerald-400 text-xs">ETA:{fE(po.eta)}</span>}
                  <span className="text-gray-300 text-xs flex-1">{po.items.length} items · {R(po.totalPcs)} pcs</span>
                  <span className="text-amber-300 text-xs">{$(po.totalValue)}</span>
                  {po.missing > 0 && <span className="text-red-400 text-xs">{R(po.missing)} miss</span>}
                </button>
                {isPOpen && <div className="ml-6 mb-2">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500 uppercase">
                      <th className="py-1 px-2 text-left">Core/JLS</th><th className="py-1 px-2 text-left">Title</th>
                      <th className="py-1 px-2 text-right">Pcs</th><th className="py-1 px-2 text-right">Cases</th>
                      <th className="py-1 px-2 text-right">Price</th><th className="py-1 px-2 text-right">Total</th>
                      <th className="py-1 px-2 text-right">Missing</th>
                    </tr></thead>
                    <tbody>{po.items.map((r, i) => {
                      const lt = (r.pcs || 0) * (r.price || 0);
                      return <tr key={i} className={`border-t border-gray-800/30 ${i % 2 === 0 ? "bg-gray-800/20" : ""}`}>
                        <td className="py-1 px-2 text-blue-400 font-mono">{r.core}</td>
                        <td className="py-1 px-2 text-gray-300 truncate max-w-[180px]">{r.shortTitle}</td>
                        <SC v={r.pcs} className="py-1 px-2 text-right text-white">{R(r.pcs)}</SC>
                        <td className="py-1 px-2 text-right">{r.cases > 0 ? R(r.cases) : "—"}</td>
                        <td className="py-1 px-2 text-right text-gray-400">{r.price > 0 ? $4(r.price) : "—"}</td>
                        <SC v={lt} className="py-1 px-2 text-right text-amber-300">{lt > 0 ? $(lt) : "—"}</SC>
                        <td className={`py-1 px-2 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-600"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>}
              </div>;
            })}
          </div>}
        </div>;
      })}
    </div>}

    {/* === BY CORE/JLS VIEW === */}
    {viewBy === "core" && <div className="space-y-1">
      {filteredCores.slice(0, limit).map(cg => {
        const isOpen = expanded["_c_" + cg.core];
        return <div key={cg.core} className="border border-gray-800 rounded-lg overflow-hidden">
          <button onClick={() => tog("_c_" + cg.core)} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800 text-left">
            <span className="text-xs text-gray-500 w-5">{isOpen ? "▼" : "▶"}</span>
            <span className="text-blue-400 font-mono text-sm min-w-[100px]">{cg.core}</span>
            <span className="text-gray-300 text-sm flex-1 truncate">{cg.title}</span>
            <span className="text-gray-500 text-xs truncate max-w-[150px]">{cg.vendors}</span>
            <span className="text-gray-400 text-xs">{cg.orderCount} orders</span>
            <span className="text-gray-300 text-xs">{R(cg.totalPcs)} pcs</span>
            <span className="text-amber-300 text-xs font-semibold">{$(source === "7g" ? cg.totalCost : cg.totalValue)}</span>
          </button>
          {isOpen && <div className="bg-gray-900/30 px-4 py-2">
            {source === "7f" ? (
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 uppercase">
                  <th className="py-1 px-2 text-left">Date</th><th className="py-1 px-1 text-left">Vendor</th>
                  <th className="py-1 px-2 text-left">PO#</th><th className="py-1 px-2 text-left">VSKU</th>
                  <th className="py-1 px-2 text-right">Pcs</th><th className="py-1 px-2 text-right">Cases</th>
                  <th className="py-1 px-2 text-right">Price</th><th className="py-1 px-2 text-right">Total</th>
                  <th className="py-1 px-2 text-right">ETA</th><th className="py-1 px-2 text-right">Missing</th>
                </tr></thead>
                <tbody>{cg.orders.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((r, i) => {
                  const lt = (r.pcs || 0) * (r.price || 0);
                  return <tr key={i} className={`border-t border-gray-800/30 ${i % 2 === 0 ? "bg-gray-800/20" : ""}`}>
                    <td className="py-1.5 px-2 text-gray-300">{fDateUS(r.date)}</td>
                    <td className="py-1.5 px-2 text-gray-300 truncate max-w-[150px]">{r.vendor}</td>
                    <td className="py-1.5 px-2 text-blue-400 font-mono">{r.orderNum}</td>
                    <td className="py-1.5 px-2 text-gray-500">{r.vsku}</td>
                    <SC v={r.pcs} className="py-1.5 px-2 text-right text-white">{R(r.pcs)}</SC>
                    <td className="py-1.5 px-2 text-right">{r.cases > 0 ? R(r.cases) : "—"}</td>
                    <td className="py-1.5 px-2 text-right text-gray-400">{r.price > 0 ? $4(r.price) : "—"}</td>
                    <SC v={lt} className="py-1.5 px-2 text-right text-amber-300">{lt > 0 ? $(lt) : "—"}</SC>
                    <td className="py-1.5 px-2 text-right text-emerald-400">{r.eta ? fE(r.eta) : "—"}</td>
                    <td className={`py-1.5 px-2 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-600"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td>
                  </tr>;
                })}</tbody>
                <tfoot><tr className="border-t-2 border-gray-700 font-semibold">
                  <td colSpan={4} className="py-2 px-2 text-gray-400">{cg.orderCount} orders</td>
                  <td className="py-2 px-2 text-right text-white">{R(cg.totalPcs)}</td><td colSpan={2} />
                  <td className="py-2 px-2 text-right text-amber-300">{$2(cg.totalCost)}</td>
                  <td colSpan={3} />                  
                </tr></tfoot>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 uppercase">
                  <th className="py-1 px-2 text-left">Date</th><th className="py-1 px-2 text-left">Vendor</th>
                  <th className="py-1 px-2 text-right">Pcs</th><th className="py-1 px-2 text-right">Material</th>
                  <th className="py-1 px-2 text-right">Inb Ship</th><th className="py-1 px-2 text-right">Tariffs</th>
                  <th className="py-1 px-2 text-right">Other</th><th className="py-1 px-2 text-right">Total Cost</th>
                  <th className="py-1 px-2 text-right">CPP</th><th className="py-1 px-2 text-right">%Chg</th><th className="py-1 px-2 text-left">Note</th>
                </tr></thead>
                <tbody>{cg.orders.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((r, i) => {
                  const prevOrder = cg.orders.sort((a, b) => (b.date || "").localeCompare(a.date || ""))[i + 1];
                  const pctChg = prevOrder && prevOrder.cpp > 0 && r.cpp > 0 ? ((r.cpp - prevOrder.cpp) / prevOrder.cpp * 100) : null;
                  return <tr key={i} className={`border-t border-gray-800/30 ${i % 2 === 0 ? "bg-gray-800/20" : ""}`}>
                    <td className="py-1.5 px-2 text-gray-300">{fDateUS(r.date)}</td>
                    <td className="py-1.5 px-1 text-gray-300 truncate max-w-[80px]">{r.name}</td>
                    <SC v={r.pcs} className="py-1.5 px-2 text-right text-white">{R(r.pcs)}</SC>
                    <SC v={r.matPrice} className="py-1.5 px-2 text-right">{r.matPrice > 0 ? $2(r.matPrice) : "—"}</SC>
                    <SC v={r.inbShip} className="py-1.5 px-2 text-right text-gray-400">{r.inbShip > 0 ? $2(r.inbShip) : "—"}</SC>
                    <SC v={r.tariffs} className="py-1.5 px-2 text-right text-gray-400">{r.tariffs > 0 ? $2(r.tariffs) : "—"}</SC>
                    <SC v={r.other} className="py-1.5 px-2 text-right text-gray-400">{r.other > 0 ? $2(r.other) : "—"}</SC>
                    <SC v={r.totalCost} className="py-1.5 px-2 text-right text-amber-300">{r.totalCost > 0 ? $2(r.totalCost) : "—"}</SC>
                    <td className="py-1.5 px-2 text-right text-white">{r.cpp > 0 ? $4(r.cpp) : "—"}</td>
                    <td className={`py-1.5 px-2 text-right ${pctChg != null && pctChg > 0 ? "text-red-400" : pctChg != null && pctChg < 0 ? "text-emerald-400" : "text-gray-500"}`}>{pctChg != null ? (pctChg > 0 ? "+" : "") + pctChg.toFixed(1) + "%" : "—"}</td>
                    <td className="py-1.5 px-2 text-gray-500 truncate max-w-[120px]">{r.note || "—"}</td>
                  </tr>;
                })}</tbody>
                <tfoot><tr className="border-t-2 border-gray-700 font-semibold">
                  <td colSpan={2} className="py-2 px-2 text-gray-400">{cg.orderCount} orders</td>
                  <td className="py-2 px-2 text-right text-white">{R(cg.totalPcs)}</td>
                  <td colSpan={4} />
                  <td className="py-2 px-2 text-right text-amber-300">{$2(cg.totalCost)}</td>
                  <td colSpan={2} />
                </tr></tfoot>
              </table>
            )}
          </div>}
        </div>;
      })}
      {limit < filteredCores.length && <div className="mt-4 text-center"><button onClick={() => setLimit(p => p + 30)} className="text-sm text-blue-400 hover:text-white bg-blue-400/10 px-4 py-2 rounded">Load More ({filteredCores.length - limit} remaining)</button></div>}
    </div>}

    {viewBy === "po" && filteredPOs.length === 0 && <p className="text-gray-500 text-sm py-8 text-center">No orders match filters</p>}
    {viewBy === "core" && filteredCores.length === 0 && <p className="text-gray-500 text-sm py-8 text-center">No orders match filters</p>}
  </div>;
}
