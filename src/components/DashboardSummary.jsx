// src/components/DashboardSummary.jsx
// Layer 1 + Layer 2: Actionable entry point for the FBA Dashboard
// Drop this file into src/components/ and wire it in App.jsx (see instructions below)

import React, { useState, useMemo } from "react";
import { R, D1, $, gS, cAI, cNQ, gTD, isD } from "../lib/utils";
import { Dot, WorkflowChip, VendorNotes } from "./Shared";

export default function DashboardSummary({ data, stg, goVendor, workflow, saveWorkflow, deleteWorkflow, vendorComments, saveVendorComment, onEnterPurchasing }) {
  const [originF, setOriginF] = useState("all");
  const [showCleanup, setShowCleanup] = useState(false);
  const [showDead, setShowDead] = useState(false);
  const [expandedSection, setExpandedSection] = useState({ critical: true, warning: true, ok: false });

  const vMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => m[v.name] = v);
    return m;
  }, [data.vendors]);

  // ── Identify cores without bundles (active cores with no active bundle) ──
  const activeBundleCores = useMemo(() => {
    const set = new Set();
    const activeBundleJLS = new Set();
    (data.bundles || []).filter(b => b.active === "Yes").forEach(b => {
      // Direct core1/core2/core3 links
      if (b.core1) set.add(b.core1);
      if (b.core2) set.add(b.core2);
      if (b.core3) set.add(b.core3);
      // Track active bundle JLS for jlsList matching
      activeBundleJLS.add(b.j.trim().toLowerCase());
    });
    // Also check cores' jlsList field (Attached JLS #s)
    (data.cores || []).forEach(c => {
      if (set.has(c.id)) return; // already matched
      const raw = (c.jlsList || "").split(/[,;\n\r]+/).map(j => j.trim().toLowerCase()).filter(Boolean);
      if (raw.some(j => activeBundleJLS.has(j))) set.add(c.id);
    });
    return set;
  }, [data.bundles, data.cores]);

  const noBundleCores = useMemo(() =>
    (data.cores || []).filter(c => c.active === "Yes" && c.visible === "Yes" && !activeBundleCores.has(c.id) && c.dsr > 0)
  , [data.cores, activeBundleCores]);

  const deadCores = useMemo(() =>
    (data.cores || []).filter(c => c.active === "Yes" && c.visible === "Yes" && !activeBundleCores.has(c.id) && (!c.dsr || c.dsr === 0))
  , [data.cores, activeBundleCores]);

  // ── Vendor-level aggregation ──
  const vendorStats = useMemo(() => {
    const g = {};
    (data.cores || []).filter(c => {
      if (stg.fA === "yes" && c.active !== "Yes") return false;
      if (stg.fA === "no" && c.active === "Yes") return false;
      if (stg.fV === "yes" && c.visible !== "Yes") return false;
      if (stg.fV === "no" && c.visible === "Yes") return false;
      if (stg.fI === "blank" && !!c.ignoreUntil) return false;
      if (stg.fI === "set" && !c.ignoreUntil) return false;
      return true;
    }).forEach(c => {
      const v = vMap[c.ven] || {};
      const lt = v.lt || 30;
      const tg = gTD(v, stg);
      const st = gS(c.doc, lt, c.buf || 14, stg);
      const nq = cNQ(c, tg);
      const oq = nq > 0 ? Math.max(nq, c.moq || 0) : 0;
      const cost = oq * (c.cost || 0);

      if (!g[c.ven]) g[c.ven] = {
        name: c.ven, country: v.country || "", lt: lt, moq: v.moqDollar || 0,
        payment: v.payment || "", isDom: isD(v.country),
        cr: 0, wa: 0, he: 0, cores: 0, needBuy: 0,
        totalCost: 0, minDoc: Infinity, totalDsr: 0,
        critCores: [], warnCores: []
      };

      const vs = g[c.ven];
      vs[st === "critical" ? "cr" : st === "warning" ? "wa" : "he"]++;
      vs.cores++;
      vs.totalDsr += c.dsr || 0;
      if (c.doc < vs.minDoc) vs.minDoc = c.doc;
      if (nq > 0) { vs.needBuy++; vs.totalCost += cost; }
      if (st === "critical") vs.critCores.push({ id: c.id, ti: c.ti, doc: c.doc, dsr: c.dsr, needQty: nq, cost });
      if (st === "warning") vs.warnCores.push({ id: c.id, ti: c.ti, doc: c.doc, dsr: c.dsr, needQty: nq, cost });
    });

    return Object.values(g).map(v => ({
      ...v,
      minDoc: v.minDoc === Infinity ? 0 : v.minDoc,
      urgency: v.cr > 0 ? "critical" : v.wa > 0 ? "warning" : "ok"
    }));
  }, [data.cores, vMap, stg]);

  // ── Apply origin filter ──
  const filtered = useMemo(() => {
    let arr = vendorStats;
    if (originF === "us") arr = arr.filter(v => v.isDom);
    if (originF === "intl") arr = arr.filter(v => !v.isDom);
    return arr;
  }, [vendorStats, originF]);

  // ── Group by urgency ──
  const critVendors = useMemo(() => filtered.filter(v => v.urgency === "critical").sort((a, b) => a.minDoc - b.minDoc), [filtered]);
  const warnVendors = useMemo(() => filtered.filter(v => v.urgency === "warning").sort((a, b) => a.minDoc - b.minDoc), [filtered]);
  const okVendors = useMemo(() => filtered.filter(v => v.urgency === "ok").sort((a, b) => a.name.localeCompare(b.name)), [filtered]);

  // ── Totals ──
  const totalCrit = filtered.reduce((s, v) => s + v.cr, 0);
  const totalWarn = filtered.reduce((s, v) => s + v.wa, 0);
  const totalOk = filtered.reduce((s, v) => s + v.he, 0);
  const critCost = critVendors.reduce((s, v) => s + v.totalCost, 0);
  const totalCost = filtered.reduce((s, v) => s + v.totalCost, 0);
  const critVendorCount = critVendors.length;

  // ── Workflow helpers ──
  const isIgnored = (id) => {
    const wf = (workflow || []).find(w => w.id === id);
    if (!wf || wf.status !== "Ignore") return false;
    if (!wf.ignoreUntil) return true;
    const until = new Date(wf.ignoreUntil);
    return !isNaN(until.getTime()) && until >= new Date(new Date().toDateString());
  };

  const getWfStatus = (id) => {
    const wf = (workflow || []).find(w => w.id === id);
    return wf?.status || null;
  };

  const wfColor = { Buy: "bg-emerald-500/20 text-emerald-400", Reviewing: "bg-amber-500/20 text-amber-400", Ignore: "bg-red-500/20 text-red-400", Done: "bg-blue-500/20 text-blue-400" };

  // ── Vendor Card ──
  const VendorCard = ({ v }) => {
    if (isIgnored(v.name)) return null;
    const borderCls = v.urgency === "critical" ? "border-red-500/30" : v.urgency === "warning" ? "border-amber-500/30" : "border-gray-800";
    const wfSt = getWfStatus(v.name);

    return (
      <div className={`border rounded-lg overflow-hidden ${borderCls} hover:border-gray-600 transition-colors`}>
        <div
          className="flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800/80 cursor-pointer"
          onClick={() => goVendor(v.name)}
        >
          <Dot status={v.urgency} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-semibold text-sm">{v.name}</span>
              <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">{v.country || "—"}</span>
              <span className="text-[10px] text-gray-500">LT:{v.lt}d</span>
              {wfSt && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${wfColor[wfSt] || "bg-gray-700 text-gray-400"}`}>{wfSt}</span>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span>{v.cores} cores</span>
              {v.cr > 0 && <span className="text-red-400 font-semibold">{v.cr} critical</span>}
              {v.wa > 0 && <span className="text-amber-400 font-semibold">{v.wa} warning</span>}
              {v.needBuy > 0 && <span className="text-amber-300">{v.needBuy} need buy</span>}
              {v.minDoc <= 7 && v.minDoc >= 0 && <span className="text-red-400 font-bold">DOC {v.minDoc}d</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {v.totalCost > 0 && <span className="text-amber-300 text-sm font-semibold">{$(v.totalCost)}</span>}
            <span className="text-gray-600 text-xs">→</span>
          </div>
        </div>
        {/* Top critical cores preview */}
        {v.critCores.length > 0 && v.critCores.length <= 5 && (
          <div className="px-4 py-2 bg-gray-950/50 border-t border-gray-800/50 space-y-1">
            {v.critCores.slice(0, 3).map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="text-blue-400 font-mono">{c.id}</span>
                <span className="text-gray-400 truncate flex-1">{c.ti}</span>
                <span className="text-red-400 font-semibold">DOC {c.doc}</span>
                {c.cost > 0 && <span className="text-gray-500">{$(c.cost)}</span>}
              </div>
            ))}
            {v.critCores.length > 3 && <span className="text-[10px] text-gray-600">+{v.critCores.length - 3} more</span>}
          </div>
        )}
      </div>
    );
  };

  // ── Section Toggle ──
  const Section = ({ id, label, count, color, vendors, defaultOpen }) => {
    const isOpen = expandedSection[id] ?? defaultOpen;
    if (vendors.length === 0) return null;
    const colorCls = { critical: "text-red-400", warning: "text-amber-400", ok: "text-emerald-400" };
    return (
      <div className="mb-6">
        <button
          onClick={() => setExpandedSection(p => ({ ...p, [id]: !isOpen }))}
          className="flex items-center gap-2 mb-3 group"
        >
          <span className="text-xs text-gray-500 w-4">{isOpen ? "▼" : "▶"}</span>
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${colorCls[id] || "text-gray-400"}`}>
            {label}
          </h3>
          <span className="text-xs text-gray-500">({count} cores in {vendors.length} vendors)</span>
        </button>
        {isOpen && (
          <div className="space-y-2">
            {vendors.map(v => <VendorCard key={v.name} v={v} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      {/* ══ LAYER 1: 3-second summary ══ */}
      {totalCrit > 0 && (
        <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-5 mb-3">
          <div className="flex justify-between items-start flex-wrap gap-3">
            <div>
              <div className="text-sm text-red-300 font-medium mb-1">Needs action today</div>
              <div className="text-3xl font-bold text-white">
                {totalCrit} critical product{totalCrit !== 1 ? "s" : ""}
              </div>
              <div className="text-sm text-gray-400 mt-1">
                across {critVendorCount} vendor{critVendorCount !== 1 ? "s" : ""} — {$(critCost)} est.
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total pipeline</div>
              <div className="text-xl font-semibold text-gray-200">{$(totalCost)}</div>
            </div>
          </div>
        </div>
      )}

      {totalWarn > 0 && (
        <div className="bg-amber-500/6 border border-amber-500/20 rounded-xl px-5 py-3 mb-3">
          <span className="text-sm text-amber-400 font-medium">{totalWarn} warning product{totalWarn !== 1 ? "s" : ""}</span>
          <span className="text-sm text-gray-500 ml-2">— plan this week</span>
        </div>
      )}

      {/* Cores without bundles */}
      {noBundleCores.length > 0 && (
        <div
          className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-2.5 mb-5"
        >
          <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowCleanup(!showCleanup)}>
            <span className="text-xs text-gray-400">
              🧹 {noBundleCores.length} active core{noBundleCores.length !== 1 ? "s" : ""} with sales but no active bundle
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={e => {
                  e.stopPropagation();
                  const header = "Core ID,Title,Vendor,DSR,DOC,All-In,MOQ\n";
                  const rows = noBundleCores.map(c => [c.id, '"' + (c.ti || "").replace(/"/g, '""') + '"', '"' + (c.ven || "") + '"', c.dsr || 0, c.doc || 0, cAI(c), c.moq || 0].join(",")).join("\n");
                  const blob = new Blob([header + rows], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "cores_no_bundle.csv"; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-[10px] text-blue-400 hover:text-blue-300 bg-blue-400/10 px-2 py-0.5 rounded"
              >⬇ CSV</button>
              <span className="text-[10px] text-gray-600">{showCleanup ? "▲" : "▼"}</span>
            </div>
          </div>
          {showCleanup && (
            <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
              {noBundleCores.slice(0, 20).map(c => (
                <div key={c.id} className="flex items-center gap-3 text-[11px] text-gray-500 py-0.5">
                  <span className="text-blue-400 font-mono">{c.id}</span>
                  <span className="truncate flex-1">{c.ti}</span>
                  <span>{c.ven}</span>
                  <span>DSR:{D1(c.dsr)}</span>
                </div>
              ))}
              {noBundleCores.length > 20 && <span className="text-[10px] text-gray-600">+{noBundleCores.length - 20} more</span>}
            </div>
          )}
        </div>
      )}

      {/* Dead cores: active, no bundle, no sales */}
      {deadCores.length > 0 && (
        <div className="bg-red-900/10 border border-red-500/15 rounded-lg px-4 py-2.5 mb-5">
          <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowDead(!showDead)}>
            <span className="text-xs text-red-400/80">
              ⚠ {deadCores.length} active core{deadCores.length !== 1 ? "s" : ""} with NO sales and NO active bundle — consider deactivating
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={e => {
                  e.stopPropagation();
                  const header = "Core ID,Title,Vendor,DOC,All-In,MOQ\n";
                  const rows = deadCores.map(c => [c.id, '"' + (c.ti || "").replace(/"/g, '""') + '"', '"' + (c.ven || "") + '"', c.doc || 0, cAI(c), c.moq || 0].join(",")).join("\n");
                  const blob = new Blob([header + rows], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "dead_cores_no_bundle_no_sales.csv"; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-[10px] text-red-400 hover:text-red-300 bg-red-400/10 px-2 py-0.5 rounded"
              >⬇ CSV</button>
              <span className="text-[10px] text-gray-600">{showDead ? "▲" : "▼"}</span>
            </div>
          </div>
          {showDead && (
            <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
              {deadCores.slice(0, 20).map(c => (
                <div key={c.id} className="flex items-center gap-3 text-[11px] text-gray-500 py-0.5">
                  <span className="text-blue-400 font-mono">{c.id}</span>
                  <span className="truncate flex-1">{c.ti}</span>
                  <span>{c.ven}</span>
                  <span className="text-red-400/60">DSR: 0</span>
                </div>
              ))}
              {deadCores.length > 20 && <span className="text-[10px] text-gray-600">+{deadCores.length - 20} more — download CSV for full list</span>}
            </div>
          )}
        </div>
      )}

      {/* ══ Filters + Enter full view ══ */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select
          value={originF}
          onChange={e => setOriginF(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"
        >
          <option value="all">All Origins</option>
          <option value="us">US Only</option>
          <option value="intl">International</option>
        </select>

        <div className="flex gap-2 text-xs ml-auto">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{totalCrit}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{totalWarn}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{totalOk}</span>
        </div>

        <button
          onClick={onEnterPurchasing}
          className="text-xs bg-blue-600/80 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors"
        >
          Full Purchasing View →
        </button>
      </div>

      {/* ══ LAYER 2: Vendors by urgency ══ */}
      <Section id="critical" label="Critical — order now" count={totalCrit} vendors={critVendors} />
      <Section id="warning" label="Warning — plan this week" count={totalWarn} vendors={warnVendors} />
      <Section id="ok" label="Healthy — no action needed" count={totalOk} vendors={okVendors} defaultOpen={false} />

      {filtered.length === 0 && (
        <div className="text-center text-gray-500 py-12">No vendors match current filters.</div>
      )}
    </div>
  );
}
