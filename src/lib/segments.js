// src/lib/segments.js
// ============================================================
// Segment Override CRUD (localStorage)
// ============================================================
// Per spec §2.4: overrides live in localStorage as
// { [bundleId]: 'SEGMENT_NAME', ... }. On first run the seed file
// (src/data/segment_overrides_seed.json, shipped in repo) is loaded
// once. After that the override store is the source of truth and
// the seed is never re-read.
//
// All synchronous: storage is small (~1KB per 100 overrides).
// ============================================================

import seedOverrides from '../data/segment_overrides_seed.json';
import { SEGMENTS } from './segmentClassifier';

const STORAGE_KEY = 'fba_segment_overrides_v1';
const SEED_FLAG_KEY = 'fba_segment_overrides_v1_seeded';

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

// Idempotent. Reads localStorage; if missing AND no prior seed
// flag, applies the seed file once and persists.
export function loadOverrides() {
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

export function setOverride(bundleId, segment) {
  if (!bundleId) return;
  const cur = loadOverrides();
  if (!segment || !SEGMENTS.includes(segment)) {
    delete cur[bundleId];
  } else {
    cur[bundleId] = segment;
  }
  writeRaw(cur);
  return cur;
}

export function bulkSetOverrides(updates) {
  const cur = loadOverrides();
  for (const [bid, seg] of Object.entries(updates || {})) {
    if (!bid) continue;
    if (!seg || !SEGMENTS.includes(seg)) {
      delete cur[bid];
    } else {
      cur[bid] = seg;
    }
  }
  writeRaw(cur);
  return cur;
}

export function clearOverride(bundleId) {
  return setOverride(bundleId, null);
}

export function clearAllOverrides() {
  writeRaw({});
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
