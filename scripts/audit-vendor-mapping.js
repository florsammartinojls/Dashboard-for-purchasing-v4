// scripts/audit-vendor-mapping.js
// ============================================================
// Audit: dimension the vendor-mapping bug — for every vendor in the
// system, compare the cores PurchTab's legacy UI criteria would show
// vs the cores the recommender actually processes (vendorRec.coreDetails).
//
// Usage:
//   node scripts/audit-vendor-mapping.js
//
// Output:
//   Console summary table + JSON detail at /tmp/vendor-mapping-audit.json
//   (on Windows, falls back to <repo>/tmp/vendor-mapping-audit.json).
//
// Notes:
//   - Read-only. No production code is touched.
//   - Skips IndexedDB caching that the browser uses; fetches fresh
//     from Apps Script. Keep the API URL in sync with src/lib/api.js.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { batchVendorRecommendationsV4 } from '../src/lib/recommenderV4.js';
import { batchClassifySegments } from '../src/lib/segmentClassifier.js';

// Inlined to avoid pulling in src/lib/segments.js, which imports a
// JSON seed and touches localStorage at module load — both of which
// blow up under plain Node. With no overrides, the segment for each
// bundle is just autoRec.segment, so we don't need anything fancy.
function buildSegmentMap(autoMap) {
  const out = {};
  for (const [bid, rec] of Object.entries(autoMap || {})) {
    out[bid] = rec.segment;
  }
  return out;
}

const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_PATH = process.platform === 'win32'
  ? path.join(REPO_ROOT, 'tmp', 'vendor-mapping-audit.json')
  : '/tmp/vendor-mapping-audit.json';

// ─── unpack {fields, rows} → [{...}, ...] (mirrors src/lib/api.js) ───
function unpackRows(packed) {
  if (Array.isArray(packed)) return packed;
  if (packed && Array.isArray(packed.fields) && Array.isArray(packed.rows)) {
    const { fields, rows } = packed;
    const n = fields.length;
    const out = new Array(rows.length);
    for (let r = 0; r < rows.length; r++) {
      const arr = rows[r];
      const obj = {};
      for (let i = 0; i < n; i++) obj[fields[i]] = arr[i];
      out[r] = obj;
    }
    return out;
  }
  return [];
}

async function appsScriptCall(action, extraParams = '') {
  const u = `${API}?action=${action}${extraParams}&_t=${Date.now()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(u, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Apps Script error ${res.status} on ${action}`);
    const data = await res.json();
    if (data && data.error) throw new Error(`Apps Script error: ${data.error}`);
    return data;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`Timeout calling ${action}`);
    throw e;
  }
}

async function fetchChunk(file, idx) {
  const data = await appsScriptCall('chunk', `&file=${file}&i=${idx}`);
  if (typeof data.chunk !== 'string') throw new Error(`Bad chunk ${idx} for ${file}`);
  return data.chunk;
}

async function fetchFileInChunks(file, totalChunks) {
  const BATCH = 4;
  const chunks = new Array(totalChunks);
  for (let i = 0; i < totalChunks; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, totalChunks); j++) {
      batch.push(fetchChunk(file, j).then(c => { chunks[j] = c; }));
    }
    await Promise.all(batch);
  }
  return JSON.parse(chunks.join(''));
}

// ─── Defaults that match App.jsx DEFAULT_SETTINGS ───
const DEFAULT_SETTINGS = {
  domesticDoc: 90,
  intlDoc: 180,
  replenFloorDoc: 80,
  spikeThreshold: 1.25,
  moqInflationThreshold: 1.5,
  moqInflationHardCap: 3.0,
  moqExtraDocThreshold: 30,
  fA: 'yes', fI: 'blank', fV: 'yes',
  bA: 'yes', bI: 'blank',
  segmentationEnabled: true,
  serviceLevelA: 97,
  serviceLevelOther: 95,
  inventoryAnomalyMultiplier: 3,
  anomalyLookbackDays: 7,
};

// ─── activeBundleCores: same logic as App.jsx ───
function buildActiveBundleCores(bundles, cores, stg) {
  const set = new Set();
  const activeBundleJLS = new Set();
  const bI = stg.bI || 'blank';
  (bundles || []).filter(b => {
    if (b.active !== 'Yes') return false;
    if (bI === 'blank' && !!b.ignoreUntil) return false;
    if (bI === 'set' && !b.ignoreUntil) return false;
    return true;
  }).forEach(b => {
    if (b.core1) set.add(b.core1);
    if (b.core2) set.add(b.core2);
    if (b.core3) set.add(b.core3);
    activeBundleJLS.add((b.j || '').trim().toLowerCase());
  });
  (cores || []).forEach(c => {
    if (set.has(c.id)) return;
    const raw = (c.jlsList || '').split(/[,;\n\r]+/).map(j => j.trim().toLowerCase()).filter(Boolean);
    if (raw.some(j => activeBundleJLS.has(j))) set.add(c.id);
  });
  return set;
}

