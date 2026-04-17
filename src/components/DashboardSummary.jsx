// src/components/DashboardSummary.jsx
import React, { useState, useMemo } from "react";
import { R, D1, $, gS, cAI, isD, gTD } from "../lib/utils";
import { calcPurchaseFrequency } from "../lib/seasonal";
import { Dot, WorkflowChip } from "./Shared";

export default function DashboardSummary({ data, stg, vendorRecs, goVendor, workflow, saveWorkflow, deleteWorkflow, vendorComments, saveVendorComment, onEnterPurchasing, activeBundleCores }) {
if (!vendorRecs || !Object.keys(vendorRecs).length) vendorRecs = {};
  const [originF, setOriginF] = useState("all");
  const [statusF, setStatusF] = useState("untriaged");
  const [needsBuyOnly, setNeedsBuyOnly] = useState(true);
  const [showCleanup, setShowCleanup] = useState(false);
  const [showDead, setShowDead] = useState(false);
  const [showHousekeeping, setShowHousekeeping] = useState(false);
  const [expandedSection, setExpandedSection] = useState({ critical: true, warning: true, ok: false });

  const vMap = useMemo(() => {
    const m = {};
    (data.vendors || []).forEach(v => m[v.name] = v);
    return m;
  }, [data.vendors]);

  // ── Workflow helpers ──
  const wfMap = useMemo(() => {
    const m = {};
    (workflow || []).forEach(w => m[w.id] = w);
    return m;
  }, [workflow]);

  const getWfStatus = (id) => {
    const wf = wfMap[id];
    if (!wf || !wf.status) return null;
    if (wf.ignoreUntil) {
      const d = new Date(wf.ignoreUntil + 'T00:00:00');
      if (!isNaN(d.getTime()) && d < new Date(new Date().toDateString())) return null;
    }
    return wf.status;
  };
  const hasAnyStatus = (id) => !!getWfStatus(id);
  const wfColor = { Buy: "bg-emerald-500/20 text-emerald-400", Reviewing: "bg-amber-500/20 text-amber-400", Ignore: "bg-red-500/20 text-red-400", Done: "bg-blue-500/20 text-blue-400" };

 

  // ── Cleanup lists ──
  const noBundleCores = useMemo(() =>
    (data.cores || []).filter(c => c.active === "Yes" && c.visible === "Yes" && !activeBundleCores.has(c.id) && c.dsr > 0)
  , [data.cores, activeBundleCores]);

  const deadCores = useMemo(() =>
    (data.cores || []).filter(c => c.active === "Yes" && c.visible === "Yes" && !activeBundleCores.has(c.id) && (!c.dsr || c.dsr === 0))
  , [data.cores, activeBundleCores]);

  const noBundleSet = useMemo(() => {
    const s = new Set();
    noBundleCores.forEach(c => s.add(c.id));
    deadCores.forEach(c => s.add(c.id));
    return s;
  }, [noBundleCores, deadCores]);

  // ── Vendor-level aggregation (v2 recommender) ──
  const vendorStats = useMemo(() => {
    const g = {};
    (data.cores || []).filter(c => {
      if (stg.fA === "yes" && c.active !== "Yes") return false;
      if (stg.fA === "no" && c.active === "Yes") return false;
      if (stg.fV === "yes" && c.visible !== "Yes") return false;
      if (stg.fV === "no" && c.visible === "Yes") return false;
      if (stg.fI === "blank" && !!c.ignoreUntil) return false;
      if (noBundleSet.has(c.id)) return false;
      return true;
    }).forEach(c => {
      const v = vMap[c.ven] || {};
      const lt = v.lt || 30;
      const effectiveDoc = c.dsr > 0 ? Math.round(cAI(c) / c.dsr) : c.doc;
      const st = gS(effectiveDoc, lt, c.buf || 14, stg);

      // v2 recommender lookup (authoritative for need/order/cost)
      const vRec = vendorRecs[c.ven];
      const cDet = vRec?.coreDetails?.find(x => x.coreId === c.id);
      const nq = cDet?.needPieces || 0;
      const oq = cDet?.finalQty || 0;
      const unitCost = vRec?.priceMap?.[c.id] || c.cost || 0;
      const cost = oq * unitCost;
      const isUrgent = cDet?.urgent || false;

      if (!g[c.ven]) g[c.ven] = {
        name: c.ven, country: v.country || "", lt, moq: v.moqDollar || 0,
        payment: v.payment || "", isDom: isD(v.country),
        cr: 0, wa: 0, he: 0, cores: 0, needBuy: 0,
        totalCost: 0, minDoc: Infinity, totalDsr: 0,
        critCores: [], warnCores: [], hasUrgent: false
      };
      const vs = g[c.ven];

      if (st === "critical" && nq > 0) {
        vs.cr++;
      } else if (st === "critical" && nq <= 0) {
        vs.he++; // covered by bundles/raw, not actionable
      } else if (st === "warning") {
        vs.wa++;
      } else {
        vs.he++;
      }

      vs.cores++;
      vs.totalDsr += c.dsr || 0;
      if (effectiveDoc < vs.minDoc) vs.minDoc = effectiveDoc;
      if (nq > 0) { vs.needBuy++; vs.totalCost += cost; }
      if (isUrgent) vs.hasUrgent = true;
      if (st === "critical" && nq > 0) vs.critCores.push({ id: c.id, ti: c.ti, doc: effectiveDoc, dsr: c.dsr, needQty: nq, cost });
      if (st === "warning") vs.warnCores.push({ id: c.id, ti: c.ti, doc: effectiveDoc, dsr: c.dsr, needQty: nq, cost });
    });

    // Use recommender's vendor-level totalCost for consistency with PurchTab
    for (const vs of Object.values(g)) {
      const vRec = vendorRecs[vs.name];
      if (vRec && vRec.totalCost > 0) {
        vs.totalCost = vRec.totalCost;
      }
    }

    return Object.values(g).map(v => ({
      ...v,
      minDoc: v.minDoc === Infinity ? 0 : v.minDoc,
      urgency: v.cr > 0 ? "critical" : v.wa > 0 ? "warning" : "ok"
    }));
  }, [data.cores, vMap, stg, noBundleSet, vendorRecs]);

  // ── Apply origin + status + needsBuy filters ──
  const filtered = useMemo(() => {
    let arr = vendorStats;
    if (originF === "us") arr = arr.filter(v => v.isDom);
    if (originF === "intl") arr = arr.filter(v => !v.isDom);
    // Needs-buy filter (default ON)
    if (needsBuyOnly) arr = arr.filter(v => v.needBuy > 0 || v.hasUrgent);
    // Status filter
    if (statusF === "untriaged") arr = arr.filter(v => !hasAnyStatus(v.name));
    else if (statusF === "Buy") arr = arr.filter(v => getWfStatus(v.name) === "Buy");
    else if (statusF === "Reviewing") arr = arr.filter(v => getWfStatus(v.name) === "Reviewing");
    else if (statusF === "Ignore") arr = arr.filter(v => getWfStatus(v.name) === "Ignore");
    else if (statusF === "Done") arr = arr.filter(v => getWfStatus(v.name) === "Done");
    return arr;
  }, [vendorStats, originF, statusF, needsBuyOnly, wfMap]);

  // ── Sorting: urgent first, then totalCost desc ──
  const sortedVendors = useMemo(() =>
    [...filtered].sort((a, b) => {
      if (a.hasUrgent !== b.hasUrgent) return a.hasUrgent ? -1 : 1;
      return b.totalCost - a.totalCost;
    })
  , [filtered]);

  const critVendors = useMemo(() => sortedVendors.filter(v => v.urgency === "critical"), [sortedVendors]);
  const warnVendors = useMemo(() => sortedVendors.filter(v => v.urgency === "warning"), [sortedVendors]);
  const okVendors = useMemo(() => sortedVendors.filter(v => v.urgency === "ok"), [sortedVendors]);

  // Totals from filtered
  const totalCrit = filtered.reduce((s, v) => s + v.cr, 0);
  const totalWarn = filtered.reduce((s, v) => s + v.wa, 0);
  const totalOk = filtered.reduce((s, v) => s + v.he, 0);
  const critCost = critVendors.reduce((s, v) => s + v.totalCost, 0);
  const totalCost = filtered.reduce((s, v) => s + v.totalCost, 0);
  const critVendorCount = critVendors.length;

  // Count by workflow status (for filter labels)
  const wfCounts = useMemo(() => {
    const c = { untriaged: 0, Buy: 0, Reviewing: 0, Ignore: 0, Done: 0 };
    let arr = vendorStats;
    if (originF === "us") arr = arr.filter(v => v.isDom);
    if (originF === "intl") arr = arr.filter(v => !v.isDom);
    if (needsBuyOnly) arr = arr.filter(v => v.needBuy > 0 || v.hasUrgent);
    arr.forEach(v => {
      const st = getWfStatus(v.name);
      if (!st) c.untriaged++;
      else if (c[st] !== undefined) c[st]++;
    });
    return c;
  }, [vendorStats, originF, needsBuyOnly, wfMap]);

  const downloadCSV = (rows, filename, header) => {
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Vendor Card ──
  const VendorCard = ({ v }) => {
    const borderCls = v.urgency === "critical" ? "border-red-500/30" : v.urgency === "warning" ? "border-amber-500/30" : "border-gray-800";
    const wfSt = getWfStatus(v.name);
    return (
      <div className={`border rounded-lg ${borderCls} hover:border-gray-600 transition-colors`}>
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/50 hover:bg-gray-800/80">
          <div className="cursor-pointer flex items-center gap-3 flex-1 min-w-0" onClick={() => goVendor(v.name)}>
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
                {v.hasUrgent && <span className="text-red-400 font-bold">⚠ URGENT</span>}
                {v.minDoc <= 7 && v.minDoc >= 0 && <span className="text-red-400 font-bold">DOC {v.minDoc}d</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {v.totalCost > 0 && <span className="text-amber-300 text-sm font-semibold">{$(v.totalCost)}</span>}
              <span className="text-gray-600 text-xs">→</span>
            </div>
          </div>
          <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
            <WorkflowChip id={v.name} type="vendor" workflow={workflow} onSave={saveWorkflow} onDelete={deleteWorkflow} buyer={stg.buyer || ""} />
          </div>
        </div>
        {v.critCores.length > 0 && v.critCores.length <= 5 && (
          <div className="px-4 py-2 bg-gray-950/50 border-t border-gray-800/50 space-y-1">
            {v.critCores.slice(0, 3).map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="text-blue-400 font-mono">{c.id}</span>
                <span className="text-gray-400 truncate flex-1">{c.ti}</span>
                <span className="text-red-400 font-semibold">DOC {Math.round(c.doc)}</span>
                {c.cost > 0 && <span className="text-gray-500">{$(Math.round(c.cost))}</span>}
              </div>
            ))}
            {v.critCores.length > 3 && <span className="text-[10px] text-gray-600">+{v.critCores.length - 3} more</span>}
          </div>
        )}
      </div>
    );
  };

  const Section = ({ id, label, count, vendors }) => {
    const isOpen = expandedSection[id] ?? false;
    if (vendors.length === 0) return null;
    const colorCls = { critical: "text-red-400", warning: "text-amber-400", ok: "text-emerald-400" };
    return (
      <div className="mb-6">
        <button onClick={() => setExpandedSection(p => ({ ...p, [id]: !isOpen }))} className="flex items-center gap-2 mb-3 group">
          <span className="text-xs text-gray-500 w-4">{isOpen ? "▼" : "▶"}</span>
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${colorCls[id] || "text-gray-400"}`}>{label}</h3>
          <span className="text-xs text-gray-500">({count} cores in {vendors.length} vendors)</span>
        </button>
        {isOpen && <div className="space-y-2">{vendors.map(v => <VendorCard key={v.name} v={v} />)}</div>}
      </div>
    );
  };

  const filteredNoBundleCores = useMemo(() => {
    if (originF === "all") return noBundleCores;
    return noBundleCores.filter(c => { const v = vMap[c.ven]; return originF === "us" ? isD(v?.country) : !isD(v?.country); });
  }, [noBundleCores, originF, vMap]);

  const filteredDeadCores = useMemo(() => {
    if (originF === "all") return deadCores;
    return deadCores.filter(c => { const v = vMap[c.ven]; return originF === "us" ? isD(v?.country) : !isD(v?.country); });
  }, [deadCores, originF, vMap]);

  return (
    <div className="p-4 max-w-4xl mx-auto">
      {totalCrit > 0 && (
        <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-5 mb-3">
          <div className="flex justify-between items-start flex-wrap gap-3">
            <div>
              <div className="text-sm text-red-300 font-medium mb-1">Needs action today</div>
              <div className="text-3xl font-bold text-white">{totalCrit} critical product{totalCrit !== 1 ? "s" : ""}</div>
              <div className="text-sm text-gray-400 mt-1">across {critVendorCount} vendor{critVendorCount !== 1 ? "s" : ""} — {$(critCost)} est.</div>
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

      {/* ══ Filters ══ */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select value={originF} onChange={e => setOriginF(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5">
          <option value="all">All Origins</option>
          <option value="us">US Only</option>
          <option value="intl">International</option>
        </select>

        {/* Needs-buy toggle */}
        <button
          onClick={() => setNeedsBuyOnly(!needsBuyOnly)}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium ${needsBuyOnly ? "bg-blue-600 text-white" : "bg-gray-800 border border-gray-700 text-gray-400"}`}
        >
          {needsBuyOnly ? "Needs Buy Only ✓" : "All Vendors"}
        </button>

        {/* Status/triage filter */}
        <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
          {[
            { k: "untriaged", l: "To Do", c: wfCounts.untriaged },
            { k: "all", l: "All", c: null },
            { k: "Buy", l: "Buy", c: wfCounts.Buy },
            { k: "Reviewing", l: "Review", c: wfCounts.Reviewing },
            { k: "Ignore", l: "Ignore", c: wfCounts.Ignore },
            { k: "Done", l: "Done", c: wfCounts.Done },
          ].map(f => (
            <button key={f.k} onClick={() => setStatusF(f.k)}
              className={`px-2 py-1 rounded text-xs font-medium ${statusF === f.k ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"}`}>
              {f.l}{f.c != null && f.c > 0 ? ` ${f.c}` : ""}
            </button>
          ))}
        </div>

        <button onClick={() => setShowHousekeeping(!showHousekeeping)} className={`text-xs px-3 py-1.5 rounded-lg font-medium ${showHousekeeping ? "bg-amber-600 text-white" : "bg-gray-800 border border-gray-700 text-gray-400"}`}>
          {filteredNoBundleCores.length + filteredDeadCores.length} Cleanup{showHousekeeping ? " ✓" : ""}
        </button>

        <div className="flex gap-2 text-xs ml-auto">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{totalCrit}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{totalWarn}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{totalOk}</span>
        </div>

        <button onClick={onEnterPurchasing} className="text-xs bg-blue-600/80 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors">
          Full Purchasing View →
        </button>
      </div>

      {/* ══ Housekeeping ══ */}
      {showHousekeeping && (
        <div className="space-y-2 mb-5">
          {filteredNoBundleCores.length > 0 && (
            <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-2.5">
              <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowCleanup(!showCleanup)}>
                <span className="text-xs text-gray-400">{filteredNoBundleCores.length} active core{filteredNoBundleCores.length !== 1 ? "s" : ""} with sales but no active bundle</span>
                <div className="flex items-center gap-2">
                  <button onClick={e => { e.stopPropagation(); downloadCSV(filteredNoBundleCores.map(c => [c.id, '"' + (c.ti || "").replace(/"/g, '""') + '"', '"' + (c.ven || "") + '"', c.dsr || 0, c.doc || 0, cAI(c), c.moq || 0].join(",")), "cores_no_bundle.csv", "Core ID,Title,Vendor,DSR,DOC,All-In,MOQ"); }} className="text-[10px] text-blue-400 hover:text-blue-300 bg-blue-400/10 px-2 py-0.5 rounded">CSV</button>
                  <span className="text-[10px] text-gray-600">{showCleanup ? "▲" : "▼"}</span>
                </div>
              </div>
              {showCleanup && (
                <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                  {filteredNoBundleCores.slice(0, 20).map(c => (
                    <div key={c.id} className="flex items-center gap-3 text-[11px] text-gray-500 py-0.5">
                      <span className="text-blue-400 font-mono">{c.id}</span>
                      <span className="truncate flex-1">{c.ti}</span>
                      <span>{c.ven}</span>
                      <span>DSR:{D1(c.dsr)}</span>
                    </div>
                  ))}
                  {filteredNoBundleCores.length > 20 && <span className="text-[10px] text-gray-600">+{filteredNoBundleCores.length - 20} more</span>}
                </div>
              )}
            </div>
          )}
          {filteredDeadCores.length > 0 && (
            <div className="bg-red-900/10 border border-red-500/15 rounded-lg px-4 py-2.5">
              <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowDead(!showDead)}>
                <span className="text-xs text-red-400/80">{filteredDeadCores.length} active core{filteredDeadCores.length !== 1 ? "s" : ""} with NO sales and NO active bundle — consider deactivating</span>
                <div className="flex items-center gap-2">
                  <button onClick={e => { e.stopPropagation(); downloadCSV(filteredDeadCores.map(c => [c.id, '"' + (c.ti || "").replace(/"/g, '""') + '"', '"' + (c.ven || "") + '"', c.doc || 0, cAI(c), c.moq || 0].join(",")), "dead_cores_no_bundle_no_sales.csv", "Core ID,Title,Vendor,DOC,All-In,MOQ"); }} className="text-[10px] text-red-400 hover:text-red-300 bg-red-400/10 px-2 py-0.5 rounded">CSV</button>
                  <span className="text-[10px] text-gray-600">{showDead ? "▲" : "▼"}</span>
                </div>
              </div>
              {showDead && (
                <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                  {filteredDeadCores.slice(0, 20).map(c => (
                    <div key={c.id} className="flex items-center gap-3 text-[11px] text-gray-500 py-0.5">
                      <span className="text-blue-400 font-mono">{c.id}</span>
                      <span className="truncate flex-1">{c.ti}</span>
                      <span>{c.ven}</span>
                      <span className="text-red-400/60">DSR: 0</span>
                    </div>
                  ))}
                  {filteredDeadCores.length > 20 && <span className="text-[10px] text-gray-600">+{filteredDeadCores.length - 20} more — download CSV for full list</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ Vendors by urgency ══ */}
      <Section id="critical" label="Critical — order now" count={totalCrit} vendors={critVendors} />
      <Section id="warning" label="Warning — plan this week" count={totalWarn} vendors={warnVendors} />
      <Section id="ok" label="Healthy — no action needed" count={totalOk} vendors={okVendors} />

      {filtered.length === 0 && (
        <div className="text-center text-gray-500 py-12">
          {needsBuyOnly ? "No vendors need buying right now! Turn off 'Needs Buy Only' to see all." : statusF === "untriaged" ? "All vendors have been triaged! Switch to a status filter to review them." : "No vendors match current filters."}
        </div>
      )}
    </div>
  );
}
