// src/lib/snapshot.js
// ============================================================
// Daily Snapshot + Delta Decomposition — v4
// ============================================================
// Saves vendor recommendation once per day to IndexedDB (was
// localStorage in v3 — moved because 14 days × N vendors × ~5KB
// could blow the 5MB localStorage cap silently). Same compact
// snapshot, same delta decomposition, async API.
//
// Storage layout in IndexedDB:
//   key 'fba_snap_idx_<vendor>'   -> string[] of dates (sorted)
//   key 'fba_snap_<vendor>_<date>' -> compact snapshot object
//
// All functions are async. Callers must await.
// ============================================================

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

const MAX_DAYS_RETAINED = 14;
const SIGNIFICANT_DELTA_PCT = 15;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function safeKey(vendorName) {
  return (vendorName || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function snapKey(vendorName, date) {
  return `fba_snap_${safeKey(vendorName)}_${date}`;
}

function indexKey(vendorName) {
  return `fba_snap_idx_${safeKey(vendorName)}`;
}

async function getIndex(vendorName) {
  try {
    const raw = await idbGet(indexKey(vendorName));
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') return JSON.parse(raw);
    return [];
  } catch { return []; }
}

async function setIndex(vendorName, dates) {
  try { await idbSet(indexKey(vendorName), dates); } catch {}
}

// Compact serializable snapshot from full vendor recommendation
function compactSnapshot(vendorRec) {
  if (!vendorRec) return null;
  return {
    totalCost: vendorRec.totalCost || 0,
    items: (vendorRec.items || []).map(i => ({
      id: i.id, mode: i.mode,
      needPieces: i.needPieces, finalQty: i.finalQty, cost: i.cost,
    })),
    bundleDetails: (vendorRec.bundleDetails || []).map(bd => ({
      bundleId: bd.bundleId,
      level: bd.forecast?.level ?? bd.effectiveDSR ?? 0,
      trend: bd.forecast?.trend ?? 0,
      totalAvailable: bd.totalAvailable,
      coverageDemand: bd.coverageDemand,
      safetyStock: bd.safetyStock?.amount ?? 0,
      buyNeed: bd.buyNeed,
    })),
    coreDetails: (vendorRec.coreDetails || []).map(cd => ({
      coreId: cd.coreId,
      rawEffective: cd.rawEffective ?? cd.rawOnHand,
      finalQty: cd.finalQty,
      anomalyDetected: !!cd.anomalyDetected,
    })),
  };
}

// ─── Save snapshot if not already saved today ────────────────────
export async function saveSnapshotIfNeeded(vendorName, vendorRec) {
  if (!vendorName || !vendorRec) return;
  const d = todayStr();
  const k = snapKey(vendorName, d);
  try {
    const existing = await idbGet(k);
    if (existing) return; // already saved today
    const snap = compactSnapshot(vendorRec);
    if (!snap) return;
    await idbSet(k, { date: d, vendor: vendorName, ...snap });
    const idx = await getIndex(vendorName);
    if (!idx.includes(d)) idx.push(d);
    idx.sort();
    while (idx.length > MAX_DAYS_RETAINED) {
      const old = idx.shift();
      try { await idbDel(snapKey(vendorName, old)); } catch {}
    }
    await setIndex(vendorName, idx);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('Snapshot save failed:', e);
  }
}

// ─── Load most recent snapshot BEFORE today ──────────────────────
export async function loadPreviousSnapshot(vendorName) {
  const idx = await getIndex(vendorName);
  const today = todayStr();
  const prev = [...idx].reverse().find(d => d < today);
  if (!prev) return null;
  try {
    const raw = await idbGet(snapKey(vendorName, prev));
    if (!raw) return null;
    if (typeof raw === 'string') return JSON.parse(raw);
    return raw;
  } catch { return null; }
}

// ─── Compute delta & decompose by source ─────────────────────────
// Pure: input today's recommendation + previous snapshot, returns
// the human-readable "what changed" summary. No I/O.
export function computeDelta(vendorRec, previousSnapshot) {
  if (!vendorRec || !previousSnapshot) return null;
  const todayTotal = vendorRec.totalCost || 0;
  const prevTotal = previousSnapshot.totalCost || 0;
  if (prevTotal === 0 && todayTotal === 0) return null;
  const pctChange = prevTotal > 0 ? ((todayTotal - prevTotal) / prevTotal) * 100 : 100;
  if (Math.abs(pctChange) < SIGNIFICANT_DELTA_PCT) {
    return { significant: false, pctChange, prevDate: previousSnapshot.date, todayTotal, prevTotal };
  }

  const prevByB = {};
  (previousSnapshot.bundleDetails || []).forEach(bd => { prevByB[bd.bundleId] = bd; });
  const targetDoc = vendorRec.targetDoc || 180;

  const contributions = [];
  for (const bd of (vendorRec.bundleDetails || [])) {
    const prev = prevByB[bd.bundleId];
    if (!prev) {
      if (bd.buyNeed > 0) contributions.push({
        bundleId: bd.bundleId, source: 'new_bundle', amount: bd.buyNeed,
        detail: `New bundle in recommendation, needs ${Math.round(bd.buyNeed)} units`,
      });
      continue;
    }
    const levelNow = bd.forecast?.level ?? bd.effectiveDSR ?? 0;
    const levelPrev = prev.level ?? 0;
    const trendNow = bd.forecast?.trend ?? 0;
    const trendPrev = prev.trend ?? 0;
    const invNow = bd.totalAvailable ?? 0;
    const invPrev = prev.totalAvailable ?? 0;
    const safetyNow = bd.safetyStock?.amount ?? 0;
    const safetyPrev = prev.safetyStock ?? 0;

    const dLevel = (levelNow - levelPrev) * targetDoc;
    const dTrend = (trendNow - trendPrev) * targetDoc * targetDoc / 2;
    const dInventory = invPrev - invNow;
    const dSafety = safetyNow - safetyPrev;

    if (Math.abs(dLevel) > 5) contributions.push({
      bundleId: bd.bundleId, source: 'level', amount: dLevel,
      detail: `DSR level went from ${levelPrev.toFixed(1)} to ${levelNow.toFixed(1)}`,
    });
    if (Math.abs(dTrend) > 5) contributions.push({
      bundleId: bd.bundleId, source: 'trend', amount: dTrend,
      detail: `Trend changed from ${trendPrev.toFixed(3)} to ${trendNow.toFixed(3)} per day`,
    });
    if (Math.abs(dInventory) > 5) contributions.push({
      bundleId: bd.bundleId, source: 'inventory', amount: dInventory,
      detail: `Available went from ${Math.round(invPrev)} to ${Math.round(invNow)}`,
    });
    if (Math.abs(dSafety) > 5) contributions.push({
      bundleId: bd.bundleId, source: 'safety_stock', amount: dSafety,
      detail: `Safety stock went from ${Math.round(safetyPrev)} to ${Math.round(safetyNow)}`,
    });
  }

  contributions.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    significant: true,
    pctChange,
    todayTotal,
    prevTotal,
    prevDate: previousSnapshot.date,
    contributions: contributions.slice(0, 8),
  };
}

// ─── Clear all snapshots for a vendor (debugging utility) ────────
export async function clearVendorSnapshots(vendorName) {
  const idx = await getIndex(vendorName);
  for (const d of idx) {
    try { await idbDel(snapKey(vendorName, d)); } catch {}
  }
  try { await idbDel(indexKey(vendorName)); } catch {}
}
