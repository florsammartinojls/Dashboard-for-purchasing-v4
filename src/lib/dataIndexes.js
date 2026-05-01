// src/lib/dataIndexes.js
// ============================================================
// Pre-built lookup indexes
// ============================================================
// `priceCompFull` puede tener cientos de miles de filas. Antes,
// `getVendorCoreUnitCost` y `getCppBenchmark` la escaneaban entera
// cada vez que se invocaban. Con ~1000 cores × ~50 vendors esto
// es O(N · cores · vendors) = decenas de millones de comparaciones.
//
// Indexamos por core (lowercase, trim) una sola vez. Después cada
// lookup es O(1) al Map + scan corto del subset. Para datasets
// reales: speedup ~100-1000x.
//
// Los índices se construyen a partir del shape ya parseado (objetos
// {core, vendor, note, pcs, matPrice, totalCost, inbShip, tariffs,
//  date, ...}) y NO mutan el array original.
// ============================================================

function lc(s) { return (s || '').toLowerCase().trim(); }

/**
 * Build indexes from priceCompFull (history) or priceComp (live).
 * @param {Array} priceRows - rows from data.priceCompFull or data.priceComp
 * @returns {{
 *   pricesByCoreLower: Map<string, Array>,    // lower(coreId) -> rows
 *   countTotal: number,
 *   countIndexed: number,
 * }}
 */
export function buildPriceIndexes(priceRows) {
  const pricesByCoreLower = new Map();
  let countIndexed = 0;
  if (Array.isArray(priceRows)) {
    for (const r of priceRows) {
      if (!r) continue;
      const cid = lc(r.core);
      if (!cid) continue;
      let arr = pricesByCoreLower.get(cid);
      if (!arr) { arr = []; pricesByCoreLower.set(cid, arr); }
      arr.push(r);
      countIndexed++;
    }
  }
  return {
    pricesByCoreLower,
    countTotal: Array.isArray(priceRows) ? priceRows.length : 0,
    countIndexed,
  };
}

/**
 * Build indexes for receiving (7f) rows by core.
 * Used for "canBuyAsBundle" lookups and bundle-already-delivered checks.
 */
export function buildReceivingIndexes(receivingFull) {
  const byCoreLower = new Map();
  if (Array.isArray(receivingFull)) {
    for (const r of receivingFull) {
      if (!r) continue;
      const cid = lc(r.core);
      if (!cid) continue;
      let arr = byCoreLower.get(cid);
      if (!arr) { arr = []; byCoreLower.set(cid, arr); }
      arr.push(r);
    }
  }
  return { byCoreLower };
}

/**
 * Build indexes for bundle daily series.
 * Many components (classifier, forecast, charts) want quick access
 * to "all rows for bundle X". Pre-grouping once is cheap.
 */
export function buildBundleDaysIndex(bundleDays) {
  const byBundle = new Map();
  if (Array.isArray(bundleDays)) {
    for (const d of bundleDays) {
      if (!d || !d.j) continue;
      let arr = byBundle.get(d.j);
      if (!arr) { arr = []; byBundle.set(d.j, arr); }
      arr.push(d);
    }
    for (const arr of byBundle.values()) {
      arr.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
  }
  return { byBundle };
}

/**
 * Master indexes object used by recommender + workers.
 */
export function buildAllIndexes({ priceCompFull, priceComp, receivingFull, bundleDays }) {
  const priceRows = (priceCompFull && priceCompFull.length) ? priceCompFull : (priceComp || []);
  return {
    price: buildPriceIndexes(priceRows),
    receiving: buildReceivingIndexes(receivingFull || []),
    bundleDays: buildBundleDaysIndex(bundleDays || []),
  };
}
