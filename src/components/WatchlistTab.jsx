// src/components/WatchlistTab.jsx
// ============================================================
// Watchlist — items that need periodic review but are NOT in the
// Purchasing flow. Three sections:
//   1. Dormant items to review (DORMANT_REVIVED)
//      Engine declined safety stock (Sprint 2 Fix 6). Operator
//      decides to discontinue or wait for organic revival.
//   2. Intermittent items (DSR < 0.3)
//      Low-velocity but still selling. Periodic check-in.
//   3. Persistent stockouts — placeholder for future sprint.
//
// Sprint 3 Fix 5: dormant + intermittent sections exclude bundles
// that are inactive or have ignoreUntil set, AND skip bundles
// whose every associated core is inactive/ignored. Those items
// are already out of the workflow and don't need review here.
// ============================================================

import React, { useContext, useMemo, useState } from "react";
import { R, D1, $, fD } from "../lib/utils";
import { WhyBuyCtx } from "../App";

const fmt0 = (n) => n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');

function Section({ title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6 border border-gray-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex items-center justify-between bg-gray-900 hover:bg-gray-800/60"
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-500 text-xs">{open ? '▼' : '▶'}</span>
          <h3 className="text-white font-semibold text-sm">{title}</h3>
          <span className="text-xs text-gray-500">({count})</span>
        </div>
      </button>
      {open && <div className="bg-gray-950/60">{children}</div>}
    </div>
  );
}

function DiscontinuePlaceholder({ bundleId }) {
  return (
    <button
      onClick={() => alert(`Mark ${bundleId} as discontinued — feature pending. For now, manage it from the Sheet.`)}
      className="text-[10px] text-red-400/80 hover:text-red-300 underline"
      title="Placeholder — integration with the item-management system ships in a future sprint."
    >
      Mark discontinued
    </button>
  );
}

