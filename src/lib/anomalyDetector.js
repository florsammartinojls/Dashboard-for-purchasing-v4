// src/lib/anomalyDetector.js
// ============================================================
// Inventory Reconciliation — v3
// ============================================================
// For each core, compares today's All-In inventory with the expected value
// (yesterday's All-In + shipments received today − expected sales).
// If the gap exceeds max(3 × DSR, 10), flags as anomaly and provides
// an "effective raw" value to use instead.
//
// Only "unexplained drops" trigger an override. "Unexplained gains"
// are flagged but not overridden (likely unrecorded incoming shipment —
// leaving inventory as-is is the conservative choice).
// ============================================================

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

// All-In = raw + inb + pp + jfn + pq + ji + fba (matches cAI in utils.js)
function allInFromDay(d) {
  return num(d.raw) + num(d.inb) + num(d.pp) + num(d.jfn) + num(d.pq) + num(d.ji) + num(d.fba);
}

function shipmentsOnDate(coreId, dateStr, receivingRows) {
  if (!coreId || !dateStr) return 0;
  const cid = coreId.toLowerCase().trim();
  const d10 = dateStr.substring(0, 10);
  let total = 0;
  for (const r of (receivingRows || [])) {
    if (!r) continue;
    if ((r.core || '').toLowerCase().trim() !== cid) continue;
    if ((r.date || '').substring(0, 10) !== d10) continue;
    total += num(r.pcs);
  }
  return total;
}

// ─── Detect anomalies for a single core ──────────────────────────
export function detectCoreAnomaly({
  core,
  coreDays,          // array filtered & sorted desc by date
  receivingRows,
  lookbackDays = 7,
  multiplier = 3,
}) {
  if (!core || !core.id) return null;
  const rows = (coreDays || [])
    .filter(d => d && d.core === core.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, lookbackDays + 1);

  if (rows.length < 2) return null;

  const dsr = num(core.dsr);
  const threshold = Math.max(multiplier * dsr, 10);
  const anomalies = [];

  for (let i = 0; i < rows.length - 1; i++) {
    const today = rows[i];
    const yesterday = rows[i + 1];
    const actualToday = allInFromDay(today);
    const actualYesterday = allInFromDay(yesterday);
    const expectedSales = num(today.dsr) > 0 ? num(today.dsr) : dsr;
    const shipments = shipmentsOnDate(core.id, today.date, receivingRows);
    const expectedToday = actualYesterday - expectedSales + shipments;
    const diff = actualToday - expectedToday;

    if (Math.abs(diff) > threshold) {
      anomalies.push({
        date: today.date,
        actualToday,
        actualYesterday,
        expectedToday: Math.round(expectedToday),
        diff: Math.round(diff),
        expectedSales: Math.round(expectedSales),
        shipments,
        type: diff > 0 ? 'unexplained_gain' : 'unexplained_drop',
      });
    }
  }

  if (anomalies.length === 0) return null;

  const latest = anomalies[0];

  // Gains: flag only, don't override
  if (latest.type === 'unexplained_gain') {
    return {
      detected: true,
      anomalies,
      override: null,
      message: `Unexplained gain of ${Math.abs(latest.diff)} pcs on ${latest.date} — not overriding (likely unrecorded shipment). Verify receiving records.`,
    };
  }

  // Drops: compute corrected raw
  const latestIdx = rows.findIndex(d => d.date === latest.date);
  const preDrop = rows[latestIdx + 1];
  if (!preDrop) {
    return { detected: true, anomalies, override: null, message: 'Drop detected but no prior day available.' };
  }

  const preDropAllIn = allInFromDay(preDrop);
  const daysSince = Math.max(0, Math.round(
    (new Date() - new Date(preDrop.date + 'T00:00:00')) / 86400000
  ));
  const expectedSalesSince = dsr * daysSince;
  const shipmentsSince = rows.slice(0, latestIdx + 1)
    .reduce((s, d) => s + shipmentsOnDate(core.id, d.date, receivingRows), 0);
  const rawEffectiveTotal = Math.max(0, preDropAllIn - expectedSalesSince + shipmentsSince);
  const currentAllIn = allInFromDay(rows[0]);
  const delta = rawEffectiveTotal - currentAllIn;
  const rawEffective = Math.max(0, num(core.raw) + delta);

  return {
    detected: true,
    anomalies,
    override: { rawEffective: Math.round(rawEffective), delta: Math.round(delta) },
    message: `Inventory drop of ${Math.abs(latest.diff)} pcs on ${latest.date}. Using raw=${Math.round(rawEffective)} (reconstructed from pre-drop) instead of ${num(core.raw)}.`,
  };
}

// ─── Batch over all cores of a vendor ────────────────────────────
export function detectVendorAnomalies({
  vendor, cores, coreDays, receivingRows, settings,
}) {
  const lookback = num(settings?.anomalyLookbackDays, 7);
  const mult = num(settings?.inventoryAnomalyMultiplier, 3);
  const vendorCores = (cores || []).filter(c => c?.ven === vendor?.name);
  const result = {};
  for (const c of vendorCores) {
    const det = detectCoreAnomaly({
      core: c, coreDays, receivingRows,
      lookbackDays: lookback, multiplier: mult,
    });
    if (det) result[c.id] = det;
  }
  return result;
}
