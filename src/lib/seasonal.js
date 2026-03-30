// === SEASONAL FORECASTING ENGINE v2 ===
// 5-step demand projection: inventory at arrival, coverage need,
// last-year shape × sustained growth, purchase frequency, bundle seasonal

import { cAI } from "./utils";

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const r2 = n => Math.round(n * 100) / 100;
const r0 = n => Math.round(n);
const fmt = d => d.toISOString().split('T')[0];
const DEF = { indices: new Array(12).fill(1.0), cv: 0, momentum: 1.0, growthFactor: 1.0, hasHistory: false, monthlyDetail: [], yearlyTotals: {}, lastYearShape: new Array(12).fill(1.0) };

// ─── STEP 4: SEASONAL PROFILE (last-year shape × sustained growth) ───
export function calcSeasonalProfile(coreId, coreHistory, recentDays) {
  const ms = (coreHistory || []).filter(h => h.units > 0 || h.avgDsr > 0);
  if (ms.length < 6) return { ...DEF };

  const years = [...new Set(ms.map(m => m.y))].sort();
  const latestYear = years[years.length - 1];
  const prevYear = years.length > 1 ? years[years.length - 2] : null;

  // ── Monthly DSR by year ──
  const byYM = {};
  ms.forEach(h => {
    const dsr = h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0);
    if (dsr <= 0) return;
    const oos = h.oosDays || 0; const dd = h.dataDays || 30;
    if (dd > 0 && oos / dd >= 0.5) return; // exclude >50% OOS months
    const k = h.y + '-' + h.m;
    byYM[k] = { dsr, y: h.y, m: h.m, oos, dd };
  });

  // ── Last year shape (normalized curve) ──
  // Use most recent complete-ish year for shape
  const shapeYear = prevYear && Object.keys(byYM).filter(k => k.startsWith(prevYear + '-')).length >= 6 ? prevYear : latestYear;
  const shapeMonths = {};
  for (let m = 1; m <= 12; m++) {
    const k = shapeYear + '-' + m;
    shapeMonths[m] = byYM[k]?.dsr || 0;
  }
  const shapeVals = Object.values(shapeMonths).filter(v => v > 0);
  const shapeAvg = shapeVals.length > 0 ? shapeVals.reduce((a, b) => a + b, 0) / shapeVals.length : 1;
  const lastYearShape = new Array(12).fill(1.0);
  for (let m = 1; m <= 12; m++) {
    lastYearShape[m - 1] = shapeMonths[m] > 0 ? r2(shapeMonths[m] / shapeAvg) : 1.0;
  }

  // ── Sustained growth factor (YTD this year / same period last year) ──
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  let growthFactor = 1.0;
  if (prevYear) {
    let curYearTotal = 0, prevYearTotal = 0, monthsCompared = 0;
    for (let m = 1; m <= curM; m++) {
      const ck = curY + '-' + m;
      const pk = prevYear + '-' + m;
      if (byYM[ck] && byYM[pk]) {
        curYearTotal += byYM[ck].dsr;
        prevYearTotal += byYM[pk].dsr;
        monthsCompared++;
      }
    }
    if (prevYearTotal > 0 && monthsCompared >= 2) {
      growthFactor = Math.max(0.3, Math.min(3.0, r2(curYearTotal / prevYearTotal)));
    }
  }

  // ── Weighted indices (for backward compat / CV calc) ──
  const monthlyRaw = new Array(12).fill(null).map(() => []);
  const monthlyDetail = [];
  ms.forEach(h => {
    const dsr = h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0);
    if (dsr <= 0) return;
    const mi = h.m - 1;
    const w = h.y === latestYear ? 0.75 : (0.25 / Math.max(1, years.length - 1));
    monthlyRaw[mi].push({ dsr, weight: w, year: h.y, oosDays: h.oosDays || 0, dataDays: h.dataDays || 0 });
  });
  const monthlyAvg = monthlyRaw.map((entries, mi) => {
    const valid = entries.filter(e => e.dataDays > 0 && (e.oosDays / e.dataDays) < 0.5);
    if (valid.length === 0) return 0;
    let wS = 0, wT = 0;
    valid.forEach(e => { wS += e.dsr * e.weight; wT += e.weight });
    const avg = wT > 0 ? wS / wT : 0;
    monthlyDetail.push({ month: mi + 1, monthName: MO[mi], weightedAvg: r2(avg), entries: valid.map(e => ({ year: e.year, dsr: r2(e.dsr) })) });
    return avg;
  });
  const validAvgs = monthlyAvg.filter(v => v > 0);
  const globalAvg = validAvgs.length > 0 ? validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length : 1;
  const indices = monthlyAvg.map(v => v > 0 ? r2(v / globalAvg) : 1.0);

  // ── CV ──
  const variance = validAvgs.length > 0 ? validAvgs.reduce((a, v) => a + Math.pow(v - globalAvg, 2), 0) / validAvgs.length : 0;
  const cv = globalAvg > 0 ? r2(Math.sqrt(variance) / globalAvg) : 0;

  // ── Yearly totals ──
  const yearlyTotals = {};
  years.forEach(y => {
    yearlyTotals[y] = r0(ms.filter(h => h.y === y).reduce((s, h) => s + (h.avgDsr > 0 ? h.avgDsr : (h.units > 0 && h.dataDays > 0 ? h.units / h.dataDays : 0)), 0));
  });

  // ── Momentum (recent daily vs same period LY) ──
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

  return { indices, lastYearShape, cv, momentum, growthFactor, hasHistory: true, monthlyDetail, yearlyTotals, shapeYear };
}

