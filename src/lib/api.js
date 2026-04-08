// API client — talks to Apps Script for URLs, then fetches JSON files directly from Drive.
// This avoids Apps Script's content size limits and is much faster (Drive has CDN).

const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

const HISTORY_CACHE_KEY = 'fba_history_cache_v2';
const URLS_CACHE_KEY = 'fba_urls_cache_v1';
const URLS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Apps Script call (small responses only: URLs, refresh triggers) ───
async function appsScriptCall(action) {
  const url = API + '?action=' + action + '&_t=' + Date.now();
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Apps Script error: ${res.status} on ${action}`);
    const data = await res.json();
    if (data && data.error) throw new Error(`Apps Script returned error: ${data.error}`);
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`Timeout calling Apps Script ${action} (60s)`);
    throw e;
  }
}

// ─── Fetch a JSON file directly from Drive ───
// Drive download URLs return the file content as-is, no Apps Script involved.
async function fetchDriveJson(downloadUrl, label) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 180000); // 3 min for large files
  try {
    const res = await fetch(downloadUrl, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Drive fetch error: ${res.status} on ${label}`);
    const text = await res.text();
    // Drive sometimes returns an HTML "virus scan warning" page for very large files
    // instead of the actual content. Detect that.
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`Drive returned HTML instead of JSON for ${label} (file may need re-sharing)`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Failed to parse ${label} JSON: ${e.message} (length: ${text.length})`);
    }
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`Timeout fetching ${label} from Drive (3 min)`);
    throw e;
  }
}

// ─── Get URLs (cached for 5 min so we don't hit Apps Script every time) ───
async function getUrls() {
  try {
    const cached = sessionStorage.getItem(URLS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed._cachedAt < URLS_CACHE_TTL_MS) {
        return parsed.urls;
      }
    }
  } catch (e) { /* ignore cache errors */ }

  const urls = await appsScriptCall('urls');
  try {
    sessionStorage.setItem(URLS_CACHE_KEY, JSON.stringify({ urls, _cachedAt: Date.now() }));
  } catch (e) { /* ignore */ }
  return urls;
}

// ─── Public API: Live data — always fresh from Drive ───
export async function fetchLive() {
  const urls = await getUrls();
  if (!urls.live || !urls.live.url) throw new Error('No live URL returned from Apps Script');
  const data = await fetchDriveJson(urls.live.url, 'live');
  return data;
}

// ─── Public API: History data — cached in localStorage by file lastUpdated timestamp ───
export async function fetchHistory({ forceRefresh = false } = {}) {
  const urls = await getUrls();
  if (!urls.history || !urls.history.url) throw new Error('No history URL returned from Apps Script');
  const remoteVersion = urls.history.lastUpdated;

  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(HISTORY_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Use cached if the remote file hasn't been updated since
        if (parsed._remoteLastUpdated === remoteVersion) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('History cache read failed, fetching fresh:', e.message);
    }
  }

  const fresh = await fetchDriveJson(urls.history.url, 'history');
  fresh._remoteLastUpdated = remoteVersion;
  fresh._cachedAt = new Date().toISOString();
  try {
    localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(fresh));
  } catch (e) {
    console.warn('History cache write failed:', e.message);
  }
  return fresh;
}

// ─── Force a server-side rebuild of history (slow ~3 min) ───
export async function refreshHistoryOnServer() {
  // Clear URL cache so next fetchHistory gets fresh URL/timestamp
  try { sessionStorage.removeItem(URLS_CACHE_KEY); } catch (e) {}
  return appsScriptCall('refreshHistory');
}

// ─── Get metadata about both files ───
export async function fetchInfo() {
  return appsScriptCall('info');
}

// ─── POST endpoint — unchanged for workflow + vendor comments ───
export async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ─── Cache helpers (debug) ───
export function clearHistoryCache() {
  try { localStorage.removeItem(HISTORY_CACHE_KEY); } catch (e) {}
  try { sessionStorage.removeItem(URLS_CACHE_KEY); } catch (e) {}
}
