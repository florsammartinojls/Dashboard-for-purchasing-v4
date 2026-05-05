// scripts/imperial-dade-check.mjs
// One-off sanity check: verify Imperial Dade Core-11258 still
// reports the locked numbers (28785 needPieces / 32000 finalQty /
// $883 cost) after Sprint 3 changes. Reuses the audit script's
// data-fetching path so it hits the same Apps Script snapshot.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { batchVendorRecommendationsV4 } from '../src/lib/recommenderV4.js';
import { batchClassifySegments } from '../src/lib/segmentClassifier.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

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
  } catch (e) { clearTimeout(timer); throw e; }
}
async function fetchChunk(file, idx) { const d = await appsScriptCall('chunk', `&file=${file}&i=${idx}`); return d.chunk; }
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

const stg = {
  domesticDoc: 90, intlDoc: 180, replenFloorDoc: 80,
  spikeThreshold: 1.25, moqInflationThreshold: 1.5, moqInflationHardCap: 3.0,
  moqExtraDocThreshold: 30, fA: 'yes', fI: 'blank', fV: 'yes',
  bA: 'yes', bI: 'blank', segmentationEnabled: true,
  serviceLevelA: 97, serviceLevelOther: 95,
  inventoryAnomalyMultiplier: 3, anomalyLookbackDays: 7,
  decliningProjectionFloor: 0.5, sevenDayReconciliationRatio: 1.0,
};

console.log('Fetching live + history…');
const meta = await appsScriptCall('meta');
const live = await fetchFileInChunks('live', meta.live.chunks);
const history = await fetchFileInChunks('history', meta.history.chunks);
const forecast = await fetchFileInChunks('forecast', meta.forecast.chunks);

const data = {
  ...live,
  receivingFull: unpackRows(history.receivingFull) || history.receivingFull || [],
  priceCompFull: unpackRows(history.priceCompFull) || history.priceCompFull || [],
  bundleSales: unpackRows(history.bundleSales) || [],
  coreInv: unpackRows(history.coreInv) || [],
  bundleInv: unpackRows(history.bundleInv) || [],
  coreDaysForecast: unpackRows(forecast.coreDays) || [],
  bundleDaysForecast: unpackRows(forecast.bundleDays) || [],
};

const replenMap = {};
(data.replenRec || []).forEach(r => { replenMap[r.j] = r; });
const missingMap = {};
(data.receiving || []).forEach(r => { if (r.piecesMissing > 0) { const k = (r.core || '').trim(); missingMap[k] = (missingMap[k] || 0) + r.piecesMissing; } });

const activeBundles = (data.bundles || []).filter(b => b && b.j && b.active === 'Yes' && !b.ignoreUntil);
const autoSegs = batchClassifySegments({ bundles: activeBundles, bundleDays: data.bundleDaysForecast, bundleSales: data.bundleSales });
const segMap = {};
for (const [k, v] of Object.entries(autoSegs)) segMap[k] = v.segment;

console.log('Running recommender…');
const recs = batchVendorRecommendationsV4({
  vendors: data.vendors, cores: data.cores, bundles: data.bundles,
  bundleSales: data.bundleSales, bundleDays: data.bundleDaysForecast,
  coreDays: data.coreDaysForecast, abcA: data.abcA,
  receivingFull: data.receivingFull, replenMap, missingMap,
  priceCompFull: data.priceCompFull, segmentMap: segMap, settings: stg,
});

const id = process.argv[2] || 'Core-11258';
const vendorName = process.argv[3] || 'Imperial Dade';
const r = recs[vendorName];
if (!r) { console.error(`No rec for vendor ${vendorName}. Available:`, Object.keys(recs).filter(x => /imperial/i.test(x))); process.exit(1); }
const item = r.coreItems.find(x => x.id === id);
const detail = r.coreDetails.find(x => x.coreId === id);

console.log('\n══════════════════════════════════════════════════');
console.log(` ${vendorName} — ${id}`);
console.log('══════════════════════════════════════════════════');
console.log('coreItem:', JSON.stringify(item, null, 2));
console.log('\ncoreDetail:', JSON.stringify(detail, null, 2));

// Sprint 5 Fix 2 sanity: DV Plastics Core-11825 should appear with
// finalQty>0 even if needPieces=0 (MOQ-inflated).
console.log('\n--- Sprint 5 Fix 2: DV Plastics Core-11825 ---');
const dv = recs['DV Plastics'];
if (dv) {
  const cd = (dv.coreDetails || []).find(x => x.coreId === 'Core-11825');
  if (cd) {
    console.log(`  needPieces=${cd.needPieces} finalQty=${cd.finalQty} cost=$${(cd.cost || 0).toFixed(2)}`);
  } else {
    console.log('  Core-11825 not in DV Plastics coreDetails');
  }
} else {
  console.log('  DV Plastics not in vendorRecs (key mismatch?)');
}

// Sprint 4 Fix 3 sanity: projection.monthly length per segment.
console.log('\n--- projection.monthly length check ---');
const sampleVendors = [
  ['Imperial Dade', 'USA targetDoc=90'],
  ['Wuxi Topteam', 'China targetDoc=180'],
];
for (const [vName, label] of sampleVendors) {
  const r = recs[vName];
  if (!r || !r.bundleDetails || !r.bundleDetails.length) {
    console.log(`  ${vName}: no rec`);
    continue;
  }
  const lens = r.bundleDetails.map(bd => bd.forecast?.projection?.monthly?.length || 0);
  const cdSamples = r.bundleDetails.slice(0, 3).map(bd => ({ b: bd.bundleId, cd: Math.round(bd.coverageDemand || 0), td: bd.targetDOC, mlen: bd.forecast?.projection?.monthly?.length || 0 }));
  const minL = Math.min(...lens), maxL = Math.max(...lens);
  console.log(`  ${vName} (${label}): bundles=${lens.length}, monthly len min=${minL} max=${maxL}; sample:`, JSON.stringify(cdSamples));
}