// ─── BUNDLE SEASONAL PROFILE (from bundle sales history) ───
export function calcBundleSeasonalProfile(jls, bundleSales) {
  const ms = (bundleSales || []).filter(h => h.j === jls && h.units > 0);
  if (ms.length < 4) return { ...DEF };

  const years = [...new Set(ms.map(m => m.y))].sort();
  const latestYear = years[years.length - 1];
  const prevYear = years.length > 1 ? years[years.length - 2] : null;

  // Shape from previous year
  const shapeYear = prevYear && ms.filter(h => h.y === prevYear).length >= 4 ? prevYear : latestYear;
  const shapeMonths = {};
  for (let m = 1; m <= 12; m++) {
    const rec = ms.find(h => h.y === shapeYear && h.m === m);
    shapeMonths[m] = rec ? rec.units : 0;
  }
  const sv = Object.values(shapeMonths).filter(v => v > 0);
  const sa = sv.length > 0 ? sv.reduce((a, b) => a + b, 0) / sv.length : 1;
  const shape = new Array(12).fill(1.0);
  for (let m = 1; m <= 12; m++) shape[m - 1] = shapeMonths[m] > 0 ? r2(shapeMonths[m] / sa) : 1.0;

  // Growth factor
  const now = new Date(); const curY = now.getFullYear(); const curM = now.getMonth() + 1;
  let gf = 1.0;
  if (prevYear) {
    let ct = 0, pt = 0, mc = 0;
    for (let m = 1; m <= curM; m++) {
      const cr = ms.find(h => h.y === curY && h.m === m);
      const pr = ms.find(h => h.y === prevYear && h.m === m);
      if (cr && pr) { ct += cr.units; pt += pr.units; mc++ }
    }
    if (pt > 0 && mc >= 2) gf = Math.max(0.3, Math.min(3.0, r2(ct / pt)));
  }

  // CV from shape
  const cvVals = sv.length > 0 ? sv : [1];
  const cvAvg = cvVals.reduce((a, b) => a + b, 0) / cvVals.length;
  const cvVar = cvVals.reduce((a, v) => a + Math.pow(v - cvAvg, 2), 0) / cvVals.length;
  const cv = cvAvg > 0 ? r2(Math.sqrt(cvVar) / cvAvg) : 0;

  return { indices: shape, lastYearShape: shape, cv, momentum: 1.0, growthFactor: gf, hasHistory: true, monthlyDetail: [], yearlyTotals: {}, shapeYear };
}


// ─── STEP 5: PURCHASE FREQUENCY ──────────────────────────────────
export function calcPurchaseFrequency(vendorName, receivingFull) {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const vendorOrders = (receivingFull || []).filter(r => r.vendor === vendorName && r.date);
  const poDates = new Set();
  vendorOrders.forEach(r => {
    const d = new Date(r.date);
    if (!isNaN(d.getTime()) && d >= cutoff) poDates.add(r.date.substring(0, 7)); // unique months
  });
  const ordersPerYear = poDates.size;
  const dates = [...poDates].sort();
  let avgGapDays = 0;
  if (dates.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < dates.length; i++) {
      const a = new Date(dates[i - 1] + '-15');
      const b = new Date(dates[i] + '-15');
      totalGap += (b - a) / 86400000;
    }
    avgGapDays = Math.round(totalGap / (dates.length - 1));
  }

  let safetyMultiplier = 1.0;
  let label = "Normal";
  let comment = "";
  if (ordersPerYear <= 2) {
    safetyMultiplier = 1.10;
    label = "Low frequency";
    comment = "⚠ ~" + ordersPerYear + " orders/yr — consider extra cover";
  } else if (ordersPerYear <= 6) {
    safetyMultiplier = 1.05;
    label = "Normal";
  } else {
    safetyMultiplier = 1.0;
    label = "High frequency";
  }

  return { ordersPerYear, avgGapDays, safetyMultiplier, label, comment };
}


