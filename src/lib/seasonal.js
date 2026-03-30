// === SEASONAL FORECASTING ENGINE v3 ===
// Dampened shape projection, purchase frequency safety, bundle distribution

import { cAI } from "./utils";

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const r2 = n => Math.round(n * 100) / 100;
const r0 = n => Math.round(n);
const fmt = d => d.toISOString().split('T')[0];
const DAMP = 0.5; // 0 = flat, 1 = full seasonal, 0.5 = half adjustment
const DEF = { indices: new Array(12).fill(1.0), cv: 0, momentum: 1.0, growthFactor: 1.0, hasHistory: false, monthlyDetail: [], yearlyTotals: {}, lastYearShape: new Array(12).fill(1.0), shapeYear: '' };

// ─── SEASONAL PROFILE ────────────────────────────────────────────
export function calcSeasonalProfile(coreId, coreHistory, recentDays) {
  const ms = (coreHistory || []).filter(h => h.units > 0 || h.avgDsr > 0);
  if (ms.length < 6) return { ...DEF };

  const years = [...new Set(ms.map(m => m.y))].sort();
  const latestYear = years[years.length - 1];
  const prevYear = years.length > 1 ? years[years.length - 2] : null;

  // 1. Monthly DSR by year (for growth factor)
  const byYM = {};
  ms.forEach(h => {
    const dsr = h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0);
    if (dsr <= 0) return;
    if (h.dataDays > 0 && (h.oosDays || 0) / h.dataDays >= 0.5) return;
    byYM[h.y + '-' + h.m] = { dsr, y: h.y, m: h.m };
  });

  // 2. Weighted monthly averages (75% latest year, 25% older)
  const monthlyRaw = new Array(12).fill(null).map(() => []);
  const monthlyDetail = [];
  ms.forEach(h => {
    const dsr = h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0);
    if (dsr <= 0) return;
    if (h.dataDays > 0 && (h.oosDays || 0) / h.dataDays >= 0.5) return;
    const mi = h.m - 1;
    const w = h.y === latestYear ? 0.75 : (0.25 / Math.max(1, years.length - 1));
    monthlyRaw[mi].push({ dsr, weight: w, year: h.y });
  });

  const monthlyAvg = monthlyRaw.map((entries, mi) => {
    if (entries.length === 0) return 0;
    let wS = 0, wT = 0;
    entries.forEach(e => { wS += e.dsr * e.weight; wT += e.weight });
    const avg = wT > 0 ? wS / wT : 0;
    monthlyDetail.push({ month: mi + 1, monthName: MO[mi], weightedAvg: r2(avg), entries: entries.map(e => ({ year: e.year, dsr: r2(e.dsr) })) });
    return avg;
  });

  // 3. Global average + indices
  const validAvgs = monthlyAvg.filter(v => v > 0);
  if (validAvgs.length === 0) return { ...DEF };
  const globalAvg = validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length;
  const indices = monthlyAvg.map(v => v > 0 ? r2(v / globalAvg) : 1.0);
  const lastYearShape = indices; // multi-year weighted = more stable than single year

  // 4. CV
  const variance = validAvgs.reduce((a, v) => a + Math.pow(v - globalAvg, 2), 0) / validAvgs.length;
  const cv = globalAvg > 0 ? r2(Math.sqrt(variance) / globalAvg) : 0;

  // 5. Yearly totals
  const yearlyTotals = {};
  years.forEach(y => {
    yearlyTotals[y] = r0(ms.filter(h => h.y === y).reduce((s, h) => s + (h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0)), 0));
  });

  // 6. Growth factor (YTD blended with full-year)
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  let growthFactor = 1.0;
  if (prevYear) {
    let curYTD = 0, prevYTD = 0, ytdMonths = 0;
    for (let m = 1; m <= curM; m++) {
      const ck = curY + '-' + m, pk = prevYear + '-' + m;
      if (byYM[ck] && byYM[pk]) { curYTD += byYM[ck].dsr; prevYTD += byYM[pk].dsr; ytdMonths++ }
    }
    const ytdGrowth = prevYTD > 0 && ytdMonths >= 2 ? curYTD / prevYTD : 1.0;
    const olderYear = years.length > 2 ? years[years.length - 3] : null;
    const fyGrowth = olderYear && yearlyTotals[olderYear] > 0 ? (yearlyTotals[prevYear] || 0) / yearlyTotals[olderYear] : 1.0;
    if (ytdMonths >= 3 && olderYear) growthFactor = r2(ytdGrowth * 0.6 + fyGrowth * 0.4);
    else if (ytdMonths >= 2 && olderYear) growthFactor = r2(ytdGrowth * 0.5 + fyGrowth * 0.5);
    else growthFactor = r2(ytdGrowth);
    growthFactor = Math.max(0.3, Math.min(3.0, growthFactor));
  }

  // 7. Momentum (recent daily vs same period LY)
  let momentum = 1.0;
  const rd = recentDays || [];
  if (rd.length >= 5) {
    const recentAvg = rd.reduce((s, d) => s + (d.d1 || d.dsr || 0), 0) / rd.length;
    const lyY = latestYear === curY ? latestYear - 1 : latestYear;
    const lyData = ms.filter(h => h.y === lyY && Math.abs(h.m - curM) <= 1);
    if (lyData.length > 0) {
      const lyAvg = lyData.reduce((s, h) => s + (h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0)), 0) / lyData.length;
      if (lyAvg > 0) momentum = Math.max(0.3, Math.min(3.0, r2(recentAvg / lyAvg)));
    }
  }

  return { indices, lastYearShape, cv, momentum, growthFactor, hasHistory: true, monthlyDetail, yearlyTotals, shapeYear: years.join('+') };
}

