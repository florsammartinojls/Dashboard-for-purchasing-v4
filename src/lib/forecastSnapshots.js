// src/lib/forecastSnapshots.js
// Sprint 4 Fix 4: weekly forecast snapshots.
//
// Once a week (when the app boots), collect a 180d forecast row per
// active bundle and POST them to an Apps Script endpoint that writes
// them into a Google Sheet. Feeds a future "engine accuracy" log
// (predicted vs actual). Skips silently if the endpoint placeholder
// has not been replaced — never throws into the parent app.
//
// The Apps Script side (sheet creation, doPost handler, web-app
// deployment) is the operator's responsibility. After deployment,
// replace APPS_SCRIPT_ENDPOINT below with the deployed web-app URL.

const SNAPSHOT_LS_KEY = 'fba_last_forecast_snapshot_date';
const SNAPSHOT_INTERVAL_DAYS = 7;
const APPS_SCRIPT_ENDPOINT = '[REPLACE_WITH_GAS_WEB_APP_URL_AFTER_DEPLOY]';

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms / 86400000;
}

function isSnapshotDue() {
  try {
    const last = localStorage.getItem(SNAPSHOT_LS_KEY);
    return daysSince(last) >= SNAPSHOT_INTERVAL_DAYS;
  } catch {
    return false;
  }
}

function buildRowFromBundleDetail(detail, vendorName, engineVersion) {
  const f = detail.forecast || {};
  const inputs = f.inputs || {};
  const proj = f.projection || {};
  const monthly = Array.isArray(proj.monthly) ? proj.monthly : [];
  const m = (i) => Math.round((monthly[i]?.units) || 0);
  const total180 = monthly.reduce((s, mo) => s + (mo.units || 0), 0);

  return {
    timestamp: new Date().toISOString(),
    engineVersion: engineVersion || 'v4',
    bundleId: detail.bundleId,
    vendorPrimary: vendorName || '',
    segment: detail.segment || '',
    segmentReconciled: detail.sevenDayReconciled ? detail.sevenDayReconciled.originalSegment : '',
    level_base_diario: Number((f.level || 0).toFixed(4)),
    m1: m(0), m2: m(1), m3: m(2), m4: m(3), m5: m(4), m6: m(5),
    total_180d: Math.round(total180),
    mean60d: Number((inputs.mean60d || 0).toFixed(4)),
    mean30d: Number((inputs.mean30d || 0).toFixed(4)),
    dsr7D: Number((detail.completeDSR || 0).toFixed(4)),
    completeDSR: Number((detail.completeDSR || 0).toFixed(4)),
    stockoutDays60d: 0,
    trendRaw: Number((inputs.trendRaw || 0).toFixed(6)),
    safetyStock: Math.round(f.safetyStock || 0),
    coverageDemand: Math.round(f.coverageDemand || detail.coverageDemand || 0),
    targetDoc: detail.targetDOC || 0,
    forecast_reasoning: JSON.stringify({
      formula: f.formula || '',
      reasoning: f.reasoning || [],
    }),
  };
}

export function buildSnapshotRows(vendorRecsByName) {
  const seen = new Set();
  const rows = [];
  let duplicates = 0;
  const recs = vendorRecsByName || {};
  for (const vendorName of Object.keys(recs)) {
    const rec = recs[vendorName];
    if (!rec || !Array.isArray(rec.bundleDetails)) continue;
    for (const detail of rec.bundleDetails) {
      if (!detail?.bundleId) continue;
      if (seen.has(detail.bundleId)) { duplicates++; continue; }
      seen.add(detail.bundleId);
      rows.push(buildRowFromBundleDetail(detail, vendorName, rec.engineVersion));
    }
  }
  return { rows, dedupedCount: duplicates };
}

async function postSnapshotBatch(rows) {
  if (!APPS_SCRIPT_ENDPOINT || APPS_SCRIPT_ENDPOINT.includes('REPLACE')) {
    throw new Error('APPS_SCRIPT_ENDPOINT not configured in forecastSnapshots.js');
  }
  const res = await fetch(APPS_SCRIPT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'appendForecastSnapshots', rows }),
  });
  if (!res.ok) throw new Error(`Snapshot endpoint HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Snapshot endpoint returned ok=false');
  return json;
}

function isEndpointConfigured() {
  return !!APPS_SCRIPT_ENDPOINT && !APPS_SCRIPT_ENDPOINT.includes('REPLACE');
}

export async function generateWeeklySnapshotIfDue(vendorRecsByName, { onToast } = {}) {
  // Endpoint not yet wired by the operator → skip silently. We don't
  // bump the localStorage timestamp on this branch so the moment the
  // operator deploys + replaces the URL, the snapshot fires on the
  // next app load instead of waiting another week.
  if (!isEndpointConfigured()) return { skipped: true, reason: 'endpoint_not_configured' };
  if (!isSnapshotDue()) return { skipped: true, reason: 'not_due' };
  const { rows, dedupedCount } = buildSnapshotRows(vendorRecsByName);
  if (rows.length === 0) return { skipped: true, reason: 'no_data' };

  try {
    await postSnapshotBatch(rows);
    try { localStorage.setItem(SNAPSHOT_LS_KEY, new Date().toISOString()); } catch {}
    if (onToast) onToast(`Snapshot saved: ${rows.length} bundles${dedupedCount ? ` (${dedupedCount} duplicates omitted)` : ''}`);
    return { ok: true, count: rows.length, dedupedCount };
  } catch (err) {
    if (onToast) onToast(`Snapshot failed: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
}

export async function forceSnapshotNow(vendorRecsByName, { onToast } = {}) {
  try { localStorage.removeItem(SNAPSHOT_LS_KEY); } catch {}
  return generateWeeklySnapshotIfDue(vendorRecsByName, { onToast });
}
