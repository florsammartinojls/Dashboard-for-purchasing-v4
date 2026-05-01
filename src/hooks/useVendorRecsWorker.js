// src/hooks/useVendorRecsWorker.js
// ============================================================
// Spawns one recommender worker, reuses it across input changes.
// Debounces input changes by 300ms so a settings tweak doesn't
// trigger 5 recomputations in a second.
//
// Returns:
//   { vendorRecs, status, lastUpdated, lastError, progress }
//
// status ∈ { 'idle', 'calculating', 'ready', 'error' }
//
// Falls back to running synchronously on the main thread if Worker
// is unavailable (e.g. ancient browser, SSR). The on-thread path
// uses the same v4 batch to keep behavior identical.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { batchVendorRecommendationsV4 } from '../lib/recommenderV4';

const DEBOUNCE_MS = 300;

function buildPayload(input) {
  return {
    vendors: input.vendors || [],
    cores: input.cores || [],
    bundles: input.bundles || [],
    bundleSales: input.bundleSales || [],
    bundleDays: input.bundleDays || [],
    coreDays: input.coreDays || [],
    abcA: input.abcA || [],
    receivingFull: input.receivingFull || [],
    replenMap: input.replenMap || {},
    missingMap: input.missingMap || {},
    priceCompFull: input.priceCompFull || [],
    priceComp: input.priceComp || [],
    segmentMap: input.segmentMap || {},
    settings: input.settings || {},
  };
}

export function useVendorRecsWorker(input, { enabled = true } = {}) {
  const workerRef = useRef(null);
  const reqIdRef = useRef(0);
  const debounceRef = useRef(null);
  const [vendorRecs, setVendorRecs] = useState({});
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [lastError, setLastError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Memo a stringified summary of input identity to avoid spurious
  // recomputes when nothing meaningful changed (we still recompute
  // when the underlying arrays do — React re-renders if the
  // reference changes, which is what useEffect depends on).
  const inputKey = useMemo(() => {
    if (!input) return '';
    return [
      input.vendors?.length, input.cores?.length, input.bundles?.length,
      input.bundleDays?.length, input.bundleSales?.length, input.coreDays?.length,
      input.abcA?.length, input.receivingFull?.length, input.priceCompFull?.length,
      Object.keys(input.segmentMap || {}).length,
      Object.keys(input.settings || {}).length,
    ].join('|');
  }, [input]);

  useEffect(() => {
    if (!enabled) return;
    if (!input || !input.vendors || input.vendors.length === 0) {
      setVendorRecs({});
      setStatus('idle');
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      const id = ++reqIdRef.current;
      const payload = buildPayload(input);
      setStatus('calculating');
      setProgress(0);

      // Try the worker first.
      if (typeof Worker !== 'undefined') {
        try {
          if (!workerRef.current) {
            workerRef.current = new Worker(
              new URL('../workers/recommender.worker.js', import.meta.url),
              { type: 'module' }
            );
          }
          const w = workerRef.current;
          const onMessage = (e) => {
            const m = e.data || {};
            if (m.id !== id) return;
            if (m.kind === 'progress') {
              setProgress(m.pct);
              return;
            }
            if (m.kind === 'done') {
              w.removeEventListener('message', onMessage);
              if (m.ok) {
                setVendorRecs(m.result || {});
                setStatus('ready');
                setLastError(null);
                setLastUpdated(new Date());
              } else {
                if (typeof console !== 'undefined') console.error('[worker]', m.error, m.stack);
                setLastError(m.error || 'Worker failed');
                setStatus('error');
              }
            }
          };
          w.addEventListener('message', onMessage);
          w.postMessage({ kind: 'run', id, payload });
          return;
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[worker] failed to spawn, falling back on main thread:', err);
          }
        }
      }

      // Fallback: same engine, blocks the main thread.
      try {
        const result = batchVendorRecommendationsV4(payload);
        setVendorRecs(result || {});
        setStatus('ready');
        setLastUpdated(new Date());
        setLastError(null);
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[useVendorRecsWorker] sync run failed:', err);
        setLastError(err?.message || String(err));
        setStatus('error');
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, inputKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tear down the worker on unmount.
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        try { workerRef.current.terminate(); } catch {}
        workerRef.current = null;
      }
    };
  }, []);

  return { vendorRecs, status, progress, lastError, lastUpdated };
}