// ─── BUNDLE SEASONAL PROFILE ─────────────────────────────────────
export function calcBundleSeasonalProfile(jls, bundleSales) {
  const ms = (bundleSales || []).filter(h => h.j === jls && h.units > 0);
  if (ms.length < 4) return { ...DEF };
  const years = [...new Set(ms.map(m => m.y))].sort();
  const latestYear = years[years.length - 1];
  const shapeMonths = {};
  for (let m = 1; m <= 12; m++) {
    const recs = ms.filter(h => h.m === m);
    if (recs.length === 0) { shapeMonths[m] = 0; continue }
    let wS = 0, wT = 0;
    recs.forEach(r => { const w = r.y === latestYear ? 0.75 : 0.25; wS += r.units * w; wT += w });
    shapeMonths[m] = wT > 0 ? wS / wT : 0;
  }
  const sv = Object.values(shapeMonths).filter(v => v > 0);
  const sa = sv.length > 0 ? sv.reduce((a, b) => a + b, 0) / sv.length : 1;
  const shape = new Array(12).fill(1.0);
  for (let m = 1; m <= 12; m++) shape[m - 1] = shapeMonths[m] > 0 ? r2(shapeMonths[m] / sa) : 1.0;
  const cvAvg = sv.length > 0 ? sv.reduce((a, b) => a + b, 0) / sv.length : 1;
  const cvVar = sv.length > 0 ? sv.reduce((a, v) => a + Math.pow(v - cvAvg, 2), 0) / sv.length : 0;
  const cv = cvAvg > 0 ? r2(Math.sqrt(cvVar) / cvAvg) : 0;
  return { indices: shape, lastYearShape: shape, cv, momentum: 1.0, growthFactor: 1.0, hasHistory: true, monthlyDetail: [], yearlyTotals: {}, shapeYear: years.join('+') };
}

// ─── PURCHASE FREQUENCY ──────────────────────────────────────────
export function calcPurchaseFrequency(vendorName, receivingFull) {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const poDates = new Set();
  (receivingFull || []).filter(r => r.vendor === vendorName && r.date).forEach(r => {
    const d = new Date(r.date);
    if (!isNaN(d.getTime()) && d >= cutoff) poDates.add(r.date.substring(0, 7));
  });
  const ordersPerYear = poDates.size;
  let safetyMultiplier = 1.0, label = "Normal", comment = "";
  if (ordersPerYear <= 2) { safetyMultiplier = 1.10; label = "Low frequency"; comment = "⚠ ~" + ordersPerYear + " orders/yr — consider extra cover" }
  else if (ordersPerYear <= 6) { safetyMultiplier = 1.05; label = "Normal" }
  else { label = "High frequency" }
  return { ordersPerYear, safetyMultiplier, label, comment };
}

// ─── PROJECTED DSR (dampened shape normalization) ────────────────
export function projectedDSR(currentDSR, monthIndex, profile, currentMonthShape, safety) {
  const shape = profile.lastYearShape?.[monthIndex] ?? 1.0;
  const rawNorm = currentMonthShape > 0 ? shape / currentMonthShape : 1.0;
  const dampedNorm = 1.0 + (rawNorm - 1.0) * DAMP;
  return currentDSR * dampedNorm * (safety ?? 1.0);
}

