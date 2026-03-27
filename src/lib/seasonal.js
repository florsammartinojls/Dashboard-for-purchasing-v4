// === SEASONAL FORECASTING ENGINE v1 ===
// Projected demand using: weighted seasonal indices, momentum, trend decay
// Used by Fill Rec, Fill to MOQ, CalcBreakdown

import { cAI } from "./utils";

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const r2 = n => Math.round(n * 100) / 100;
const r0 = n => Math.round(n);
const fmt = d => d.toISOString().split('T')[0];
const DEFAULT_PROFILE = { indices: new Array(12).fill(1.0), cv: 0, momentum: 1.0, hasHistory: false, monthlyDetail: [], yearlyTotals: {} };

// ─── SEASONAL PROFILE ────────────────────────────────────────────
// coreHistory: pre-filtered for this core (from batchProfiles)
// recentDays: pre-filtered daily data for this core
export function calcSeasonalProfile(coreId, coreHistory, recentDays) {
  const ms = (coreHistory || []).filter(h => h.units > 0 || h.avgDsr > 0);
  if (ms.length < 6) return { ...DEFAULT_PROFILE };

  const years = [...new Set(ms.map(m => m.y))].sort();
  const latestYear = years[years.length - 1];

  // ── Weighted avg per month (75% latest year, 25% older) ──
  const monthlyRaw = new Array(12).fill(null).map(() => []);
  const monthlyDetail = [];

  ms.forEach(h => {
    const dsr = h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0);
    if (dsr <= 0) return;
    const mi = h.m - 1;
    const weight = h.y === latestYear ? 0.75 : (0.25 / Math.max(1, years.length - 1));
    monthlyRaw[mi].push({ dsr, weight, year: h.y, oosDays: h.oosDays || 0, dataDays: h.dataDays || 0 });
  });

  const monthlyAvg = monthlyRaw.map((entries, mi) => {
    if (entries.length === 0) return 0;
    const valid = entries.filter(e => e.dataDays > 0 && (e.oosDays / e.dataDays) < 0.5);
    if (valid.length === 0) return 0;
    let wSum = 0, wTot = 0;
    valid.forEach(e => { wSum += e.dsr * e.weight; wTot += e.weight; });
    const avg = wTot > 0 ? wSum / wTot : 0;
    monthlyDetail.push({
      month: mi + 1, monthName: MONTHS[mi], weightedAvg: r2(avg),
      entries: valid.map(e => ({ year: e.year, dsr: r2(e.dsr) }))
    });
    return avg;
  });

  // ── Global weighted average ──
  const validAvgs = monthlyAvg.filter(v => v > 0);
  if (validAvgs.length === 0) return { ...DEFAULT_PROFILE };
  const globalAvg = validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length;

  // ── Seasonal indices ──
  const indices = monthlyAvg.map(v => v > 0 ? r2(v / globalAvg) : 1.0);

  // ── CV (coefficient of variation) ──
  const variance = validAvgs.reduce((a, v) => a + Math.pow(v - globalAvg, 2), 0) / validAvgs.length;
  const cv = globalAvg > 0 ? r2(Math.sqrt(variance) / globalAvg) : 0;

  // ── Yearly totals ──
  const yearlyTotals = {};
  years.forEach(y => {
    yearlyTotals[y] = r0(ms.filter(h => h.y === y).reduce((s, h) => {
      return s + (h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0));
    }, 0));
  });

  // ── Momentum: recent daily data vs same period last year ──
  let momentum = 1.0;
  const rd = recentDays || [];
  if (rd.length >= 5) {
    const recentAvg = rd.reduce((s, d) => s + (d.d1 || d.dsr || 0), 0) / rd.length;
    const now = new Date();
    const curMonth = now.getMonth();
    const lyYear = latestYear === now.getFullYear() ? latestYear - 1 : latestYear;
    const lyData = ms.filter(h => h.y === lyYear && Math.abs(h.m - 1 - curMonth) <= 1);
    if (lyData.length > 0) {
      const lyAvg = lyData.reduce((s, h) => {
        return s + (h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0));
      }, 0) / lyData.length;
      if (lyAvg > 0) momentum = Math.max(0.3, Math.min(3.0, r2(recentAvg / lyAvg)));
    }
  }

  return { indices, cv, momentum, hasHistory: true, monthlyDetail, yearlyTotals };
}


// ─── MOMENTUM WEIGHT ─────────────────────────────────────────────
function getMomentumWeight(cv) {
  if (cv < 0.15) return 0.80;
  if (cv < 0.35) return 0.50;
  return 0.20;
}