export default function WatchlistTab({ data, vendorRecs }) {
  const whyBuy = useContext(WhyBuyCtx);

  const bundleById = useMemo(() => {
    const m = {};
    (data.bundles || []).forEach(b => { if (b?.j) m[b.j] = b; });
    return m;
  }, [data.bundles]);

  const coresById = useMemo(() => {
    const m = {};
    (data.cores || []).forEach(c => { if (c?.id) m[c.id] = c; });
    return m;
  }, [data.cores]);

  // True iff bundle is active+not-ignored AND at least one of its
  // referenced cores is active+not-ignored. Bundles whose every core
  // has been deactivated or ignored are out of the workflow already.
  const isInWorkflow = (b) => {
    if (!b) return false;
    if (b.active !== 'Yes' || b.ignoreUntil) return false;
    const coreIds = [];
    for (let i = 1; i <= 20; i++) {
      const cid = b['core' + i];
      if (cid) coreIds.push(cid);
    }
    if (coreIds.length === 0) return true; // no cores referenced → don't filter out
    return coreIds.some(cid => {
      const c = coresById[cid];
      return c && c.active === 'Yes' && !c.ignoreUntil;
    });
  };

  // ── Section 1: Dormant ──
  const dormantItems = useMemo(() => {
    const out = [];
    for (const [vendorName, rec] of Object.entries(vendorRecs || {})) {
      if (!rec?.bundleDetails) continue;
      for (const bd of rec.bundleDetails) {
        if (!bd.dormantRevived) continue;
        const b = bundleById[bd.bundleId];
        if (!isInWorkflow(b)) continue;
        out.push({
          bundleId: bd.bundleId,
          title: b?.t || bd.bundleId,
          vendor: vendorName,
          lastSaleDate: bd.lastSaleDate,
          daysDormant: bd.daysDormant,
          historicalDsr: bd.historicalDsr,
          totalAvailable: bd.totalAvailable,
          wouldHaveBought: bd.dormantRevivedSafetyDeclined?.wouldHaveBought || 0,
          wouldHaveCost: bd.dormantRevivedSafetyDeclined?.wouldHaveCost || 0,
        });
      }
    }
    out.sort((a, b) => (b.daysDormant || 0) - (a.daysDormant || 0));
    return out;
  }, [vendorRecs, bundleById, coresById]);

  // ── Section 2: Intermittent (DSR < 0.3, not classified DORMANT_REVIVED) ──
  // We compute a 60d mean from bundleDays so we don't depend on legacy b.cd.
  const intermittentItems = useMemo(() => {
    if (!data.bundleDaysForecast?.length) return [];
    const byJ = {};
    for (const d of data.bundleDaysForecast) {
      if (!d || !d.j) continue;
      let arr = byJ[d.j];
      if (!arr) { arr = []; byJ[d.j] = arr; }
      arr.push(d);
    }
    for (const j of Object.keys(byJ)) {
      byJ[j].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
    const out = [];
    for (const [vendorName, rec] of Object.entries(vendorRecs || {})) {
      if (!rec?.bundleDetails) continue;
      for (const bd of rec.bundleDetails) {
        if (bd.dormantRevived) continue; // already in section 1
        const series = byJ[bd.bundleId] || [];
        const last60 = series.slice(-60);
        if (last60.length < 30) continue; // skip too-short series (NEW_OR_SPARSE handles those)
        const totalUnits = last60.reduce((s, d) => s + (Number(d.dsr) || 0), 0);
        const dsr60 = last60.length ? totalUnits / last60.length : 0;
        if (dsr60 >= 0.3) continue;
        const b = bundleById[bd.bundleId];
        if (!isInWorkflow(b)) continue;
        out.push({
          bundleId: bd.bundleId,
          title: b?.t || bd.bundleId,
          vendor: vendorName,
          lastSaleDate: bd.lastSaleDate,
          daysDormant: bd.daysDormant,
          historicalDsr: bd.historicalDsr,
          totalAvailable: bd.totalAvailable,
          dsr60,
          recentSales60d: Math.round(totalUnits),
        });
      }
    }
    out.sort((a, b) => a.dsr60 - b.dsr60);
    return out;
  }, [vendorRecs, data.bundleDaysForecast, bundleById, coresById]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white">Watchlist</h2>
        <p className="text-xs text-gray-500 mt-1">
          Items that deserve periodic review but don't fit the Purchasing flow. Dormant items don't trigger safety-stock buys by policy — the engine tracks here what it would have bought.
        </p>
      </div>

      <Section title="Dormant items to review (DORMANT_REVIVED)" count={dormantItems.length}>
        {dormantItems.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">No items to review.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/60 text-gray-400 uppercase">
                <tr>
                  <th className="py-2 px-3 text-left">Bundle</th>
                  <th className="py-2 px-3 text-left">Title</th>
                  <th className="py-2 px-3 text-left">Vendor</th>
                  <th className="py-2 px-3 text-right">Last sale</th>
                  <th className="py-2 px-3 text-right">Days dormant</th>
                  <th className="py-2 px-3 text-right">Historical DSR</th>
                  <th className="py-2 px-3 text-right">Available inv</th>
                  <th className="py-2 px-3 text-right">Would-have-bought</th>
                  <th className="py-2 px-3 text-right">$ tracked</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {dormantItems.map(item => (
                  <tr
                    key={item.vendor + ':' + item.bundleId}
                    className="border-t border-gray-800/40 hover:bg-gray-800/30 cursor-pointer"
                    onClick={() => whyBuy.open({ bundleId: item.bundleId, vendorName: item.vendor })}
                  >
                    <td className="py-1.5 px-3 text-blue-400 font-mono">{item.bundleId}</td>
                    <td className="py-1.5 px-3 text-gray-300 truncate max-w-[220px]">{item.title}</td>
                    <td className="py-1.5 px-3 text-gray-400 truncate max-w-[160px]">{item.vendor}</td>
                    <td className="py-1.5 px-3 text-right text-gray-400">{item.lastSaleDate ? fD(item.lastSaleDate) : '—'}</td>
                    <td className="py-1.5 px-3 text-right text-amber-300 font-semibold">{item.daysDormant != null ? item.daysDormant + 'd' : '—'}</td>
                    <td className="py-1.5 px-3 text-right">{D1(item.historicalDsr)}</td>
                    <td className="py-1.5 px-3 text-right">{fmt0(item.totalAvailable)}</td>
                    <td className="py-1.5 px-3 text-right text-orange-300">{fmt0(item.wouldHaveBought)}</td>
                    <td className="py-1.5 px-3 text-right text-amber-200">{$(item.wouldHaveCost)}</td>
                    <td className="py-1.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                      <DiscontinuePlaceholder bundleId={item.bundleId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Intermittent items (DSR 60d < 0.3)" count={intermittentItems.length}>
        {intermittentItems.length === 0 ? (
          <p className="text-gray-500 text-sm py-6 text-center">No intermittent items to review.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/60 text-gray-400 uppercase">
                <tr>
                  <th className="py-2 px-3 text-left">Bundle</th>
                  <th className="py-2 px-3 text-left">Title</th>
                  <th className="py-2 px-3 text-left">Vendor</th>
                  <th className="py-2 px-3 text-right">Last sale</th>
                  <th className="py-2 px-3 text-right">DSR 60d</th>
                  <th className="py-2 px-3 text-right">Recent sales (60d)</th>
                  <th className="py-2 px-3 text-right">Historical DSR</th>
                  <th className="py-2 px-3 text-right">Available inv</th>
                </tr>
              </thead>
              <tbody>
                {intermittentItems.map(item => (
                  <tr
                    key={item.vendor + ':' + item.bundleId}
                    className="border-t border-gray-800/40 hover:bg-gray-800/30 cursor-pointer"
                    onClick={() => whyBuy.open({ bundleId: item.bundleId, vendorName: item.vendor })}
                  >
                    <td className="py-1.5 px-3 text-blue-400 font-mono">{item.bundleId}</td>
                    <td className="py-1.5 px-3 text-gray-300 truncate max-w-[220px]">{item.title}</td>
                    <td className="py-1.5 px-3 text-gray-400 truncate max-w-[160px]">{item.vendor}</td>
                    <td className="py-1.5 px-3 text-right text-gray-400">{item.lastSaleDate ? fD(item.lastSaleDate) : '—'}</td>
                    <td className="py-1.5 px-3 text-right text-sky-300">{item.dsr60.toFixed(2)}</td>
                    <td className="py-1.5 px-3 text-right">{fmt0(item.recentSales60d)}</td>
                    <td className="py-1.5 px-3 text-right">{D1(item.historicalDsr)}</td>
                    <td className="py-1.5 px-3 text-right">{fmt0(item.totalAvailable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Persistent stockouts" count={0} defaultOpen={false}>
        <p className="text-gray-500 text-sm py-6 text-center">
          TODO: identify bundles with persistent stockouts. Slot reserved for a future sprint.
        </p>
      </Section>
    </div>
  );
}