// ─── PROJECT DEMAND OVER DATE RANGE ──────────────────────────────
function projectDemand(dsr, startDate, endDate, profile, safety) {
  const curShape = profile.lastYearShape?.[new Date().getMonth()] ?? 1.0;
  let total = 0;
  const months = [];
  let cursor = new Date(startDate);
  while (cursor < endDate) {
    const mi = cursor.getMonth();
    const yr = cursor.getFullYear();
    const mLast = new Date(yr, mi + 1, 0);
    const effEnd = new Date(Math.min(mLast.getTime(), endDate.getTime()));
    const effStart = new Date(Math.max(cursor.getTime(), startDate.getTime()));
    const days = Math.max(1, Math.round((effEnd - effStart) / 86400000) + 1);
    const pDsr = projectedDSR(dsr, mi, profile, curShape, safety);
    const rawNorm = curShape > 0 ? (profile.lastYearShape?.[mi] ?? 1.0) / curShape : 1.0;
    const dampedNorm = 1.0 + (rawNorm - 1.0) * DAMP;
    const units = pDsr * days;
    total += units;
    months.push({ month: mi + 1, year: yr, label: MO[mi] + ' ' + yr, days, projDsr: r2(pDsr), units: r0(units), shapeFactor: r2(profile.lastYearShape?.[mi] ?? 1.0), normFactor: r2(rawNorm), dampedNorm: r2(dampedNorm) });
    cursor = new Date(yr, mi + 1, 1);
  }
  return { total: r0(total), months };
}

// ─── COVERAGE CALCULATION ────────────────────────────────────────
export function calcCoverageNeed(core, leadTimeDays, targetDOC, profile, purchFreq) {
  const dsr = core.dsr || 0;
  if (dsr <= 0) return { need: 0, ltConsumption: 0, inventoryAtArrival: 0, coverageNeed: 0, ltMonths: [], covMonths: [], inventory: 0, windowStart: '', windowEnd: '', arrivalDate: '' };
  const safety = purchFreq?.safetyMultiplier ?? 1.0;
  const today = new Date();
  const arrival = new Date(today); arrival.setDate(arrival.getDate() + leadTimeDays);
  const covEnd = new Date(today); covEnd.setDate(covEnd.getDate() + targetDOC);
  const inventory = cAI(core);
  const ltProj = projectDemand(dsr, today, arrival, profile, 1.0);
  const inventoryAtArrival = inventory - ltProj.total;
  const covProj = projectDemand(dsr, today, covEnd, profile, safety);
  const need = Math.max(0, Math.ceil(covProj.total - inventory));
  return { need, inventory, ltConsumption: ltProj.total, inventoryAtArrival: r0(inventoryAtArrival), coverageNeed: covProj.total, ltMonths: ltProj.months, covMonths: covProj.months, arrivalDate: fmt(arrival), windowStart: fmt(today), windowEnd: fmt(covEnd), safetyMultiplier: r2(safety), urgent: inventoryAtArrival < 0, shortfall: inventoryAtArrival < 0 ? Math.abs(r0(inventoryAtArrival)) : 0 };
}

// ─── FILL TO MOQ ─────────────────────────────────────────────────
export function fillToMOQ(cores, vendorMOQDollar, currentTotalDollar, profiles, leadTimeDays, targetDOC) {
  if (currentTotalDollar >= vendorMOQDollar || vendorMOQDollar <= 0) return {};
  const gap = vendorMOQDollar - currentTotalDollar;
  const today = new Date();
  const covEnd = new Date(today); covEnd.setDate(covEnd.getDate() + targetDOC);
  const windowMonths = new Set();
  let cur = new Date(today);
  while (cur < covEnd) { windowMonths.add(cur.getMonth()); cur.setMonth(cur.getMonth() + 1) }
  const candidates = cores.filter(c => c.cost > 0 && c.dsr > 0).map(c => {
    const p = profiles[c.id] || DEF;
    const peakMi = (p.lastYearShape || p.indices).indexOf(Math.max(...(p.lastYearShape || p.indices)));
    const peakInWindow = windowMonths.has(peakMi) && p.cv > 0.15;
    let score = 0;
    if (peakInWindow && p.cv > 0.35) score += 40;
    else if (peakInWindow) score += 20;
    score += Math.min(30, Math.max(0, ((p.growthFactor || 1) - 1) * 60));
    score += Math.max(0, (1 - Math.min(2, (c.doc || 0) / (targetDOC || 90))) * 30);
    const cp = c.casePack || 1;
    return { id: c.id, score, cost: c.cost, casePack: cp, costPerCase: c.cost * cp };
  }).sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return {};
  const extra = {};
  let remaining = gap, safety = 0;
  while (remaining > 0 && safety < 500) {
    safety++;
    let added = false;
    for (const c of candidates) {
      if (remaining <= 0) break;
      if (c.costPerCase > remaining * 2.5 && remaining < vendorMOQDollar * 0.05) continue;
      extra[c.id] = (extra[c.id] || 0) + c.casePack;
      remaining -= c.costPerCase; added = true; break;
    }
    if (!added) {
      const ch = [...candidates].sort((a, b) => a.costPerCase - b.costPerCase)[0];
      if (!ch) break;
      extra[ch.id] = (extra[ch.id] || 0) + ch.casePack;
      remaining -= ch.costPerCase;
    }
  }
  return extra;
}