// ─── PROJECTED DSR (v2: shape × growth × safety) ────────────────
export function projectedDSR(currentDSR, monthIndex, profile, safety) {
  const shape = profile.lastYearShape?.[monthIndex] ?? 1.0;
  const gf = profile.growthFactor ?? 1.0;
  const sf = safety ?? 1.0;
  return currentDSR * shape * gf * sf;
}


// ─── PROJECT DEMAND OVER DATE RANGE ──────────────────────────────
function projectDemand(dsr, startDate, endDate, profile, safety) {
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
    const pDsr = projectedDSR(dsr, mi, profile, safety);
    const units = pDsr * days;
    total += units;
    months.push({
      month: mi + 1, year: yr, label: MO[mi] + ' ' + yr, days,
      projDsr: r2(pDsr), units: r0(units),
      shapeFactor: r2(profile.lastYearShape?.[mi] ?? 1.0),
      growthFactor: r2(profile.growthFactor ?? 1.0),
    });
    cursor = new Date(yr, mi + 1, 1);
  }
  return { total: r0(total), months };
}


// ─── STEP 1+2+3: FULL COVERAGE CALCULATION ──────────────────────
// targetDOC = total days of coverage I WANT from today (not extra after arrival)
// leadTime = used for urgency flag only (DOC < LT → urgent)
// need = projected demand over targetDOC days − current inventory
export function calcCoverageNeed(core, leadTimeDays, targetDOC, profile, purchFreq) {
  const dsr = core.dsr || 0;
  if (dsr <= 0) return { need: 0, ltConsumption: 0, inventoryAtArrival: 0, coverageNeed: 0, ltMonths: [], covMonths: [], inventory: 0, windowStart: '', windowEnd: '', arrivalDate: '' };

  const safety = purchFreq?.safetyMultiplier ?? 1.0;
  const today = new Date();
  const arrival = new Date(today); arrival.setDate(arrival.getDate() + leadTimeDays);
  const covEnd = new Date(today); covEnd.setDate(covEnd.getDate() + targetDOC);
  const inventory = cAI(core);

  // Step 1: consumption during lead time (informational — shows urgency)
  const ltProj = projectDemand(dsr, today, arrival, profile, 1.0);
  const inventoryAtArrival = inventory - ltProj.total;

  // Step 2: total coverage need = projected demand over targetDOC from TODAY
  const covProj = projectDemand(dsr, today, covEnd, profile, safety);

  // Step 3: need = what I need to have for targetDOC − what I already have
  const need = Math.max(0, Math.ceil(covProj.total - inventory));

  return {
    need,
    inventory,
    ltConsumption: ltProj.total,
    inventoryAtArrival: r0(inventoryAtArrival),
    coverageNeed: covProj.total,
    ltMonths: ltProj.months,
    covMonths: covProj.months,
    arrivalDate: fmt(arrival),
    windowStart: fmt(today),
    windowEnd: fmt(covEnd),
    safetyMultiplier: r2(safety),
    urgent: inventoryAtArrival < 0,
    shortfall: inventoryAtArrival < 0 ? Math.abs(r0(inventoryAtArrival)) : 0,
  };
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
    const gf = p.growthFactor || 1.0;
    score += Math.min(30, Math.max(0, (gf - 1) * 60));
    const docRatio = Math.min(2, (c.doc || 0) / (targetDOC || 90));
    score += Math.max(0, (1 - docRatio) * 30);
    const cp = c.casePack || 1;
    return { id: c.id, score, cost: c.cost, casePack: cp, costPerCase: c.cost * cp, peakInWindow, growthFactor: gf };
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


// ─── CALC BREAKDOWN (for modal) ──────────────────────────────────
export function getCalcBreakdown(core, vendor, stg, profile, leadTimeDays, targetDOC, purchFreq) {
  const dsr = core.dsr || 0;
  const { indices, lastYearShape, cv, momentum, growthFactor, hasHistory, monthlyDetail, yearlyTotals, shapeYear } = profile;
  const cov = calcCoverageNeed(core, leadTimeDays, targetDOC, profile, purchFreq);
  const flatNeed = Math.max(0, Math.ceil(targetDOC * dsr - cov.inventory));

  return {
    coreId: core.id, title: core.ti, vendor: core.ven,
    currentDSR: dsr, d7: core.d7 || 0, inventory: cov.inventory,
    currentDOC: core.doc || 0, leadTime: leadTimeDays, targetDOC,
    hasHistory, cv, shapeYear: shapeYear || '—',
    cvLabel: cv < 0.15 ? 'Flat (no seasonality)' : cv < 0.35 ? 'Mild seasonality' : 'Strong seasonality',
    growthFactor: r2(growthFactor),
    growthLabel: growthFactor > 1.1 ? 'Growing YTD ↑' : growthFactor < 0.9 ? 'Declining YTD ↓' : 'Stable YTD →',
    momentum, yearlyTotals,
    // Purchase frequency
    purchFreq: purchFreq || { ordersPerYear: 0, label: '—', safetyMultiplier: 1.0, comment: '' },
    // Shape indices
    seasonalShape: (lastYearShape || indices).map((v, i) => ({
      month: MO[i], shape: v,
      interpretation: v > 1.3 ? 'Peak' : v > 1.1 ? 'Above avg' : v < 0.7 ? 'Low' : v < 0.9 ? 'Below avg' : 'Normal'
    })),
    // Step 1: LT consumption
    ltConsumption: cov.ltConsumption,
    inventoryAtArrival: cov.inventoryAtArrival,
    arrivalDate: cov.arrivalDate,
    ltMonths: cov.ltMonths,
    urgent: cov.urgent,
    shortfall: cov.shortfall,
    // Step 2: Coverage
    windowStart: cov.windowStart, windowEnd: cov.windowEnd,
    covMonths: cov.covMonths,
    coverageNeed: cov.coverageNeed,
    safetyMultiplier: cov.safetyMultiplier,
    // Step 3: Final
    need: cov.need, flatNeed,
    difference: cov.need - flatNeed,
    differenceLabel: cov.need > flatNeed
      ? '+' + (cov.need - flatNeed).toLocaleString() + ' more (seasonal/growth adjustment)'
      : cov.need < flatNeed
        ? (cov.need - flatNeed).toLocaleString() + ' less (off-season/declining adjustment)'
        : 'Same as flat calculation',
    summaryText: buildSummaryV2(core, cv, growthFactor, cov, flatNeed, purchFreq),
  };
}

function buildSummaryV2(core, cv, gf, cov, flatNeed, pf) {
  const type = cv < 0.15 ? 'flat (no seasonality)' : cv < 0.35 ? 'mildly seasonal' : 'strongly seasonal';
  const gDesc = gf > 1.1 ? `growing ${Math.round((gf - 1) * 100)}% YTD` : gf < 0.9 ? `declining ${Math.round((1 - gf) * 100)}% YTD` : 'stable YTD';
  const diff = cov.need - flatNeed;
  const diffD = diff > 0 ? `${diff.toLocaleString()} more` : diff < 0 ? `${Math.abs(diff).toLocaleString()} less` : 'the same';
  const pfD = pf?.comment ? ` Purchase frequency: ${pf.label} (${pf.ordersPerYear} orders/yr, safety ×${pf.safetyMultiplier}).` : '';
  const urgD = cov.urgent ? ` ⚠ URGENT: DOC (${Math.round(cov.inventory / (core.dsr || 1))}) < Lead Time (${Math.round((new Date(cov.arrivalDate) - new Date()) / 86400000)}d) — may stockout before arrival!` : '';
  return `${core.id} is ${type} (CV=${cv}), ${gDesc}.${pfD}${urgD} ` +
    `Target: ${Math.round((new Date(cov.windowEnd) - new Date(cov.windowStart)) / 86400000)}d coverage from today (${cov.windowStart} → ${cov.windowEnd}). ` +
    `Projected demand: ${cov.coverageNeed.toLocaleString()} units. Current inventory: ${cov.inventory.toLocaleString()}. ` +
    `Need to order: ${cov.coverageNeed.toLocaleString()} − ${cov.inventory.toLocaleString()} = ${cov.need.toLocaleString()}. ` +
    `Old flat formula: ${flatNeed.toLocaleString()}, so seasonal calc recommends ${diffD}.`;
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
