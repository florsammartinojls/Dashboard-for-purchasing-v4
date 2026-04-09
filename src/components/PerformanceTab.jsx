import React, { useState, useMemo, useEffect } from "react";
import { R, D1, $, P } from "../lib/utils";

// Format date as MM/DD/YY from various input formats
const fmtDate = (d) => {
  if (!d) return "";
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const yy = String(dt.getFullYear()).slice(2);
    return `${mm}/${dd}/${yy}`;
  } catch { return String(d); }
};

const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

export default function PerformanceTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [vendorFilter, setVendorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("core"); // "core" | "vendor"

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(API + '?action=recLog&_t=' + Date.now());
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHeaders(data.headers || []);
      setRows(data.rows || []);
      setLoading(false);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Build column index map
  const idx = useMemo(() => {
    const m = {};
    headers.forEach((h, i) => { m[h] = i; });
    return m;
  }, [headers]);

  // Parse rows into objects
  const parsed = useMemo(() => {
    return rows.map(r => ({
      date: r[idx.snapshot_date],
      time: r[idx.snapshot_time],
      coreId: r[idx.core_id],
      vendor: r[idx.vendor],
      country: r[idx.country],
      leadTime: r[idx.lead_time],
      targetDoc: r[idx.target_doc],
      dsr: r[idx.dsr],
      d7Dsr: r[idx.d7_dsr],
      inventory: r[idx.inventory_all_in],
      invRaw: r[idx.inventory_raw],
      doc: r[idx.doc_at_snapshot],
      status: r[idx.status],
      seasonalNeed: r[idx.recommended_need_seasonal],
      flatNeed: r[idx.recommended_need_flat],
      orderQty: r[idx.recommended_order_qty],
      costPerPiece: r[idx.cost_per_piece],
      orderCost: r[idx.recommended_order_cost],
      moq: r[idx.moq_pieces],
      casePack: r[idx.case_pack],
      cv: r[idx.seasonal_cv],
      hasHistory: r[idx.has_history],
      bundles: r[idx.active_bundles_count],
      actualOrderQty: r[idx.actual_order_qty],
      actualOrderDate: r[idx.actual_order_date],
      dsr30After: r[idx.dsr_30d_after],
      dsr60After: r[idx.dsr_60d_after],
      dsr90After: r[idx.dsr_90d_after],
      stockout30: r[idx.stockout_in_30d],
      stockout60: r[idx.stockout_in_60d],
      stockout90: r[idx.stockout_in_90d],
      error30: r[idx.forecast_error_pct_30d],
      error60: r[idx.forecast_error_pct_60d],
      error90: r[idx.forecast_error_pct_90d],
      excess60: r[idx.excess_inventory_60d],
    }));
  }, [rows, idx]);

  // Vendor list for dropdown
  const vendors = useMemo(() => {
    const s = new Set();
    parsed.forEach(p => { if (p.vendor) s.add(p.vendor); });
    return [...s].sort();
  }, [parsed]);

  // Filtered
  const filtered = useMemo(() => {
    let arr = parsed;
    if (vendorFilter) arr = arr.filter(p => p.vendor === vendorFilter);
    if (statusFilter) arr = arr.filter(p => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(p => (p.coreId || "").toLowerCase().includes(q) || (p.vendor || "").toLowerCase().includes(q));
    }
    return arr;
  }, [parsed, vendorFilter, statusFilter, search]);

  // Aggregate by vendor (if groupBy === "vendor")
  const byVendor = useMemo(() => {
    const g = {};
    filtered.forEach(p => {
      if (!g[p.vendor]) g[p.vendor] = {
        vendor: p.vendor, country: p.country, cores: 0,
        totalOrderCost: 0, totalOrderQty: 0,
        avgError30: 0, error30Count: 0,
        avgError60: 0, error60Count: 0,
        stockouts30: 0, stockouts60: 0,
        totalExcess60: 0,
        criticalCount: 0, warningCount: 0, healthyCount: 0
      };
      const v = g[p.vendor];
      v.cores++;
      v.totalOrderCost += p.orderCost || 0;
      v.totalOrderQty += p.orderQty || 0;
      if (p.error30 !== "" && p.error30 != null) { v.avgError30 += p.error30; v.error30Count++; }
      if (p.error60 !== "" && p.error60 != null) { v.avgError60 += p.error60; v.error60Count++; }
      if (p.stockout30 === "yes") v.stockouts30++;
      if (p.stockout60 === "yes") v.stockouts60++;
      if (p.excess60) v.totalExcess60 += p.excess60;
      if (p.status === "critical") v.criticalCount++;
      else if (p.status === "warning") v.warningCount++;
      else v.healthyCount++;
    });
    return Object.values(g).map(v => ({
      ...v,
      avgError30: v.error30Count > 0 ? (v.avgError30 / v.error30Count).toFixed(1) : null,
      avgError60: v.error60Count > 0 ? (v.avgError60 / v.error60Count).toFixed(1) : null,
      stockoutRate30: v.cores > 0 ? (v.stockouts30 / v.cores * 100).toFixed(1) : 0,
      stockoutRate60: v.cores > 0 ? (v.stockouts60 / v.cores * 100).toFixed(1) : 0,
    })).sort((a, b) => b.totalOrderCost - a.totalOrderCost);
  }, [filtered]);

  // Overall stats
  const stats = useMemo(() => {
    const totalRows = filtered.length;
    const withError30 = filtered.filter(p => p.error30 !== "" && p.error30 != null);
    const withError60 = filtered.filter(p => p.error60 !== "" && p.error60 != null);
    const stockouts30 = filtered.filter(p => p.stockout30 === "yes").length;
    const stockouts60 = filtered.filter(p => p.stockout60 === "yes").length;
    const totalExcess = filtered.reduce((s, p) => s + (p.excess60 || 0), 0);
    const totalRecommended = filtered.reduce((s, p) => s + (p.orderCost || 0), 0);
    const avgError30 = withError30.length > 0 ? withError30.reduce((s, p) => s + p.error30, 0) / withError30.length : null;
    const avgError60 = withError60.length > 0 ? withError60.reduce((s, p) => s + p.error60, 0) / withError60.length : null;
    return {
      totalRows, withError30: withError30.length, withError60: withError60.length,
      stockouts30, stockouts60, totalExcess, totalRecommended,
      avgError30: avgError30 != null ? avgError30.toFixed(1) : null,
      avgError60: avgError60 != null ? avgError60.toFixed(1) : null,
    };
  }, [filtered]);

  const downloadCSV = () => {
    const csv = [headers.join(',')].concat(
      filtered.map(p => headers.map(h => {
        const v = p[Object.keys(p).find(k => {
          // reverse lookup — not perfect but works
          return true;
        })];
        return '"' + String(v || '').replace(/"/g, '""') + '"';
      }).join(','))
    ).join('\n');
    // Simpler: just dump raw rows
    const csv2 = [headers.join(',')].concat(
      rows.filter((_, i) => filtered.some(p => p.coreId === rows[i][idx.core_id] && p.date === rows[i][idx.snapshot_date]))
        .map(r => r.map(c => '"' + String(c || '').replace(/"/g, '""') + '"').join(','))
    ).join('\n');
    const blob = new Blob([csv2], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'recommendation_log.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-8 text-center text-gray-400">Loading performance data...</div>;
  if (error) return <div className="p-8 text-center"><p className="text-red-400 mb-4">Failed to load: {error}</p><button onClick={load} className="bg-blue-600 text-white px-4 py-2 rounded">Retry</button></div>;

  return <div className="p-4 max-w-7xl mx-auto">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-xl font-bold text-white">Performance — Forecast Accuracy</h2>
        <p className="text-gray-500 text-xs mt-1">{R(parsed.length)} total recommendations logged. Actuals fill in after 30/60/90 days.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={load} className="text-xs bg-gray-800 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-700">↻ Refresh</button>
        <button onClick={downloadCSV} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded">⬇ CSV</button>
      </div>
    </div>

    {/* Info banner if no actuals yet */}
    {stats.withError30 === 0 && (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3 mb-4 text-sm text-blue-300">
        ⏳ Waiting for data to mature. Forecast accuracy and stockout metrics will start populating in 30 days.
        For now you can see what the system is recommending and track it.
      </div>
    )}

    {/* Summary KPIs */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <div className="text-gray-500 text-xs uppercase">Recommendations</div>
        <div className="text-white font-bold text-xl">{R(stats.totalRows)}</div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <div className="text-gray-500 text-xs uppercase">Total $ Recommended</div>
        <div className="text-amber-300 font-bold text-xl">{$(stats.totalRecommended)}</div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <div className="text-gray-500 text-xs uppercase">Avg Error 30d</div>
        <div className={`font-bold text-xl ${stats.avgError30 == null ? "text-gray-500" : Math.abs(stats.avgError30) < 15 ? "text-emerald-400" : "text-amber-400"}`}>
          {stats.avgError30 != null ? stats.avgError30 + "%" : "—"}
        </div>
        <div className="text-gray-500 text-[10px]">{stats.withError30} data points</div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
        <div className="text-gray-500 text-xs uppercase">Stockouts 30d</div>
        <div className={`font-bold text-xl ${stats.stockouts30 === 0 ? "text-emerald-400" : "text-red-400"}`}>
          {stats.stockouts30}
        </div>
      </div>
    </div>

    {/* Filters */}
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <input type="text" placeholder="Search core or vendor..." value={search} onChange={e => setSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm w-48" />
      <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5">
        <option value="">All Vendors</option>
        {vendors.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5">
        <option value="">All Status</option>
        <option value="critical">Critical</option>
        <option value="warning">Warning</option>
        <option value="healthy">Healthy</option>
      </select>
      <div className="flex bg-gray-800 rounded-lg p-0.5 ml-2">
        <button onClick={() => setGroupBy("core")} className={`px-3 py-1 rounded text-xs ${groupBy === "core" ? "bg-blue-600 text-white" : "text-gray-400"}`}>By Core</button>
        <button onClick={() => setGroupBy("vendor")} className={`px-3 py-1 rounded text-xs ${groupBy === "vendor" ? "bg-blue-600 text-white" : "text-gray-400"}`}>By Vendor</button>
      </div>
      <span className="text-xs text-gray-500 ml-auto">{R(filtered.length)} rows</span>
    </div>

    {/* Table */}
    {groupBy === "core" ? (
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500 uppercase sticky top-0">
            <tr>
              <th className="py-2 px-2 text-left">Date</th>
              <th className="py-2 px-2 text-left">Core</th>
              <th className="py-2 px-2 text-left">Vendor</th>
              <th className="py-2 px-2 text-right">DSR</th>
              <th className="py-2 px-2 text-right">DOC</th>
              <th className="py-2 px-2 text-left">Status</th>
              <th className="py-2 px-2 text-right">Seasonal Need</th>
              <th className="py-2 px-2 text-right">Order Qty</th>
              <th className="py-2 px-2 text-right">Cost</th>
              <th className="py-2 px-2 text-right">Actual Qty</th>
              <th className="py-2 px-2 text-right">Err 30d</th>
              <th className="py-2 px-2 text-right">Err 60d</th>
              <th className="py-2 px-2 text-center">SO 30d</th>
              <th className="py-2 px-2 text-right">Excess $</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((p, i) => (
              <tr key={i} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-1.5 px-2 text-gray-400">{fmtDate(p.date)}</td>
                <td className="py-1.5 px-2 text-blue-400 font-mono">{p.coreId}</td>
                <td className="py-1.5 px-2 text-gray-300 truncate max-w-[150px]">{p.vendor}</td>
                <td className="py-1.5 px-2 text-right">{D1(p.dsr)}</td>
                <td className={`py-1.5 px-2 text-right font-semibold ${p.status === "critical" ? "text-red-400" : p.status === "warning" ? "text-amber-400" : "text-emerald-400"}`}>{R(p.doc)}</td>
                <td className="py-1.5 px-2 text-gray-400">{p.status}</td>
                <td className="py-1.5 px-2 text-right">{p.seasonalNeed > 0 ? R(p.seasonalNeed) : "—"}</td>
                <td className="py-1.5 px-2 text-right text-white">{p.orderQty > 0 ? R(p.orderQty) : "—"}</td>
                <td className="py-1.5 px-2 text-right text-amber-300">{p.orderCost > 0 ? $(p.orderCost) : "—"}</td>
                <td className="py-1.5 px-2 text-right text-gray-400">{p.actualOrderQty ? R(p.actualOrderQty) : "—"}</td>
                <td className={`py-1.5 px-2 text-right ${p.error30 !== "" && p.error30 != null ? (Math.abs(p.error30) < 15 ? "text-emerald-400" : Math.abs(p.error30) < 30 ? "text-amber-400" : "text-red-400") : "text-gray-600"}`}>
                  {p.error30 !== "" && p.error30 != null ? (p.error30 > 0 ? "+" : "") + p.error30 + "%" : "—"}
                </td>
                <td className={`py-1.5 px-2 text-right ${p.error60 !== "" && p.error60 != null ? (Math.abs(p.error60) < 15 ? "text-emerald-400" : Math.abs(p.error60) < 30 ? "text-amber-400" : "text-red-400") : "text-gray-600"}`}>
                  {p.error60 !== "" && p.error60 != null ? (p.error60 > 0 ? "+" : "") + p.error60 + "%" : "—"}
                </td>
                <td className="py-1.5 px-2 text-center">{p.stockout30 === "yes" ? <span className="text-red-400">⚠</span> : p.stockout30 === "no" ? <span className="text-emerald-400">✓</span> : "—"}</td>
                <td className="py-1.5 px-2 text-right text-red-300">{p.excess60 ? $(p.excess60) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && <div className="text-center text-gray-500 text-xs py-2">Showing first 500 of {filtered.length}. Use filters to narrow down.</div>}
      </div>
    ) : (
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-gray-500 uppercase sticky top-0">
            <tr>
              <th className="py-2 px-2 text-left">Vendor</th>
              <th className="py-2 px-2 text-left">Country</th>
              <th className="py-2 px-2 text-right">Cores</th>
              <th className="py-2 px-2 text-right">Total $ Rec</th>
              <th className="py-2 px-2 text-right">Critical</th>
              <th className="py-2 px-2 text-right">Warning</th>
              <th className="py-2 px-2 text-right">Avg Err 30d</th>
              <th className="py-2 px-2 text-right">Avg Err 60d</th>
              <th className="py-2 px-2 text-right">Stockouts 30d</th>
              <th className="py-2 px-2 text-right">Excess $ 60d</th>
            </tr>
          </thead>
          <tbody>
            {byVendor.map((v, i) => (
              <tr key={i} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-1.5 px-2 text-white font-semibold">{v.vendor}</td>
                <td className="py-1.5 px-2 text-gray-400">{v.country}</td>
                <td className="py-1.5 px-2 text-right">{v.cores}</td>
                <td className="py-1.5 px-2 text-right text-amber-300">{$(v.totalOrderCost)}</td>
                <td className="py-1.5 px-2 text-right text-red-400">{v.criticalCount}</td>
                <td className="py-1.5 px-2 text-right text-amber-400">{v.warningCount}</td>
                <td className={`py-1.5 px-2 text-right ${v.avgError30 != null && Math.abs(v.avgError30) < 15 ? "text-emerald-400" : v.avgError30 != null ? "text-amber-400" : "text-gray-600"}`}>
                  {v.avgError30 != null ? v.avgError30 + "%" : "—"}
                </td>
                <td className={`py-1.5 px-2 text-right ${v.avgError60 != null && Math.abs(v.avgError60) < 15 ? "text-emerald-400" : v.avgError60 != null ? "text-amber-400" : "text-gray-600"}`}>
                  {v.avgError60 != null ? v.avgError60 + "%" : "—"}
                </td>
                <td className={`py-1.5 px-2 text-right ${v.stockouts30 > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {v.stockouts30} ({v.stockoutRate30}%)
                </td>
                <td className="py-1.5 px-2 text-right text-red-300">{v.totalExcess60 > 0 ? $(v.totalExcess60) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>;
}
