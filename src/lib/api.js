// API client — fetches data via Apps Script in chunks (1 MB each).
// Cache uses IndexedDB (via idb-keyval) because data is too large for localStorage.

import { get as idbGet, set as idbSet, del as idbDel } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';

const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

const HISTORY_CACHE_KEY = 'fba_history_cache_v4';
const LIVE_CACHE_KEY = 'fba_live_cache_v2';
const META_CACHE_KEY = 'fba_meta_cache_v1';
const META_CACHE_TTL_MS = 5 * 60 * 1000;
const LIVE_CACHE_TTL_MS = 240 * 60 * 1000; // 4 hrs

// ─── Generic Apps Script call ───
async function appsScriptCall(action, extraParams = '') {
  const url = API + '?action=' + action + extraParams + '&_t=' + Date.now();
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Apps Script error ${res.status} on ${action}`);
    const data = await res.json();
    if (data && data.error) throw new Error(`Apps Script error: ${data.error}`);
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`Timeout calling ${action}`);
    throw e;
  }
}

// ─── Fetch a single chunk ───
async function fetchChunk(file, idx) {
  const data = await appsScriptCall('chunk', '&file=' + file + '&i=' + idx);
  if (typeof data.chunk !== 'string') throw new Error(`Bad chunk ${idx} for ${file}`);
  return data.chunk;
}

// ─── Get metadata (cached 5 min in sessionStorage — small, fits fine) ───
async function getMeta() {
  try {
    const cached = sessionStorage.getItem(META_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed._cachedAt < META_CACHE_TTL_MS) return parsed.meta;
    }
  } catch (e) {}
  const meta = await appsScriptCall('meta');
  try { sessionStorage.setItem(META_CACHE_KEY, JSON.stringify({ meta, _cachedAt: Date.now() })); } catch (e) {}
  return meta;
}

// ─── Fetch all chunks of a file in parallel, concatenate, parse JSON ───
async function fetchFileInChunks(file, totalChunks, onProgress) {
  const BATCH = 4;
  const chunks = new Array(totalChunks);
  let done = 0;
  for (let i = 0; i < totalChunks; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, totalChunks); j++) {
      batch.push(fetchChunk(file, j).then(c => { chunks[j] = c; done++; if (onProgress) onProgress(done, totalChunks); }));
    }
    await Promise.all(batch);
  }
  const fullText = chunks.join('');
  try {
    return JSON.parse(fullText);
  } catch (e) {
    throw new Error(`Failed to parse ${file} JSON after assembling chunks: ${e.message}`);
  }
}

// ─── Public API: Live (cached 4h in IndexedDB) ───
export async function fetchLive(onProgress, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const cached = await idbGet(LIVE_CACHE_KEY);
      if (cached && cached._cachedAt && Date.now() - cached._cachedAt < LIVE_CACHE_TTL_MS) {
        return cached.data;
      }
    } catch (e) { console.warn('Live cache read failed:', e.message); }
  }
  const meta = await getMeta();
  if (!meta.live || !meta.live.chunks) throw new Error('No live metadata');
  const data = await fetchFileInChunks('live', meta.live.chunks, onProgress);
  try {
    await idbSet(LIVE_CACHE_KEY, { data, _cachedAt: Date.now() });
  } catch (e) {
    console.warn('Live cache write failed:', e.message);
  }
  return data;
}

// ─── Public API: History (cached by lastUpdated in IndexedDB) ───
export async function fetchHistory({ forceRefresh = false, onProgress } = {}) {
  const meta = await getMeta();
  if (!meta.history || !meta.history.chunks) throw new Error('No history metadata');
  const remoteVersion = meta.history.lastUpdated;

  if (!forceRefresh) {
    try {
      const cached = await idbGet(HISTORY_CACHE_KEY);
      if (cached && cached._remoteLastUpdated === remoteVersion) {
        return cached;
      }
    } catch (e) { console.warn('History cache read failed:', e.message); }
  }

  const fresh = await fetchFileInChunks('history', meta.history.chunks, onProgress);
  fresh._remoteLastUpdated = remoteVersion;
  fresh._cachedAt = new Date().toISOString();
  try {
    await idbSet(HISTORY_CACHE_KEY, fresh);
  } catch (e) {
    console.warn('History cache write failed:', e.message);
  }
  return fresh;
}

// ─── Force server rebuild of history ───
export async function refreshHistoryOnServer() {
  try { sessionStorage.removeItem(META_CACHE_KEY); } catch (e) {}
  return appsScriptCall('refreshHistory');
}

// ─── Metadata for badge ───
export async function fetchInfo() {
  return getMeta();
}

// ─── POST (workflow + comments) ───
export async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ─── Cache helpers ───
export async function clearHistoryCache() {
  try { await idbDel(HISTORY_CACHE_KEY); } catch (e) {}
  try { await idbDel(LIVE_CACHE_KEY); } catch (e) {}
  try { sessionStorage.removeItem(META_CACHE_KEY); } catch (e) {}
}
