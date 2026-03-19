import React, { useState, useMemo, useContext } from "react";
import { R, D1, $, $2, fDateUS, fE } from "../lib/utils";
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
  const [expanded, setExpanded] = useState({});
  const [limit, setLimit] = useState(30);

  const rows = data.receivingFull || [];
  const vendors = useMemo(() => [...new Set(rows.map(r => r.vendor).filter(Boolean))].sort(), [rows]);

  // Group by PO
  const poGroups = useMemo(() => {
    const g = {};
    rows.forEach(r => {
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
  }, [rows]);

  // Group by vendor → POs
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

  // Filter
  const q = search.toLowerCase();
  const filteredPOs = useMemo(() => {
    let arr = poGroups;
    if (vendorF) arr = arr.filter(p => p.vendor === vendorF);
    if (q) arr = arr.filter(p =>
      p.po.toLowerCase().includes(q) ||
      p.vendor.toLowerCase().includes(q) ||
      p.items.some(i => i.core.toLowerCase().includes(q) || (i.shortTitle || "").toLowerCase().includes(q))
    );
    return arr;
  }, [poGroups, vendorF, q]);

  const filteredVendors = useMemo(() => {
    let arr = vendorGroups;
    if (vendorF) arr = arr.filter(v => v.vendor === vendorF);
    if (q) arr = arr.filter(v =>
      v.vendor.toLowerCase().includes(q) ||
      v.pos.some(p => p.po.toLowerCase().includes(q))
    );
    return arr;
  }, [vendorGroups, vendorF, q]);

  const tog = id => setExpanded(p => ({ ...p, [id]: !p[id] }));

  // Summary
  const totalOrders = filteredPOs.length;
  const totalValue = filteredPOs.reduce((s, p) => s + p.totalValue, 0);
  const totalPcs = filteredPOs.reduce((s, p) => s + p.totalPcs, 0);

  return <div className="p-4 max-w-6xl mx-auto">
    <h2 className="text-xl font-bold text-white mb-4">Order History</h2>
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <input type="text" placeholder="Search PO#, vendor, core..." value={search} onChange={e => setSearch(e.target.value)}
        className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2 w-full max-w-xs text-sm" />
      <SS value={vendorF} onChange={setVendorF} options={vendors} placeholder="All Vendors" />
      <div className="flex bg-gray-800 rounded-lg p-0.5">
        {[["po", "By PO"], ["vendor", "By Vendor"]].map(([k, l]) =>
          <button key={k} onClick={() => setViewBy(k)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewBy === k ? "bg-blue-600 text-white" : "text-gray-400"}`}>{l}</button>
        )}
      </div>
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
            <button onClick={() => tog(po.po)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800 text-left">
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
                  <th className="py-1 px-2 text-left">Core/JLS</th>
                  <th className="py-1 px-2 text-left">Title</th>
                  <th className="py-1 px-2 text-left">VSKU</th>
                  <th className="py-1 px-2 text-right">Pcs</th>
                  <th className="py-1 px-2 text-right">Cases</th>
                  <th className="py-1 px-2 text-right">Price</th>
                  <th className="py-1 px-2 text-right">Total</th>
                  <th className="py-1 px-2 text-right">Missing</th>
                  <th className="py-1 px-2 text-right">ETA</th>
                </tr></thead>
                <tbody>{po.items.map((r, i) => {
                  const lineTotal = (r.pcs || 0) * (r.price || 0);
                  return <tr key={i} className={`border-t border-gray-800/30 ${i % 2 === 0 ? "bg-gray-800/20" : ""}`}>
                    <td className="py-1.5 px-2 text-blue-400 font-mono">{r.core}</td>
                    <td className="py-1.5 px-2 text-gray-300 truncate max-w-[200px]">{r.shortTitle}</td>
                    <td className="py-1.5 px-2 text-gray-500">{r.vsku}</td>
                    <SC v={r.pcs} className="py-1.5 px-2 text-right text-white">{R(r.pcs)}</SC>
                    <SC v={r.cases} className="py-1.5 px-2 text-right">{r.cases > 0 ? R(r.cases) : "—"}</SC>
                    <td className="py-1.5 px-2 text-right text-gray-400">{r.price > 0 ? "$" + r.price.toFixed(4) : "—"}</td>
                    <SC v={lineTotal} className="py-1.5 px-2 text-right text-amber-300">{lineTotal > 0 ? $(lineTotal) : "—"}</SC>
                    <td className={`py-1.5 px-2 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-600"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td>
                    <td className="py-1.5 px-2 text-right text-emerald-400">{r.eta ? fE(r.eta) : "—"}</td>
                  </tr>;
                })}</tbody>
                <tfoot><tr className="border-t-2 border-gray-700 font-semibold">
                  <td colSpan={3} className="py-2 px-2 text-gray-400">{po.items.length} lines</td>
                  <td className="py-2 px-2 text-right text-white">{R(po.totalPcs)}</td>
                  <td className="py-2 px-2 text-right">{R(po.totalCases)}</td>
                  <td />
                  <td className="py-2 px-2 text-right text-amber-300">{$(po.totalValue)}</td>
                  <td className={`py-2 px-2 text-right ${po.missing > 0 ? "text-red-400" : ""}`}>{po.missing > 0 ? R(po.missing) : ""}</td>
                  <td />
                </tr></tfoot>
              </table>
            </div>}
          </div>;
        })}
      </div>
      {limit < filteredPOs.length && <div className="mt-4 text-center">
        <button onClick={() => setLimit(p => p + 30)} className="text-sm text-blue-400 hover:text-white bg-blue-400/10 px-4 py-2 rounded">
          Load More ({filteredPOs.length - limit} remaining)
        </button>
      </div>}
    </>}

    {/* === BY VENDOR VIEW === */}
    {viewBy === "vendor" && <div className="space-y-3">
      {filteredVendors.map(vg => {
        const isVOpen = expanded["_v_" + vg.vendor];
        return <div key={vg.vendor} className="border border-gray-800 rounded-lg overflow-hidden">
          <button onClick={() => tog("_v_" + vg.vendor)}
            className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800 text-left">
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
                <button onClick={() => tog(po.po)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-800 text-left">
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
                      <th className="py-1 px-2 text-left">Core/JLS</th>
                      <th className="py-1 px-2 text-left">Title</th>
                      <th className="py-1 px-2 text-right">Pcs</th>
                      <th className="py-1 px-2 text-right">Cases</th>
                      <th className="py-1 px-2 text-right">Price</th>
                      <th className="py-1 px-2 text-right">Total</th>
                      <th className="py-1 px-2 text-right">Missing</th>
                    </tr></thead>
                    <tbody>{po.items.map((r, i) => {
                      const lt = (r.pcs || 0) * (r.price || 0);
                      return <tr key={i} className={`border-t border-gray-800/30 ${i % 2 === 0 ? "bg-gray-800/20" : ""}`}>
                        <td className="py-1 px-2 text-blue-400 font-mono">{r.core}</td>
                        <td className="py-1 px-2 text-gray-300 truncate max-w-[180px]">{r.shortTitle}</td>
                        <SC v={r.pcs} className="py-1 px-2 text-right text-white">{R(r.pcs)}</SC>
                        <td className="py-1 px-2 text-right">{r.cases > 0 ? R(r.cases) : "—"}</td>
                        <td className="py-1 px-2 text-right text-gray-400">{r.price > 0 ? "$" + r.price.toFixed(4) : "—"}</td>
                        <SC v={lt} className="py-1 px-2 text-right text-amber-300">{lt > 0 ? $(lt) : "—"}</SC>
                        <td className={`py-1 px-2 text-right ${r.piecesMissing > 0 ? "text-red-400" : "text-gray-600"}`}>{r.piecesMissing > 0 ? R(r.piecesMissing) : "—"}</td>
                      </tr>;
                    })}</tbody>
                    <tfoot><tr className="border-t border-gray-700 font-semibold">
                      <td colSpan={2} className="py-1 px-2 text-gray-400">{po.items.length} lines</td>
                      <td className="py-1 px-2 text-right text-white">{R(po.totalPcs)}</td>
                      <td className="py-1 px-2 text-right">{R(po.totalCases)}</td>
                      <td />
                      <td className="py-1 px-2 text-right text-amber-300">{$(po.totalValue)}</td>
                      <td className={`py-1 px-2 text-right ${po.missing > 0 ? "text-red-400" : ""}`}>{po.missing > 0 ? R(po.missing) : ""}</td>
                    </tr></tfoot>
                  </table>
                </div>}
              </div>;
            })}
          </div>}
        </div>;
      })}
    </div>}

    {filteredPOs.length === 0 && <p className="text-gray-500 text-sm py-8 text-center">No orders match filters</p>}
  </div>;
}