// ─── PurchTab UI criteria for cores under a given vendor ───
function purchTabCoresFor(vName, cores, stg, activeBundleCores) {
  return (cores || [])
    .filter(c => c && c.id && !/^JLS/i.test(c.id))
    .filter(c => c.ven === vName)
    .filter(c => {
      if (stg.fA === 'yes' && c.active !== 'Yes') return false;
      if (stg.fA === 'no' && c.active === 'Yes') return false;
      if (stg.fV === 'yes' && c.visible !== 'Yes') return false;
      if (stg.fV === 'no' && c.visible === 'Yes') return false;
      if (stg.fI === 'blank' && !!c.ignoreUntil) return false;
      if (activeBundleCores && !activeBundleCores.has(c.id)) return false;
      return true;
    })
    .map(c => c.id);
}

// ─── Reasons a core might be excluded (one bit per filter) ───
function coreExclusionReasons(c, stg, activeBundleCores) {
  const r = [];
  if (stg.fA === 'yes' && c.active !== 'Yes') r.push('inactive');
  if (stg.fV === 'yes' && c.visible !== 'Yes') r.push('not_visible');
  if (stg.fI === 'blank' && !!c.ignoreUntil) r.push('ignoreUntil_set');
  if (activeBundleCores && !activeBundleCores.has(c.id)) r.push('no_active_bundle');
  return r;
}

