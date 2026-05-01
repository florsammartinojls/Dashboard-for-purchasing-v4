// src/lib/segments.js
// ============================================================
// Segment Override CRUD
// ============================================================
// Two storage tiers, in order of preference:
//   1. Backend (Google Sheet via Apps Script) — authoritative when
//      data.segmentOverrides is populated. Multi-buyer visible.
//      Each row carries updatedBy / updatedAt / reason.
//   2. localStorage — used as the fallback before the backend
//      lands, AND as a write-through cache so an offline/network
//      failure doesn't lose state.
//
// Migration: on first load after the backend ships, if
// localStorage has overrides and the backend has none, we surface
// a one-time prompt to push them. After the user approves (or
// declines and clears local), localStorage stops being primary.
//
// Read API: loadOverrides({ remote }) — pass the remote rows from
// data.segmentOverrides; we merge with localStorage as fallback.
// Write API: setOverride / bulkSet / clearOverride — these accept
// an optional { apiPost, buyer, reason } so the call can hit the
// backend; we always write through to localStorage.
// ============================================================

import seedOverrides from '../data/segment_overrides_seed.json';
import { SEGMENTS } from './segmentClassifier';

const STORAGE_KEY = 'fba_segment_overrides_v1';
const SEED_FLAG_KEY = 'fba_segment_overrides_v1_seeded';
const MIGRATION_FLAG_KEY = 'fba_segment_overrides_migrated_v1';

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch { return null; }
}

function writeRaw(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj || {}));
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('segments: failed to persist overrides', e);
  }
}

function cleanInput(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!k) continue;
    if (typeof v !== 'string') continue;
    if (!SEGMENTS.includes(v)) continue;
    out[k] = v;
  }
  return out;
}

// Read remote rows (data.segmentOverrides) and produce a flat map.
// Each remote row is { bundleId, segment, updatedBy, updatedAt, reason }.
// Returns { map, meta } where meta keeps the per-row metadata for UI.
export function fromRemoteRows(rows) {
  const map = {};
  const meta = {};
  if (!Array.isArray(rows)) return { map, meta };
  for (const r of rows) {
    if (!r || !r.bundleId) continue;
    if (!r.segment || !SEGMENTS.includes(r.segment)) continue;
    map[r.bundleId] = r.segment;
    meta[r.bundleId] = {
      updatedBy: r.updatedBy || '',
      updatedAt: r.updatedAt || '',
      reason: r.reason || '',
    };
  }
  return { map, meta };
}

// Idempotent. Reads localStorage; if missing AND no prior seed
// flag, applies the seed file once and persists.
//
// When called with { remote: rows } and the remote has any data,
// the remote map takes precedence and we mirror it to localStorage
// as a write-through cache.
export function loadOverrides(opts = {}) {
  const remote = opts.remote;
  if (Array.isArray(remote) && remote.length > 0) {
    const { map } = fromRemoteRows(remote);
    writeRaw(map);
    try { localStorage.setItem(SEED_FLAG_KEY, '1'); } catch {}
    return map;
  }
  const stored = readRaw();
  if (stored) return stored;
  // First run path: apply seed, set flag, persist.
  const seed = cleanInput(seedOverrides);
  let alreadySeeded = false;
  try { alreadySeeded = !!localStorage.getItem(SEED_FLAG_KEY); } catch {}
  if (alreadySeeded) {
    writeRaw({});
    return {};
  }
  writeRaw(seed);
  try { localStorage.setItem(SEED_FLAG_KEY, '1'); } catch {}
  return seed;
}

// Returns the local map (for migration check)
export function loadLocalOnly() {
  return readRaw() || {};
}

export function isMigrated() {
  try { return !!localStorage.getItem(MIGRATION_FLAG_KEY); } catch { return false; }
}
export function markMigrated() {
  try { localStorage.setItem(MIGRATION_FLAG_KEY, '1'); } catch {}
}