// ─── PROJECTED DSR FOR MONTH ─────────────────────────────────────
export function projectedDSR(currentDSR, monthIndex, profile, monthsAhead) {
  const mw = getMomentumWeight(profile.cv);
  const seasonalFactor = profile.indices[monthIndex] || 1.0;
  let effMom = profile.momentum;
  if (monthsAhead > 6) effMom = 1 + (effMom - 1) * 0.4;
  else if (monthsAhead > 3) effMom = 1 + (effMom - 1) * 0.7;
  const blended = (mw * effMom) + ((1 - mw) * seasonalFactor);
  return currentDSR * Math.max(0.1, blended);
}


// ─── COVERAGE WINDOW NEED ────────────────────────────────────────
export function calcCoverageNeed(core, leadTimeDays, targetDOC, profile) {
  const dsr = core.dsr || 0;
  if (dsr <= 0) return { need: 0, projectedMonths: [], totalProjected: 0, inventory: 0, windowStart: '', windowEnd: '' };

  const today = new Date();
  const wStart = new Date(today); wStart.setDate(wStart.getDate() + leadTimeDays);
  const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + targetDOC);

  let totalProjected = 0;
  const projectedMonths = [];
  let cursor = new Date(wStart);

  while (cursor < wEnd) {
    const mi = cursor.getMonth();
    const yr = cursor.getFullYear();
    const monthLast = new Date(yr, mi + 1, 0);
    const effEnd = new Date(Math.min(monthLast.getTime(), wEnd.getTime()));
    const effStart = new Date(Math.max(cursor.getTime(), wStart.getTime()));
    const days = Math.max(1, Math.round((effEnd - effStart) / 86400000) + 1);
    const monthsAhead = Math.max(0, Math.round((cursor - today) / (30 * 86400000)));
    const pDsr = projectedDSR(dsr, mi, profile, monthsAhead);
    const units = pDsr * days;
    totalProjected += units;
    projectedMonths.push({
      month: mi + 1, year: yr, label: MONTHS[mi] + ' ' + yr,
      days, projDsr: r2(pDsr), units: r0(units),
      seasonalIdx: profile.indices[mi] || 1.0,
      blendedFactor: r2(pDsr / dsr),
    });
    cursor = new Date(yr, mi + 1, 1);
  }

  const inventory = cAI(core);
  const need = Math.max(0, Math.ceil(totalProjected - inventory));
  return { need, projectedMonths, totalProjected: r0(totalProjected), inventory, windowStart: fmt(wStart), windowEnd: fmt(wEnd) };
}


// ─── FILL TO MOQ ─────────────────────────────────────────────────
export function fillToMOQ(cores, vendorMOQDollar, currentTotalDollar, profiles, leadTimeDays, targetDOC) {
  if (currentTotalDollar >= vendorMOQDollar || vendorMOQDollar <= 0) return {};
  const gap = vendorMOQDollar - currentTotalDollar;

  const today = new Date();
  const wStart = new Date(today); wStart.setDate(wStart.getDate() + leadTimeDays);
  const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + targetDOC);
  const windowMonths = new Set();
  let cur = new Date(wStart);
  while (cur < wEnd) { windowMonths.add(cur.getMonth()); cur.setMonth(cur.getMonth() + 1); }

  const candidates = cores.filter(c => c.cost > 0 && c.dsr > 0).map(c => {
    const p = profiles[c.id] || DEFAULT_PROFILE;
    const peakMi = p.indices.indexOf(Math.max(...p.indices));
    const peakInWindow = windowMonths.has(peakMi) && p.cv > 0.15;
    let score = 0;
    if (peakInWindow && p.cv > 0.35) score += 40;
    else if (peakInWindow) score += 20;
    score += Math.min(30, Math.max(0, (p.momentum - 1) * 60));
    const docRatio = Math.min(2, (c.doc || 0) / (targetDOC || 90));
    score += Math.max(0, (1 - docRatio) * 30);
    const cp = c.casePack || 1;
    return { id: c.id, score, cost: c.cost, casePack: cp, costPerCase: c.cost * cp, peakInWindow, momentum: p.momentum, docRatio: r2(docRatio) };
  }).sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return {};
  const extra = {};
  let remaining = gap;
  let safety = 0;

  while (remaining > 0 && safety < 500) {
    safety++;
    let added = false;
    for (const c of candidates) {
      if (remaining <= 0) break;
      if (c.costPerCase > remaining * 2.5 && remaining < vendorMOQDollar * 0.05) continue;
      if (!extra[c.id]) extra[c.id] = 0;
      extra[c.id] += c.casePack;
      remaining -= c.costPerCase;
      added = true;
      break;
    }
    if (!added) {
      const cheapest = [...candidates].sort((a, b) => a.costPerCase - b.costPerCase)[0];
      if (!cheapest) break;
      if (!extra[cheapest.id]) extra[cheapest.id] = 0;
      extra[cheapest.id] += cheapest.casePack;
      remaining -= cheapest.costPerCase;
    }
  }
  return extra;
}


