// src/workers/recommender.worker.js
// ============================================================
// Web Worker: runs batchVendorRecommendationsV4 off the main thread.
// Vite picks this up via `new Worker(new URL(..., import.meta.url),
// { type: 'module' })`.
// Posts intermediate { progress } messages and a final { result }.
// ============================================================

import { batchVendorRecommendationsV4 } from '../lib/recommenderV4.js';
import { buildAllIndexes } from '../lib/dataIndexes.js';

self.onmessage = (e) => {
  const data = e.data || {};
  if (data.kind !== 'run') return;
  const { id, payload } = data;
  try {
    // Rebuild indexes inside the worker — passing live Maps across
    // postMessage would lose Map identity. Cheap relative to the
    // recommender itself.
    const indexes = buildAllIndexes({
      priceCompFull: payload.priceCompFull,
      priceComp: payload.priceComp,
      receivingFull: payload.receivingFull,
      bundleDays: payload.bundleDays,
    });

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const result = batchVendorRecommendationsV4({
      vendors: payload.vendors,
      cores: payload.cores,
      bundles: payload.bundles,
      bundleSales: payload.bundleSales,
      bundleDays: payload.bundleDays,
      coreDays: payload.coreDays,
      abcA: payload.abcA,
      receivingFull: payload.receivingFull,
      replenMap: payload.replenMap,
      missingMap: payload.missingMap,
      priceCompFull: payload.priceCompFull,
      priceIndex: indexes.price,
      segmentMap: payload.segmentMap,
      settings: payload.settings,
      onProgress: (pct, vendorName) => {
        try {
          self.postMessage({ id, kind: 'progress', pct, vendorName });
        } catch {}
      },
    });
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    self.postMessage({ id, kind: 'done', ok: true, result, ms: t1 - t0 });
  } catch (err) {
    self.postMessage({
      id, kind: 'done', ok: false,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
    });
  }
};
