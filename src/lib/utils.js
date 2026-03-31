// === FORMATTERS ===
export const R = n => n == null ? "\u2014" : Math.round(n).toLocaleString("en-US");
export const D1 = n => n == null || n === 0 ? "\u2014" : n >= 10 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1);
export const $ = n => n == null ? "\u2014" : "$" + Math.round(n).toLocaleString("en-US");
export const $2 = n => n == null ? "\u2014" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const $4 = n => "$" + n.toFixed(4);
export const P = n => n == null ? "\u2014" : n.toFixed(1) + "%";

export const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const YC = { 2024: "#3b82f6", 2025: "#22c55e", 2026: "#f59e0b" };
export const BL = "#3b82f6", TL = "#2dd4bf";
export const TTP = { contentStyle: { backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" } };
export const DOM = ["us", "usa", "united states", ""];
export const JC = "704-345-4660 | Purchasing@JLSTradingCo.com";

// === STATUS ===
export const gS = (d, lt, buf, th) => {
  const c = th?.critDays || lt, w = th?.warnDays || (lt + buf);
  return d <= c ? "critical" : d <= w ? "warning" : "healthy";
};
export const dc = (d, c, w) => d <= c ? "text-red-400" : d <= w ? "text-amber-400" : "text-emerald-400";
export const dotCls = s => s === "critical" ? "bg-red-500 animate-pulse" : s === "warning" ? "bg-amber-500" : "bg-emerald-500";
export const statusLabel = s => s === "critical" ? "bg-red-500/20 text-red-400" : s === "warning" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400";

// === CORE CALCS ===
export const cAI = c => (c.raw || 0) + (c.inb || 0) + (c.pp || 0) + (c.jfn || 0) + (c.pq || 0) + (c.ji || 0) + (c.fba || 0);

// Spike detection: if 7D DSR is 25%+ higher than DSR, use 7D DSR
export const effectiveDSR = c => {
  if (c.d7 > 0 && c.dsr > 0 && c.d7 >= c.dsr * 1.25) return c.d7;
  return c.dsr;
};

// Round up to next multiple of case pack
export const roundToCasePack = (qty, casePack) => {
  if (!casePack || casePack <= 1) return qty;
  return Math.ceil(qty / casePack) * casePack;
};

// Core need qty with spike detection + case pack rounding
export const cNQ = (c, td, casePack) => {
  const dsr = effectiveDSR(c);
  const raw = Math.ceil(Math.max(0, td * dsr - cAI(c)));
  return raw;
};

// Order qty: round up to MOQ, then to case pack
export const cOQ = (nq, moq, casePack) => {
  if (nq <= 0) return 0;
  let oq = Math.max(nq, moq || 0);
  return roundToCasePack(oq, casePack);
};

export const cDA = (c, oq) => oq <= 0 ? Math.round(c.doc) : c.dsr > 0 ? Math.round((cAI(c) + oq) / c.dsr) : 999;

// Bundle need qty (for bundle-only or mix mode)
export const bNQ = (b, td) => {
  const dsr = b.cd || 0;
  const inv = b.fibInv || 0;
  return Math.ceil(Math.max(0, td * dsr - inv));
};

export const isD = co => DOM.includes((co || "").toLowerCase().trim());
export const gTD = (v, s) => isD(v?.country) ? s.domesticDoc : s.intlDoc;

// === DATE FORMATTERS ===
export const fTs = ts => { if (!ts) return ""; try { const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleTimeString() } catch { return "" } };
export const fE = s => { if (!s) return ""; try { const p = s.split("-"); return p.length === 3 ? MN[parseInt(p[1]) - 1] + " " + parseInt(p[2]) + ", " + p[0] : s } catch { return s } };
export const fD = s => { if (!s) return ""; try { const p = s.split("-"); return MN[parseInt(p[1]) - 1] + " " + parseInt(p[2]) } catch { return s } };
export const td = () => new Date().toISOString().split('T')[0];
export const fSl = s => { if (!s) return ""; try { const p = s.split("-"); return p[1] + "/" + p[2] + "/" + p[0] } catch { return s } };
// MM/YY format for LastPO
export const fMY = s => { if (!s) return ""; try { const p = s.split("-"); return p[1] + "/" + p[0].slice(2) } catch { return s } };
// Force MM/DD/YYYY for date inputs
export const fDateUS = s => { if (!s) return ""; try { const p = s.split("-"); return p[1] + "/" + p[2] + "/" + p[0] } catch { return s } };
export const cMo = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 } };
export const gY = h => [...new Set(h.map(x => x.y))].filter(y => y >= 2024).sort();