// Local-only write. Used as fallback or when no apiPost was provided.
function setOverrideLocal(bundleId, segment) {
  const cur = readRaw() || {};
  if (!segment || !SEGMENTS.includes(segment)) {
    delete cur[bundleId];
  } else {
    cur[bundleId] = segment;
  }
  writeRaw(cur);
  return cur;
}

// Write-through to backend if apiPost is provided; always mirrors to
// localStorage so a network failure doesn't leave the UI inconsistent.
// Returns a Promise that resolves with the updated local map. The
// remote write fires-and-forgets but its failure is logged so the
// next live cycle can re-pull authoritative state.
export async function setOverride(bundleId, segment, opts = {}) {
  if (!bundleId) return readRaw() || {};
  // Optimistic local write
  const localMap = setOverrideLocal(bundleId, segment);
  const apiPost = opts.apiPost;
  if (apiPost) {
    try {
      const action = !segment || !SEGMENTS.includes(segment)
        ? 'deleteSegmentOverride'
        : 'saveSegmentOverride';
      await apiPost({
        action,
        bundleId,
        segment: segment || null,
        updatedBy: opts.buyer || '',
        reason: opts.reason || '',
      });
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn('[segments] backend write failed, kept local override only:', e?.message || e);
      }
    }
  }
  return localMap;
}

export async function bulkSetOverrides(updates, opts = {}) {
  // Sequential local writes + parallel backend writes
  const cur = readRaw() || {};
  for (const [bid, seg] of Object.entries(updates || {})) {
    if (!bid) continue;
    if (!seg || !SEGMENTS.includes(seg)) delete cur[bid];
    else cur[bid] = seg;
  }
  writeRaw(cur);
  if (opts.apiPost) {
    const calls = Object.entries(updates || {}).map(([bid, seg]) => {
      const action = !seg || !SEGMENTS.includes(seg) ? 'deleteSegmentOverride' : 'saveSegmentOverride';
      return opts.apiPost({ action, bundleId: bid, segment: seg || null, updatedBy: opts.buyer || '', reason: opts.reason || '' })
        .catch(e => { if (typeof console !== 'undefined') console.warn('[segments] bulk write fail', bid, e?.message || e); });
    });
    Promise.allSettled(calls).then(() => {});
  }
  return cur;
}

export function clearOverride(bundleId, opts = {}) {
  return setOverride(bundleId, null, opts);
}

export function clearAllOverrides(opts = {}) {
  const cur = readRaw() || {};
  writeRaw({});
  if (opts.apiPost) {
    for (const bid of Object.keys(cur)) {
      opts.apiPost({ action: 'deleteSegmentOverride', bundleId: bid, updatedBy: opts.buyer || '' })
        .catch(() => {});
    }
  }
  return {};
}

export function exportOverrides() {
  const cur = loadOverrides();
  return JSON.stringify(cur, null, 2);
}

export function importOverrides(jsonStringOrObject) {
  let parsed;
  if (typeof jsonStringOrObject === 'string') {
    try { parsed = JSON.parse(jsonStringOrObject); } catch { return { ok: false, error: 'Invalid JSON' }; }
  } else {
    parsed = jsonStringOrObject;
  }
  const clean = cleanInput(parsed);
  writeRaw(clean);
  return { ok: true, count: Object.keys(clean).length };
}

// Effective segment = override if present, else auto.
export function effectiveSegment(bundleId, autoSegment, overrides) {
  if (!bundleId) return autoSegment || 'STABLE';
  const ov = overrides ? overrides[bundleId] : undefined;
  if (ov && SEGMENTS.includes(ov)) return ov;
  return autoSegment || 'STABLE';
}

// Build an "effective segment map" from the auto map + overrides.
// Each entry preserves the auto record (so the UI can show "auto X →
// override Y" diffs) and adds an `effective` field.
export function buildEffectiveMap(autoMap, overrides) {
  const out = {};
  for (const [bid, autoRec] of Object.entries(autoMap || {})) {
    const ov = overrides ? overrides[bid] : null;
    const effective = ov && SEGMENTS.includes(ov) ? ov : autoRec.segment;
    out[bid] = {
      ...autoRec,
      override: ov || null,
      effective,
    };
  }
  return out;
}
