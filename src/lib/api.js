const API = 'https://script.google.com/macros/s/AKfycbzt83RC7YYrE59ATSs8E5g9724bMdZPwepFHXDU-mM6IJ4g719ixQDj7x6wVoYg_grk9Q/exec';

let _jid = 0;
function jp(u, t = 90000) {
  return new Promise((rs, rj) => {
    const cb = '__jp' + (++_jid) + '_' + Date.now();
    const tm = setTimeout(() => { cl(); rj(new Error('Timeout')) }, t);
    const s = document.createElement('script');
    function cl() { clearTimeout(tm); delete window[cb]; s.parentNode && s.parentNode.removeChild(s) }
    window[cb] = d => { cl(); rs(d) };
    s.src = u + (u.includes('?') ? '&' : '?') + 'callback=' + cb;
    s.onerror = () => { cl(); rj(new Error('Network')) };
    document.head.appendChild(s);
  });
}

const CACHE_TTL = 5 * 60 * 1000; // 5 min session cache

function getCached(key) {
  try {
    const raw = sessionStorage.getItem('fba_' + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null }
}

function setCache(key, data) {
  try { sessionStorage.setItem('fba_' + key, JSON.stringify({ data, ts: Date.now() })) } catch { }
}

export async function api(action) {
  const cached = getCached(action);
  const fresh = jp(API + '?action=' + action + '&_t=' + Date.now());
  if (cached) {
    fresh.then(d => setCache(action, d)).catch(() => {});
    return cached;
  }
  const d = await fresh;
  setCache(action, d);
  return d;
}

export async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  return res.json();
}
