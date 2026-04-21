// src/lib/snapshot.js
// ============================================================
// Daily Snapshot + Delta Decomposition — v3
// ============================================================
// Saves vendor recommendation once per day to localStorage.
// When today's total cost differs from yesterday's by >15%, provides
// a per-bundle breakdown of what drove the change: level, trend,
// inventory, or safety stock.
//
// Keeps last 14 snapshots per vendor. All automatic, no user action.
// ============================================================

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

function getIndex(vendorName) {
  try {
    const raw = localStorage.getItem(indexKey(vendorName));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function setIndex(vendorName, dates) {
  try { localStorage.setItem(indexKey(vendorName), JSON.stringify(dates)); } catch {}
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
export function saveSnapshotIfNeeded(vendorName, vendorRec) {
  if (!vendorName || !vendorRec) return;
  const d = todayStr();
  const k = snapKey(vendorName, d);
  try {
    if (localStorage.getItem(k)) return; // already saved today
    const snap = compactSnapshot(vendorRec);
    if (!snap) return;
    localStorage.setItem(k, JSON.stringify({ date: d, vendor: vendorName, ...snap }));
    const idx = getIndex(vendorName);
    if (!idx.includes(d)) idx.push(d);
    idx.sort();
    while (idx.length > MAX_DAYS_RETAINED) {
      const old = idx.shift();
      try { localStorage.removeItem(snapKey(vendorName, old)); } catch {}
    }
    setIndex(vendorName, idx);
  } catch (e) {
    console.warn('Snapshot save failed:', e);
  }
}

// ─── Load most recent snapshot BEFORE today ──────────────────────
export function loadPreviousSnapshot(vendorName) {
  const idx = getIndex(vendorName);
  const today = todayStr();
  const prev = [...idx].reverse().find(d => d < today);
  if (!prev) return null;
  try {
    const raw = localStorage.getItem(snapKey(vendorName, prev));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Compute delta & decompose by source ─────────────────────────
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
export function clearVendorSnapshots(vendorName) {
  const idx = getIndex(vendorName);
  idx.forEach(d => {
    try { localStorage.removeItem(snapKey(vendorName, d)); } catch {}
  });
  try { localStorage.removeItem(indexKey(vendorName)); } catch {}
}
