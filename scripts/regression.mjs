// scripts/regression.mjs
// ============================================================
// V4 Forecast regression runner
// ============================================================
// Loads src/lib/__tests__/recommenderV4.regression.json, builds
// synthetic series per fixture, runs calcBundleForecastV4, and
// asserts the output against the locked expectation. Numeric
// fields tolerate ±tolerance_pct (default 2%); segment / formula
// strings must match exactly.
//
// Run with:    npm run regression
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { calcBundleForecastV4 } from '../src/lib/forecastV4.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '..', 'src', 'lib', '__tests__', 'recommenderV4.regression.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

const TOLERANCE_PCT = (fixtures._meta?.tolerance_pct ?? 2) / 100;
const ASOF = fixtures._meta?.asOf ? new Date(fixtures._meta.asOf + 'T00:00:00Z') : new Date();

// Mulberry32 — tiny seeded PRNG for noise reproducibility
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateMinusDays(days) {
  const d = new Date(ASOF.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

// Build a synthetic bundleDays array per fixture spec.
function buildSeries(fx) {
  const out = [];
  const days = fx.series_days;
  const id = fx.bundleId;

  switch (fx.series_kind) {
    case 'constant': {
      for (let i = days - 1; i >= 0; i--) {
        out.push({ j: id, date: dateMinusDays(i), dsr: fx.series_value });
      }
      break;
    }
    case 'noisy_constant': {
      const r = rng(fx.series_seed || 1);
      for (let i = days - 1; i >= 0; i--) {
        const noise = (r() - 0.5) * 2 * fx.series_noise;
        out.push({ j: id, date: dateMinusDays(i), dsr: Math.max(0, fx.series_value + noise) });
      }
      break;
    }
    case 'linear': {
      const start = fx.series_start;
      const end = fx.series_end;
      for (let i = 0; i < days; i++) {
        const t = i / (days - 1);
        const v = start + (end - start) * t;
        // i=0 is oldest, i=days-1 is most recent
        out.push({ j: id, date: dateMinusDays(days - 1 - i), dsr: Math.max(0, v) });
      }
      break;
    }
    case 'intermittent': {
      const eventDays = Math.floor(fx.intermittent_total_units / fx.intermittent_event_size);
      const interval = Math.floor(days / Math.max(1, eventDays));
      for (let i = days - 1; i >= 0; i--) {
        const isEvent = (i % interval) === 0 && eventDays > 0;
        out.push({ j: id, date: dateMinusDays(i), dsr: isEvent ? fx.intermittent_event_size : 0 });
      }
      break;
    }
    case 'dormant': {
      // Old part: dormant_old_value, recent part (dormant_recent_days): dormant_recent_value
      for (let i = days - 1; i >= 0; i--) {
        const isRecent = i < fx.dormant_recent_days;
        const v = isRecent ? fx.dormant_recent_value : fx.dormant_old_value;
        out.push({ j: id, date: dateMinusDays(i), dsr: v });
      }
      break;
    }
    case 'seasonal': {
      // Off-season default; peak months get peak value
      for (let i = days - 1; i >= 0; i--) {
        const dt = new Date(ASOF.getTime() - i * 86400000);
        const month = dt.getUTCMonth() + 1;
        const isPeak = (fx.seasonal_peak_months || []).includes(month);
        out.push({ j: id, date: dateMinusDays(i), dsr: isPeak ? fx.seasonal_peak_value : fx.seasonal_off_value });
      }
      break;
    }
    default:
      throw new Error(`Unknown series_kind: ${fx.series_kind}`);
  }
  return out;
}

function buildBundleSales(fx, series) {
  if (!fx.bundleSales_kind) return [];
  if (fx.bundleSales_kind === 'monthly_from_series') {
    const byYM = new Map();
    for (const r of series) {
      const ym = r.date.slice(0, 7);
      const e = byYM.get(ym) || { y: +ym.slice(0, 4), m: +ym.slice(5, 7), units: 0, dataDays: 0 };
      e.units += r.dsr;
      e.dataDays += 1;
      byYM.set(ym, e);
    }
    return [...byYM.values()].map(e => ({
      j: fx.bundleId, y: e.y, m: e.m,
      units: Math.round(e.units),
      dataDays: e.dataDays,
      avgDsr: e.dataDays > 0 ? e.units / e.dataDays : 0,
    }));
  }
  return [];
}

// ─── Assertions ──────────────────────────────────────────────
function checkRange(actual, lo, hi, label) {
  if (lo != null && actual < lo) return `${label}=${actual.toFixed(3)} below min ${lo}`;
  if (hi != null && actual > hi) return `${label}=${actual.toFixed(3)} above max ${hi}`;
  return null;
}
function checkClose(actual, expected, label) {
  if (expected === 0) {
    if (Math.abs(actual) > 0.01) return `${label}=${actual.toFixed(3)} (expected 0)`;
    return null;
  }
  const tol = Math.max(0.01, Math.abs(expected) * TOLERANCE_PCT);
  if (Math.abs(actual - expected) > tol) {
    return `${label}=${actual.toFixed(3)} not within ${(TOLERANCE_PCT * 100).toFixed(1)}% of ${expected}`;
  }
  return null;
}

function runFixture(fx) {
  const series = buildSeries(fx);
  const bundleSales = buildBundleSales(fx, series);
  const out = calcBundleForecastV4({
    bundleId: fx.bundleId,
    segment: fx.segment,
    bundleDays: series,
    bundleSales,
    leadTime: fx.leadTime,
    targetDoc: fx.targetDoc,
    profABC: fx.profABC || null,
    bundleDsrFromSheet: fx.sheetDsr || 0,
    settings: fx.settings || {},
    asOf: ASOF,
  });

  const errors = [];
  const exp = fx.expected || {};

  if (exp.segment && out.segment !== exp.segment) {
    errors.push(`segment="${out.segment}" expected="${exp.segment}"`);
  }
  if (exp.formula_includes && !(out.formula || '').includes(exp.formula_includes)) {
    errors.push(`formula="${out.formula}" missing "${exp.formula_includes}"`);
  }
  if (exp.level != null) {
    const e = checkClose(out.level, exp.level, 'level');
    if (e) errors.push(e);
  }
  if (exp.coverageDemand != null) {
    const e = checkClose(out.coverageDemand, exp.coverageDemand, 'coverageDemand');
    if (e) errors.push(e);
  }
  if (exp.safetyStock != null) {
    const e = checkClose(out.safetyStock, exp.safetyStock, 'safetyStock');
    if (e) errors.push(e);
  }
  for (const [field, key] of [
    ['level', 'level'],
    ['trend', 'trend'],
    ['coverageDemand', 'coverageDemand'],
    ['safetyStock', 'safetyStock'],
  ]) {
    if (exp[`${key}_min`] != null || exp[`${key}_max`] != null) {
      const e = checkRange(out[field], exp[`${key}_min`], exp[`${key}_max`], key);
      if (e) errors.push(e);
    }
  }
  return { errors, out };
}

// ─── Main ─────────────────────────────────────────────────────
let failed = 0;
const lines = [];
for (const fx of fixtures.fixtures) {
  const { errors, out } = runFixture(fx);
  if (errors.length === 0) {
    lines.push(`  ✓  ${fx.id.padEnd(28)} segment=${out.segment}, level=${out.level.toFixed(2)}, coverage=${out.coverageDemand.toFixed(0)}`);
  } else {
    failed++;
    lines.push(`  ✗  ${fx.id.padEnd(28)} segment=${out.segment}, level=${out.level.toFixed(2)}`);
    for (const e of errors) lines.push(`        ${e}`);
  }
}

process.stdout.write([
  `Regression — ${fixtures.fixtures.length} fixtures, tolerance ${(TOLERANCE_PCT * 100).toFixed(1)}%`,
  `as-of: ${ASOF.toISOString().slice(0, 10)}`,
  ``,
  ...lines,
  ``,
  failed === 0
    ? `✓ All ${fixtures.fixtures.length} fixtures passed.`
    : `✗ ${failed} of ${fixtures.fixtures.length} fixtures failed.`,
  '',
].join('\n'));

process.exit(failed === 0 ? 0 : 1);