// ─── CALC BREAKDOWN (for modal display) ──────────────────────────
export function getCalcBreakdown(core, vendor, stg, profile, leadTimeDays, targetDOC) {
  const dsr = core.dsr || 0;
  const { indices, cv, momentum, hasHistory, monthlyDetail, yearlyTotals } = profile;
  const mw = getMomentumWeight(cv);
  const coverage = calcCoverageNeed(core, leadTimeDays, targetDOC, profile);
  const flatNeed = Math.max(0, Math.ceil(targetDOC * dsr - coverage.inventory));

  return {
    coreId: core.id, title: core.ti, vendor: core.ven,
    currentDSR: dsr, d7: core.d7 || 0, inventory: coverage.inventory,
    currentDOC: core.doc || 0, leadTime: leadTimeDays, targetDOC,
    hasHistory, cv,
    cvLabel: cv < 0.15 ? 'Flat (no seasonality)' : cv < 0.35 ? 'Mild seasonality' : 'Strong seasonality',
    momentumWeight: r2(mw), seasonalWeight: r2(1 - mw),
    momentum,
    momentumLabel: momentum > 1.1 ? 'Growing vs last year ↑' : momentum < 0.9 ? 'Declining vs last year ↓' : 'Stable vs last year →',
    yearlyTotals,
    seasonalIndices: indices.map((v, i) => ({
      month: MONTHS[i], index: v,
      interpretation: v > 1.3 ? 'Peak' : v > 1.1 ? 'Above avg' : v < 0.7 ? 'Low' : v < 0.9 ? 'Below avg' : 'Normal'
    })),
    windowStart: coverage.windowStart, windowEnd: coverage.windowEnd,
    projectedMonths: coverage.projectedMonths,
    totalProjected: coverage.totalProjected,
    need: coverage.need, flatNeed,
    difference: coverage.need - flatNeed,
    differenceLabel: coverage.need > flatNeed
      ? '+' + (coverage.need - flatNeed).toLocaleString() + ' more (seasonal/momentum adjustment)'
      : coverage.need < flatNeed
        ? (coverage.need - flatNeed).toLocaleString() + ' less (off-season/declining adjustment)'
        : 'Same as flat calculation',
    summaryText: buildSummary(core, cv, mw, momentum, coverage, flatNeed),
  };
}

function buildSummary(core, cv, mw, momentum, coverage, flatNeed) {
  const type = cv < 0.15 ? 'flat (no seasonality)' : cv < 0.35 ? 'mildly seasonal' : 'strongly seasonal';
  const momDesc = momentum > 1.1 ? `currently growing (${momentum}x vs last year)` : momentum < 0.9 ? `currently declining (${momentum}x vs last year)` : `stable vs last year (${momentum}x)`;
  const blend = `${Math.round(mw * 100)}% momentum / ${Math.round((1 - mw) * 100)}% seasonal`;
  const diff = coverage.need - flatNeed;
  const diffDesc = diff > 0 ? `${diff.toLocaleString()} more` : diff < 0 ? `${Math.abs(diff).toLocaleString()} less` : 'the same amount';
  return `${core.id} is a ${type} product (CV=${cv}), ${momDesc}. The formula gives ${blend} weight. ` +
    `Coverage window: ${coverage.windowStart} → ${coverage.windowEnd}. ` +
    `Projected demand: ${coverage.totalProjected.toLocaleString()} units − ${coverage.inventory.toLocaleString()} inventory = ${coverage.need.toLocaleString()} need. ` +
    `Old flat formula would give ${flatNeed.toLocaleString()}, so the seasonal calc recommends ${diffDesc}.`;
}


// ─── BATCH: compute profiles for all cores (pre-indexed) ─────────
export function batchProfiles(cores, coreInvHistory, coreDays) {
  const histMap = {};
  (coreInvHistory || []).forEach(h => {
    if (!histMap[h.core]) histMap[h.core] = [];
    histMap[h.core].push(h);
  });
  const dayMap = {};
  (coreDays || []).forEach(d => {
    if (!dayMap[d.core]) dayMap[d.core] = [];
    dayMap[d.core].push(d);
  });
  const map = {};
  (cores || []).forEach(c => {
    map[c.id] = calcSeasonalProfile(c.id, histMap[c.id] || [], dayMap[c.id] || []);
  });
  return map;
}

export { DEFAULT_PROFILE };