// === SEASONALITY ===
export function cSeas(id, h) {
  const ms = (h || []).filter(x => x.core === id);
  if (ms.length < 6) return null;
  const byM = {};
  ms.forEach(x => { if (!byM[x.m]) byM[x.m] = []; byM[x.m].push(x.avgDsr) });
  const aM = {};
  Object.entries(byM).forEach(([m, v]) => { aM[m] = v.reduce((a, b) => a + b, 0) / v.length });
  const vs = Object.values(aM);
  const mn = vs.reduce((a, b) => a + b, 0) / vs.length;
  if (mn === 0) return null;
  const cv = Math.sqrt(vs.reduce((a, b) => a + Math.pow(b - mn, 2), 0) / vs.length) / mn;
  if (cv <= 0.3) return null;
  const qA = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }, qN = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  Object.entries(aM).forEach(([m, v]) => { const mi = parseInt(m); const q = mi <= 3 ? "Q1" : mi <= 6 ? "Q2" : mi <= 9 ? "Q3" : "Q4"; qA[q] += v; qN[q]++ });
  Object.keys(qA).forEach(q => { if (qN[q] > 0) qA[q] /= qN[q] });
  return { cv: cv.toFixed(2), peak: Object.entries(qA).sort((a, b) => b[1] - a[1])[0][0] };
}

// === PO / RFQ / CLIPBOARD ===
export function genPO(v, items, po, buyer, dt) {
  const addr = v.address || [v.address1, v.address2, v.city, v.state, v.zip].filter(Boolean).join(', ');
  const uc = v.vou === 'Cases';
  let rows = '', sub = 0;
  items.forEach(i => {
    const dq = uc && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : i.qty;
    const pp = uc && i.isCoreItem ? (i.cost * (i.cp || 1)) : i.cost;
    const t = dq * pp; sub += t;
    rows += `<tr><td>${i.vsku || i.id}</td><td>${i.ti || ''}</td><td style="text-align:right">${dq}</td><td style="text-align:right">$${pp.toFixed(2)}</td><td style="text-align:right">$${t.toFixed(2)}</td></tr>`;
  });
  for (let i = items.length; i < 20; i++) rows += '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
  const h = `<!DOCTYPE html><html><head><title>PO ${po || ''}</title><style>body{font-family:Arial,sans-serif;margin:40px;font-size:12px}h1{font-size:20px;margin:0 0 30px}table.i{width:100%;margin-bottom:10px}table.i td{padding:2px 8px;vertical-align:top}table.t{width:100%;border-collapse:collapse;margin-top:20px}table.t th,table.t td{border:1px solid #999;padding:6px 8px}table.t th{background:#f0f0f0;text-align:left}.a{display:flex;gap:40px}.a div{flex:1}@media print{body{margin:20px}}</style></head><body><h1>JLS Trading Co. Purchase Order</h1><table class="i"><tr><td><b>Date:</b> ${fSl(dt || td())}</td><td><b>Order #:</b> ${po || ''}</td></tr><tr><td><b>Buyer:</b> ${buyer || ''}</td></tr><tr><td><b>Contact:</b> ${JC}</td></tr></table><table class="i"><tr><td><b>Seller:</b> ${v.name}</td></tr><tr><td><b>Rep:</b> ${v.contactName || 'N/A'}</td></tr><tr><td><b>Address:</b> ${addr}</td></tr><tr><td><b>Email:</b> ${v.contactEmail || ''}</td></tr></table><div class="a"><div><b>Ship To</b><br>JLS Trading Co.<br>ATTN: Receiving<br>5301 Terminal St<br>Charlotte, NC 28208</div><div><b>Bill To</b><br>JLS Trading Co.<br>ATTN: Accounts Payable<br>2198 Argentum Ave<br>Indian Land, SC 29707</div></div><table class="i"><tr><td><b>Payment:</b> ${v.payment || ''}</td></tr></table><table class="t"><thead><tr><th>SKU</th><th>Item</th><th style="text-align:right">${uc ? 'Cases' : 'Qty'}</th><th style="text-align:right">Price Per</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}<tr style="font-weight:bold"><td colspan="4" style="text-align:right">Sub-Total</td><td style="text-align:right">$${sub.toFixed(2)}</td></tr></tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`;
  const w = window.open('', '_blank'); w.document.write(h); w.document.close();
}