async function main() {
  const t0 = Date.now();
  console.log('Fetching meta…');
  const meta = await appsScriptCall('meta');
  if (!meta.live?.chunks) throw new Error('Missing live metadata');
  if (!meta.history?.chunks) throw new Error('Missing history metadata');
  if (!meta.forecast?.chunks) throw new Error('Missing forecast metadata');

  console.log('Fetching live (', meta.live.chunks, 'chunks ),  history (', meta.history.chunks, '), forecast (', meta.forecast.chunks, ')…');
  const [live, historyRaw, forecastRaw] = await Promise.all([
    fetchFileInChunks('live', meta.live.chunks),
    fetchFileInChunks('history', meta.history.chunks),
    fetchFileInChunks('forecast', meta.forecast.chunks),
  ]);
  const tFetch = Date.now();
  console.log(`Fetch done in ${((tFetch - t0) / 1000).toFixed(1)}s`);

  const data = {
    cores: live.cores || [],
    bundles: live.bundles || [],
    vendors: live.vendors || [],
    abcA: live.abcA || [],
    receiving: live.receiving || [],
    replenRec: live.replenRec || [],
    bundleSales: unpackRows(historyRaw.bundleSales),
    coreInv: unpackRows(historyRaw.coreInv),
    bundleInv: unpackRows(historyRaw.bundleInv),
    receivingFull: historyRaw.receivingFull || [],
    priceCompFull: historyRaw.priceCompFull || [],
    coreDaysForecast: unpackRows(forecastRaw.coreDays),
    bundleDaysForecast: unpackRows(forecastRaw.bundleDays),
  };

  const stg = DEFAULT_SETTINGS;
  const activeBundleCores = buildActiveBundleCores(data.bundles, data.cores, stg);

  // replenMap + missingMap mirroring App.jsx
  const replenMap = {};
  for (const r of data.replenRec) replenMap[r.j] = r;
  const missingMap = {};
  for (const r of data.receiving) {
    if (r.piecesMissing > 0) {
      const k = (r.core || '').trim();
      missingMap[k] = (missingMap[k] || 0) + r.piecesMissing;
    }
  }

  // Segment classification (no overrides — audit runs with auto map only)
  const activeBundles = data.bundles.filter(b => b && b.j && b.active === 'Yes' && !b.ignoreUntil);
  const autoMap = batchClassifySegments({
    bundles: activeBundles,
    bundleDays: data.bundleDaysForecast,
    bundleSales: data.bundleSales,
  });
  const segmentMap = buildSegmentMap(autoMap);

  console.log('Running batchVendorRecommendationsV4 over', data.vendors.length, 'vendors…');
  const tBatch0 = Date.now();
  const recs = batchVendorRecommendationsV4({
    vendors: data.vendors,
    cores: data.cores,
    bundles: data.bundles,
    bundleSales: data.bundleSales,
    bundleDays: data.bundleDaysForecast,
    coreDays: data.coreDaysForecast,
    abcA: data.abcA,
    receivingFull: data.receivingFull,
    replenMap,
    missingMap,
    priceCompFull: data.priceCompFull,
    segmentMap,
    settings: stg,
  });
  const tBatch1 = Date.now();
  console.log(`Batch done in ${((tBatch1 - tBatch0) / 1000).toFixed(1)}s`);

  // ─── Comparison ───
  const coreById = {};
  for (const c of data.cores) if (c?.id) coreById[c.id] = c;

  const report = {
    generatedAt: new Date().toISOString(),
    settings: stg,
    totals: { vendors: 0, withMismatch: 0, totalUiOnly: 0, totalRecOnly: 0 },
    vendors: [],
  };

  for (const v of data.vendors) {
    if (!v?.name) continue;
    report.totals.vendors++;
    const rec = recs[v.name];
    const recCoreIds = rec?.coreDetails ? rec.coreDetails.map(cd => cd.coreId) : [];
    const uiCoreIds = purchTabCoresFor(v.name, data.cores, stg, activeBundleCores);
    const uiSet = new Set(uiCoreIds);
    const recSet = new Set(recCoreIds);
    const uiOnly = uiCoreIds.filter(id => !recSet.has(id));
    const recOnly = recCoreIds.filter(id => !uiSet.has(id));

    const recOnlyDetail = recOnly.map(id => {
      const c = coreById[id];
      const cd = rec?.coreDetails?.find(x => x.coreId === id) || null;
      return {
        coreId: id,
        title: c?.ti || null,
        active: c?.active || null,
        visible: c?.visible || null,
        ignoreUntil: c?.ignoreUntil || null,
        excludedBy: c ? coreExclusionReasons(c, stg, activeBundleCores) : ['core_not_found_in_data'],
        recHasNeed: (cd?.needPieces || 0) > 0,
        recFinalQty: cd?.finalQty || 0,
        rejectedByMoqCap: !!cd?.rejectedByMoqCap,
      };
    });

    const hasMismatch = uiOnly.length > 0 || recOnly.length > 0;
    if (hasMismatch) {
      report.totals.withMismatch++;
      report.totals.totalUiOnly += uiOnly.length;
      report.totals.totalRecOnly += recOnly.length;
    }
    report.vendors.push({
      vendor: v.name,
      country: v.country || '',
      uiCount: uiCoreIds.length,
      recCount: recCoreIds.length,
      uiOnly,
      recOnly,
      recOnlyDetail,
      mismatch: hasMismatch,
    });
  }

  // Sort vendors by recOnly count desc — biggest blind spots first
  report.vendors.sort((a, b) => b.recOnly.length - a.recOnly.length);

  // ─── Console output ───
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(' VENDOR MAPPING AUDIT — SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(` Total vendors:            ${report.totals.vendors}`);
  console.log(` Vendors with mismatch:    ${report.totals.withMismatch}`);
  console.log(` Cores in UI only (rec missing them, unexpected): ${report.totals.totalUiOnly}`);
  console.log(` Cores in REC only (UI hides them, the bug):       ${report.totals.totalRecOnly}`);
  console.log('');

  const top5 = report.vendors.filter(v => v.mismatch).slice(0, 5);
  if (top5.length > 0) {
    console.log(' Top 5 vendors by REC-only cores (UI blind spots):');
    console.log('');
    for (const v of top5) {
      console.log(`  ${v.vendor}  (${v.country})`);
      console.log(`    ui=${v.uiCount}  rec=${v.recCount}  rec-only=${v.recOnly.length}`);
      const sample = v.recOnlyDetail.slice(0, 5);
      for (const s of sample) {
        const tag = s.rejectedByMoqCap ? '⛔MOQ-cap'
                  : s.recHasNeed ? `need=${s.recFinalQty}`
                  : 'no-need';
        console.log(`      · ${s.coreId.padEnd(10)} excludedBy=[${s.excludedBy.join(',')}]  ${tag}`);
      }
      if (v.recOnly.length > sample.length) {
        console.log(`      … and ${v.recOnly.length - sample.length} more`);
      }
      console.log('');
    }
  }

  // ─── Write JSON ───
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Detail JSON written to: ${OUT_PATH}`);

  const tEnd = Date.now();
  console.log(`Total elapsed: ${((tEnd - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error('AUDIT FAILED:', err && err.message ? err.message : err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
