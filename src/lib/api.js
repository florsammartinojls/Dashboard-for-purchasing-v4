// API client — talks to Apps Script.
// Two endpoints: 'live' (every 15 min) and 'history' (daily).
// History is cached in localStorage to avoid re-downloading on every page load.

const API = 'https://script.google.com/macros/s/AKfycbyxFvNQjWvF6Ckajd_H-OZ8WsXixoCWtjSxtChs8SmpL5CvidjT5P161tn0RXgYawd3sg/exec';

const HISTORY_CACHE_KEY = 'fba_history_cache_v1';

// Generic fetch with timeout + clear errors
async function apiFetch(action) {
  const url = API + '?action=' + action + '&_t=' + Date.now();
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 60000); // 60s timeout
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`API error: ${res.status} on ${action}`);
    const data = await res.json();
    if (data && data.error) throw new Error(`API returned error: ${data.error}`);
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error(`Timeout fetching ${action} (60s)`);
    throw e;
  }
}

// Live data — always fetch fresh
export async function fetchLive() {
  return apiFetch('live');
}

// History data — cached in localStorage. Only re-download if version changed.
export async function fetchHistory({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(HISTORY_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Check freshness: re-download if older than 25 hours
        const cachedAt = parsed._cachedAt ? new Date(parsed._cachedAt) : null;
        const ageHours = cachedAt ? (Date.now() - cachedAt.getTime()) / 3600000 : 999;
        if (ageHours < 25) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('History cache read failed, fetching fresh:', e.message);
    }
  }

  const fresh = await apiFetch('history');
  fresh._cachedAt = new Date().toISOString();
  try {
    localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(fresh));
  } catch (e) {
    // localStorage might be full or unavailable — not fatal, just log
    console.warn('History cache write failed:', e.message);
  }
  return fresh;
}

// Force a server-side rebuild of history (slow, ~3 min). Used by manual button.
export async function refreshHistoryOnServer() {
  return apiFetch('refreshHistory');
}

// Get metadata about both files (last updated, sizes) — for the freshness badge
export async function fetchInfo() {
  return apiFetch('info');
}

// POST endpoint — unchanged behavior, still used for workflow + vendor comments
export async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Clear local history cache (debug helper, exposed in case you need it)
export function clearHistoryCache() {
  try { localStorage.removeItem(HISTORY_CACHE_KEY); } catch (e) {}
}