// genRFQ — ahora recibe poNum como 5to parámetro y lo muestra en el documento
export function genRFQ(v, items, buyer, dt, poNum) {
  const addr = v.address || [v.address1, v.address2, v.city, v.state, v.zip].filter(Boolean).join(', ');
  const uc = v.vou === 'Cases';
  let rows = '';
  items.forEach(i => {
    const dq = uc && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : i.qty;
    rows += `<tr><td>${i.vsku || i.id}</td><td>${i.ti || ''}</td><td style="text-align:right">${dq}</td></tr>`;
  });
  for (let i = items.length; i < 20; i++) rows += '<tr><td>&nbsp;</td><td></td><td></td></tr>';
  const h = `<!DOCTYPE html><html><head><title>RFQ ${poNum || ''} - ${v.name}</title><style>body{font-family:Arial,sans-serif;margin:40px;font-size:12px}h1{font-size:20px;margin:0 0 30px}table.i{width:100%;margin-bottom:10px}table.i td{padding:2px 8px;vertical-align:top}table.t{width:100%;border-collapse:collapse;margin-top:20px}table.t th,table.t td{border:1px solid #999;padding:6px 8px}table.t th{background:#f0f0f0;text-align:left}@media print{body{margin:20px}}</style></head><body><h1>JLS Trading Co. — Request for Quote</h1><table class="i"><tr><td><b>Date:</b> ${fSl(dt || td())}</td><td><b>Reference #:</b> ${poNum || ''}</td></tr><tr><td><b>Buyer:</b> ${buyer || ''}</td></tr><tr><td><b>Contact:</b> ${JC}</td></tr></table><table class="i"><tr><td><b>Vendor:</b> ${v.name}</td></tr><tr><td><b>Rep:</b> ${v.contactName || 'N/A'}</td></tr><tr><td><b>Email:</b> ${v.contactEmail || ''}</td></tr></table><table class="t"><thead><tr><th>SKU</th><th>Item</th><th style="text-align:right">${uc ? 'Cases' : 'Qty'}</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:30px"><b>Please provide pricing and lead time for the above items.</b></p><script>window.onload=function(){window.print()}<\/script></body></html>`;
  const w = window.open('', '_blank'); w.document.write(h); w.document.close();
}
export function cp7f(v, it, po, b, eta) {
  const d = fSl(td()); const e = eta ? fSl(eta) : '';
  const r = it.map(i => {
    const cs = v.vou === 'Cases' && i.isCoreItem ? Math.ceil(i.qty / (i.cp || 1)) : '';
    return [d, v.name, i.ti || '', i.vsku || '', i.qty, cs, i.id, b || '', $4(i.cost), v.country || '', v.terms || '', e, po || '', '-'].join('\t');
  });
  navigator.clipboard.writeText(r.join('\n'));
}

export function cp7g(v, it, po, b) {
  const d = fSl(td());
  const r = it.map(i => [d, b || '', i.id, i.qty, $2(i.qty * i.cost), i.inbS ? '$' + i.inbS.toFixed(2) : '$0.00', '$0.00', '$0.00', v.name].join('\t'));
  navigator.clipboard.writeText(r.join('\n'));
}

// === GLOBAL CSS: hide spinner arrows ===
if (typeof document !== 'undefined') {
  const st = document.createElement('style');
  st.textContent = 'input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}';
  document.head.appendChild(st);
}