// ─── CALC BREAKDOWN ──────────────────────────────────────────────
export function getCalcBreakdown(core, vendor, stg, profile, leadTimeDays, targetDOC, purchFreq) {
  const dsr = core.dsr || 0;
  const { indices, lastYearShape, cv, growthFactor, hasHistory, monthlyDetail, yearlyTotals, shapeYear } = profile;
  const cov = calcCoverageNeed(core, leadTimeDays, targetDOC, profile, purchFreq);
  const flatNeed = Math.max(0, Math.ceil(targetDOC * dsr - cov.inventory));
  const diff = cov.need - flatNeed;
  return {
    coreId: core.id, title: core.ti, vendor: core.ven,
    currentDSR: dsr, d7: core.d7 || 0, inventory: cov.inventory,
    currentDOC: core.doc || 0, leadTime: leadTimeDays, targetDOC,
    hasHistory, cv, shapeYear: shapeYear || '—',
    cvLabel: cv < 0.15 ? 'Flat' : cv < 0.35 ? 'Mild seasonality' : 'Strong seasonality',
    growthFactor: r2(growthFactor),
    purchFreq: purchFreq || { ordersPerYear: 0, label: '—', safetyMultiplier: 1.0, comment: '' },
    seasonalShape: (lastYearShape || indices).map((v, i) => ({
      month: MO[i], shape: v,
      interpretation: v > 1.3 ? 'Peak' : v > 1.1 ? 'Above avg' : v < 0.7 ? 'Low' : v < 0.9 ? 'Below avg' : 'Normal'
    })),
    yearlyTotals,
    ltConsumption: cov.ltConsumption, inventoryAtArrival: cov.inventoryAtArrival,
    arrivalDate: cov.arrivalDate, ltMonths: cov.ltMonths,
    urgent: cov.urgent, shortfall: cov.shortfall,
    windowStart: cov.windowStart, windowEnd: cov.windowEnd,
    covMonths: cov.covMonths, coverageNeed: cov.coverageNeed,
    safetyMultiplier: cov.safetyMultiplier,
    need: cov.need, flatNeed, difference: diff,
    differenceLabel: diff > 0 ? '+' + diff.toLocaleString() + ' more (seasonal adjustment)' : diff < 0 ? diff.toLocaleString() + ' less (off-season adjustment)' : 'Same as flat',
    summaryText: `${core.id} is ${cv < 0.15 ? 'flat' : cv < 0.35 ? 'mildly seasonal' : 'strongly seasonal'} (CV=${cv}).${purchFreq?.comment ? ' ' + purchFreq.comment : ''}${cov.urgent ? ' ⚠ URGENT: DOC < Lead Time!' : ''} Formula: projectedDSR = currentDSR × damped(shape/now, 50%) × safety. Target: ${targetDOC}d (${cov.windowStart} → ${cov.windowEnd}). Projected: ${cov.coverageNeed.toLocaleString()} − inventory ${cov.inventory.toLocaleString()} = ${cov.need.toLocaleString()} to order. Flat formula: ${flatNeed.toLocaleString()}, seasonal recommends ${diff > 0 ? diff.toLocaleString() + ' more' : diff < 0 ? Math.abs(diff).toLocaleString() + ' less' : 'same'}.`,
  };
}

// ─── BATCH PROFILES ──────────────────────────────────────────────
export function batchProfiles(cores, coreInvHistory, coreDays) {
  const histMap = {}, dayMap = {};
  (coreInvHistory || []).forEach(h => { if (!histMap[h.core]) histMap[h.core] = []; histMap[h.core].push(h) });
  (coreDays || []).forEach(d => { if (!dayMap[d.core]) dayMap[d.core] = []; dayMap[d.core].push(d) });
  const map = {};
  (cores || []).forEach(c => { map[c.id] = calcSeasonalProfile(c.id, histMap[c.id] || [], dayMap[c.id] || []) });
  return map;
}

export function batchBundleProfiles(bundles, bundleSales) {
  const map = {};
  (bundles || []).forEach(b => { map[b.j] = calcBundleSeasonalProfile(b.j, bundleSales) });
  return map;
}

export { DEF as DEFAULT_PROFILE };
