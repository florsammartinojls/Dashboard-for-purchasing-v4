import{useState,useMemo,useCallback,useEffect,useRef}from"react";
import{BarChart,Bar,LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,Legend,ResponsiveContainer}from"recharts";

const API='https://script.google.com/macros/s/AKfycbzt83RC7YYrE59ATSs8E5g9724bMdZPwepFHXDU-mM6IJ4g719ixQDj7x6wVoYg_grk9Q/exec';
let _jid=0;
function jp(u,t=90000){return new Promise((rs,rj)=>{const cb='__jp'+(++_jid)+'_'+Date.now();const tm=setTimeout(()=>{cl();rj(new Error('Timeout'))},t);const s=document.createElement('script');function cl(){clearTimeout(tm);delete window[cb];s.parentNode&&s.parentNode.removeChild(s)}window[cb]=d=>{cl();rs(d)};s.src=u+(u.includes('?')?'&':'?')+'callback='+cb;s.onerror=()=>{cl();rj(new Error('Network'))};document.head.appendChild(s)})}
function api(a){return jp(API+'?action='+a+'&_t='+Date.now())}
const R=n=>n==null?"\u2014":Math.round(n).toLocaleString("en-US");
const $=n=>n==null?"\u2014":"$"+Math.round(n).toLocaleString("en-US");
const $2=n=>n==null?"\u2014":"$"+n.toLocaleString("en-US",{maximumFractionDigits:2});
const $4=n=>"$"+n.toFixed(4);
const P=n=>n==null?"\u2014":n.toFixed(1)+"%";
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YC={2024:"#3b82f6",2025:"#22c55e",2026:"#f59e0b"};
const BL="#3b82f6",TL="#2dd4bf",GR="#22c55e";
const TTP={contentStyle:{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}};
const DOM=["us","usa","united states",""];
const JC="704-345-4660 | Purchasing@JLSTradingCo.com";
const gS=(d,lt,buf,th)=>{const c=th?.critDays||lt,w=th?.warnDays||(lt+buf);return d<=c?"critical":d<=w?"warning":"healthy"};
const cAI=c=>(c.raw||0)+(c.inb||0)+(c.pp||0)+(c.jfn||0)+(c.pq||0)+(c.ji||0)+(c.fba||0);
const cNQ=(c,td)=>Math.ceil(Math.max(0,td*c.dsr-cAI(c)));
const cOQ=(nq,moq)=>nq<=0?0:Math.max(nq,moq||0);
const cDA=(c,oq)=>oq<=0?Math.round(c.doc):c.dsr>0?Math.round((cAI(c)+oq)/c.dsr):999;
const isD=co=>DOM.includes((co||"").toLowerCase().trim());
const gTD=(v,s)=>isD(v?.country)?s.domesticDoc:s.intlDoc;
const fTs=ts=>{if(!ts)return"";try{const d=new Date(ts);return isNaN(d.getTime())?"":d.toLocaleTimeString()}catch{return""}};
const fE=s=>{if(!s)return"";try{const p=s.split("-");return p.length===3?MN[parseInt(p[1])-1]+" "+parseInt(p[2])+", "+p[0]:s}catch{return s}};
const fD=s=>{if(!s)return"";try{const p=s.split("-");return MN[parseInt(p[1])-1]+" "+parseInt(p[2])}catch{return s}};
const td=()=>new Date().toISOString().split('T')[0];
const fSl=s=>{if(!s)return"";try{const p=s.split("-");return p[1]+"/"+p[2]+"/"+p[0]}catch{return s}};
const cMo=()=>{const d=new Date();return{y:d.getFullYear(),m:d.getMonth()+1}};
const dc=(d,c,w)=>d<=c?"text-red-400":d<=w?"text-amber-400":"text-emerald-400";
const gY=h=>[...new Set(h.map(x=>x.y))].filter(y=>y>=2024).sort();

function cSeas(id,h){const ms=(h||[]).filter(x=>x.core===id);if(ms.length<6)return null;const byM={};ms.forEach(x=>{if(!byM[x.m])byM[x.m]=[];byM[x.m].push(x.avgDsr)});const aM={};Object.entries(byM).forEach(([m,v])=>{aM[m]=v.reduce((a,b)=>a+b,0)/v.length});const vs=Object.values(aM);const mn=vs.reduce((a,b)=>a+b,0)/vs.length;if(mn===0)return null;const cv=Math.sqrt(vs.reduce((a,b)=>a+Math.pow(b-mn,2),0)/vs.length)/mn;if(cv<=0.3)return null;const qA={Q1:0,Q2:0,Q3:0,Q4:0},qN={Q1:0,Q2:0,Q3:0,Q4:0};Object.entries(aM).forEach(([m,v])=>{const mi=parseInt(m);const q=mi<=3?"Q1":mi<=6?"Q2":mi<=9?"Q3":"Q4";qA[q]+=v;qN[q]++});Object.keys(qA).forEach(q=>{if(qN[q]>0)qA[q]/=qN[q]});return{cv:cv.toFixed(2),peak:Object.entries(qA).sort((a,b)=>b[1]-a[1])[0][0]}}

// PO PDF
function genPO(v,items,po,buyer,dt){const addr=v.address||[v.address1,v.address2,v.city,v.state,v.zip].filter(Boolean).join(', ');const uc=v.vou==='Cases';let rows='',sub=0;items.forEach(i=>{const dq=uc?Math.ceil(i.qty/(i.cp||1)):i.qty;const pp=uc?(i.cost*(i.cp||1)):i.cost;const t=dq*pp;sub+=t;rows+=`<tr><td>${i.vsku||i.id}</td><td>${i.ti||''}</td><td style="text-align:right">${dq}</td><td style="text-align:right">$${pp.toFixed(2)}</td><td style="text-align:right">$${t.toFixed(2)}</td></tr>`});for(let i=items.length;i<20;i++)rows+='<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';const h=`<!DOCTYPE html><html><head><title>PO ${po||''}</title><style>body{font-family:Arial,sans-serif;margin:40px;font-size:12px}h1{font-size:20px;margin:0 0 30px}table.i{width:100%;margin-bottom:10px}table.i td{padding:2px 8px;vertical-align:top}table.t{width:100%;border-collapse:collapse;margin-top:20px}table.t th,table.t td{border:1px solid #999;padding:6px 8px}table.t th{background:#f0f0f0;text-align:left}.a{display:flex;gap:40px}.a div{flex:1}@media print{body{margin:20px}}</style></head><body><h1>JLS Trading Co. Purchase Order</h1><table class="i"><tr><td><b>Date:</b> ${fSl(dt||td())}</td><td><b>Order #:</b> ${po||''}</td></tr><tr><td><b>Buyer:</b> ${buyer||''}</td></tr><tr><td><b>Contact:</b> ${JC}</td></tr></table><table class="i"><tr><td><b>Seller:</b> ${v.name}</td></tr><tr><td><b>Rep:</b> ${v.contactName||'N/A'}</td></tr><tr><td><b>Address:</b> ${addr}</td></tr><tr><td><b>Email:</b> ${v.contactEmail||''}</td></tr></table><div class="a"><div><b>Ship To</b><br>JLS Trading Co.<br>ATTN: Receiving<br>5301 Terminal St<br>Charlotte, NC 28208</div><div><b>Bill To</b><br>JLS Trading Co.<br>ATTN: Accounts Payable<br>2198 Argentum Ave<br>Indian Land, SC 29707</div></div><table class="i"><tr><td><b>Payment:</b> ${v.payment||''}</td></tr></table><table class="t"><thead><tr><th>SKU</th><th>Item</th><th style="text-align:right">${uc?'Cases':'Qty'}</th><th style="text-align:right">Price Per</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}<tr style="font-weight:bold"><td colspan="4" style="text-align:right">Sub-Total</td><td style="text-align:right">$${sub.toFixed(2)}</td></tr></tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`;const w=window.open('','_blank');w.document.write(h);w.document.close()}

// RFQ PDF (no price/total columns)
function genRFQ(v,items,buyer,dt){const addr=v.address||[v.address1,v.address2,v.city,v.state,v.zip].filter(Boolean).join(', ');const uc=v.vou==='Cases';let rows='';items.forEach(i=>{const dq=uc?Math.ceil(i.qty/(i.cp||1)):i.qty;rows+=`<tr><td>${i.vsku||i.id}</td><td>${i.ti||''}</td><td style="text-align:right">${dq}</td></tr>`});for(let i=items.length;i<20;i++)rows+='<tr><td>&nbsp;</td><td></td><td></td></tr>';const h=`<!DOCTYPE html><html><head><title>RFQ - ${v.name}</title><style>body{font-family:Arial,sans-serif;margin:40px;font-size:12px}h1{font-size:20px;margin:0 0 30px}table.i{width:100%;margin-bottom:10px}table.i td{padding:2px 8px;vertical-align:top}table.t{width:100%;border-collapse:collapse;margin-top:20px}table.t th,table.t td{border:1px solid #999;padding:6px 8px}table.t th{background:#f0f0f0;text-align:left}.a{display:flex;gap:40px}.a div{flex:1}@media print{body{margin:20px}}</style></head><body><h1>JLS Trading Co. — Request for Quote</h1><table class="i"><tr><td><b>Date:</b> ${fSl(dt||td())}</td></tr><tr><td><b>Buyer:</b> ${buyer||''}</td></tr><tr><td><b>Contact:</b> ${JC}</td></tr></table><table class="i"><tr><td><b>Vendor:</b> ${v.name}</td></tr><tr><td><b>Rep:</b> ${v.contactName||'N/A'}</td></tr><tr><td><b>Email:</b> ${v.contactEmail||''}</td></tr></table><table class="t"><thead><tr><th>SKU</th><th>Item</th><th style="text-align:right">${uc?'Cases':'Qty'}</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:30px"><b>Please provide pricing and lead time for the above items.</b></p><script>window.onload=function(){window.print()}<\/script></body></html>`;const w=window.open('','_blank');w.document.write(h);w.document.close()}

function cp7f(v,it,po,b,eta){const d=fSl(td());const e=eta?fSl(eta):'';const r=it.map(i=>{const cs=v.vou==='Cases'?Math.ceil(i.qty/(i.cp||1)):'';return[d,v.name,i.ti||'',i.vsku||'',i.qty,cs,i.id,b||'',$4(i.cost),v.country||'',v.terms||'',e,po||'','-'].join('\t')});navigator.clipboard.writeText(r.join('\n'))}
function cp7g(v,it,po,b){const d=fSl(td());const r=it.map(i=>[d,b||'',i.id,i.qty,$2(i.qty*i.cost),i.inbS?'$'+i.inbS.toFixed(2):'$0.00','$0.00','$0.00',v.name].join('\t'));navigator.clipboard.writeText(r.join('\n'))}

// Components
function Dot({status}){return<span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${status==="critical"?"bg-red-500 animate-pulse":status==="warning"?"bg-amber-500":"bg-emerald-500"}`}/>}
function Loader({text}){return<div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"/><p className="text-gray-400 text-sm">{text}</p></div></div>}
function Toast({msg,onClose}){useEffect(()=>{const t=setTimeout(onClose,2500);return()=>clearTimeout(t)},[onClose]);return<div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50">✅ {msg}</div>}
function SS({value,onChange,options,placeholder}){const[o,setO]=useState(false);const[q,setQ]=useState("");const ref=useRef(null);useEffect(()=>{function h(e){if(ref.current&&!ref.current.contains(e.target))setO(false)}document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);const f=options.filter(x=>x.toLowerCase().includes(q.toLowerCase()));return<div ref={ref} className="relative"><input type="text" value={o?q:(value||"")} placeholder={placeholder||"All Vendors"} onFocus={()=>{setO(true);setQ("")}} onChange={e=>{setQ(e.target.value);setO(true)}} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5 w-48"/>{o&&<div className="absolute z-40 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-80 overflow-auto w-56"><button onClick={()=>{onChange("");setO(false)}} className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700">All</button>{f.map(x=><button key={x} onClick={()=>{onChange(x);setO(false);setQ("")}} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 ${x===value?"text-blue-400":"text-gray-300"}`}>{x}</button>)}</div>}</div>}
function Stg({s,setS,onClose}){const[l,setL]=useState({...s});return<div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}><div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e=>e.stopPropagation()}><h2 className="text-lg font-semibold text-white mb-4">Settings</h2><div className="space-y-4"><div><label className="text-sm text-gray-400 block mb-1">Buyer Initials</label><input type="text" value={l.buyer||''} onChange={e=>setL({...l,buyer:e.target.value})} placeholder="TG" className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div><div className="grid grid-cols-2 gap-3"><div><label className="text-sm text-gray-400 block mb-1">Domestic DOC</label><input type="number" value={l.domesticDoc} onChange={e=>setL({...l,domesticDoc:+e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div><div><label className="text-sm text-gray-400 block mb-1">Intl DOC</label><input type="number" value={l.intlDoc} onChange={e=>setL({...l,intlDoc:+e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div></div><div className="border-t border-gray-700 pt-4 space-y-3">{[["Active","fA"],["Visible","fV"]].map(([lb,k])=><div key={k} className="flex items-center justify-between"><span className="text-sm text-gray-300">{lb}</span><select value={l[k]} onChange={e=>setL({...l,[k]:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="yes">Yes</option><option value="no">No</option><option value="all">All</option></select></div>)}<div className="flex items-center justify-between"><span className="text-sm text-gray-300">Ignored</span><select value={l.fI} onChange={e=>setL({...l,fI:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="blank">Blank</option><option value="set">Set</option><option value="all">All</option></select></div></div></div><div className="flex gap-3 mt-6"><button onClick={()=>{setS(l);onClose()}} className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium">Save</button><button onClick={onClose} className="flex-1 bg-gray-700 text-white rounded-lg py-2 font-medium">Cancel</button></div></div></div>}

// Restocker expandable row
function RestockRow({rs}){
  const[open,setOpen]=useState(false);
  if(!rs||rs.length===0)return null;
  const r=rs[0]; // primary restocker row for this core
  return<>{open&&<tr className="bg-gray-800/60"><td colSpan={21} className="px-4 py-3"><div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2 text-xs">
    <div><span className="text-gray-500">Low Bundle TDOC:</span> <span className="text-white font-semibold">{R(r.lowBundleTdoc)}</span></div>
    <div><span className="text-gray-500">Low PFIBDOC:</span> <span className="text-white font-semibold">{R(r.lowPfibDoc)}</span></div>
    <div><span className="text-gray-500">Raw Pcs DOC:</span> <span className="text-white font-semibold">{R(r.rawPcsDoc)}</span></div>
    <div><span className="text-gray-500">Vendor Calc DSR:</span> <span className="text-white font-semibold">{R(r.vendorCalcDsr)}</span></div>
    <div><span className="text-gray-500">Core DSR Restock:</span> <span className="text-white font-semibold">{R(r.coreDsrRestock)}</span></div>
    <div><span className="text-gray-500">FIB Pieces:</span> <span className="text-white font-semibold">{R(r.fibPcs)}</span></div>
    <div><span className="text-gray-500">Raw Pieces:</span> <span className="text-white font-semibold">{R(r.rawPcs)}</span></div>
    <div><span className="text-gray-500">PPRC Avail:</span> <span className="text-white font-semibold">{R(r.pprcAvail)}</span></div>
    <div><span className="text-gray-500">JFN Pieces:</span> <span className="text-white font-semibold">{R(r.jfnPcs)}</span></div>
    <div><span className="text-gray-500">Inbound Pcs:</span> <span className="text-white font-semibold">{R(r.inbPcs)}</span></div>
    <div><span className="text-gray-500">Total Used:</span> <span className="text-white font-semibold">{R(r.totalCoresUsed)}</span></div>
    <div><span className="text-gray-500">Final Remain:</span> <span className="text-white font-semibold">{R(r.finalCoreRemain)}</span></div>
    <div><span className="text-gray-500">Pcs to Order:</span> <span className="text-amber-300 font-semibold">{R(r.pcsToOrder)}</span></div>
    <div><span className="text-gray-500">Final Pcs Order:</span> <span className="text-amber-300 font-semibold">{R(r.finalPcsToOrder)}</span></div>
    <div><span className="text-gray-500">Cases to Order:</span> <span className="text-amber-300 font-semibold">{R(r.casesToOrder)}</span></div>
    <div><span className="text-gray-500">MOQ:</span> <span className="text-white font-semibold">{R(r.moq)}</span></div>
    <div><span className="text-gray-500">Case Pack:</span> <span className="text-white font-semibold">{R(r.casePack)}</span></div>
    <div><span className="text-gray-500">DSR Restock:</span> <span className="text-white font-semibold">{R(r.dsrRestock)}</span></div>
  </div></td></tr>}</>
}

// Purchasing Tab
function PurchTab({data,stg,goCore,goBundle,ov,setOv,initV,clearIV}){
  const[vm,setVm]=useState(initV?"vendor":"core");const[sort,setSort]=useState("status");const[vf,setVf]=useState(initV||"");const[sf,setSf]=useState("");const[nf,setNf]=useState("all");const[minD,setMinD]=useState(0);const[locF,setLocF]=useState("all");
  const[toast,setToast]=useState(null);const[poN,setPoN]=useState("");const[poD,setPoD]=useState("");
  const[vendorSub,setVendorSub]=useState("cores"); // cores|bundles|mix
  const[expanded,setExpanded]=useState({}); // restocker expand state
  useEffect(()=>{if(initV){setVm("vendor");setVf(initV);clearIV()}},[initV,clearIV]);
  const vMap=useMemo(()=>{const m={};(data.vendors||[]).forEach(v=>m[v.name]=v);return m},[data.vendors]);
  const vNames=useMemo(()=>(data.vendors||[]).map(v=>v.name).sort(),[data.vendors]);
  const rsMap=useMemo(()=>{const m={};(data.restock||[]).forEach(r=>{if(!m[r.core])m[r.core]=[];m[r.core].push(r)});return m},[data.restock]);
  const feMap=useMemo(()=>{const m={};(data.fees||[]).forEach(f=>m[f.j]=f);return m},[data.fees]);
  const saMap=useMemo(()=>{const m={};(data.sales||[]).forEach(s=>m[s.j]=s);return m},[data.sales]);
  const togExp=id=>setExpanded(p=>({...p,[id]:!p[id]}));

  const enr=useMemo(()=>(data.cores||[]).filter(c=>{
    if(stg.fA==="yes"&&c.active!=="Yes")return false;if(stg.fA==="no"&&c.active==="Yes")return false;
    if(stg.fV==="yes"&&c.visible!=="Yes")return false;if(stg.fV==="no"&&c.visible==="Yes")return false;
    if(stg.fI==="blank"&&!!c.ignoreUntil)return false;if(stg.fI==="set"&&!c.ignoreUntil)return false;return true;
  }).map(c=>{const v=vMap[c.ven]||{};const lt=v.lt||30;const tg=gTD(v,stg);const cd=lt;const wd=lt+(c.buf||14);const st=gS(c.doc,lt,c.buf,{critDays:cd,warnDays:wd});const ai=cAI(c);const nq=cNQ(c,tg);const oq=cOQ(nq,c.moq);const seas=cSeas(c.id,(data._coreInv||[]));
    return{...c,status:st,allIn:ai,needQty:nq,orderQty:oq,needDollar:+(oq*c.cost).toFixed(2),docAfter:cDA(c,oq),lt,critDays:cd,warnDays:wd,targetDoc:tg,vc:v.country||"",seas,isDom:isD(v.country)};
  }).filter(c=>{if(vf&&c.ven!==vf)return false;if(sf&&c.status!==sf)return false;if(minD>0&&c.doc<minD)return false;if(nf==="need"&&c.needQty<=0)return false;if(nf==="ok"&&c.needQty>0)return false;if(locF==="us"&&!c.isDom)return false;if(locF==="intl"&&c.isDom)return false;return true})
  .sort((a,b)=>{const so={critical:0,warning:1,healthy:2};if(sort==="status")return so[a.status]-so[b.status];if(sort==="doc")return a.doc-b.doc;if(sort==="dsr")return b.dsr-a.dsr;if(sort==="need$")return b.needDollar-a.needDollar;return 0}),[data,stg,vf,sf,sort,vMap,nf,minD,locF]);

  // Bundles enriched for vendor view
  const venBundles=useMemo(()=>(data.bundles||[]).filter(b=>{
    if(b.active!=="Yes")return false;
    if(vf&&(b.vendors||"").indexOf(vf)<0)return false;
    return true;
  }).map(b=>{const f=feMap[b.j];const s=saMap[b.j];const margin=f&&f.pr>0?((f.gp/f.pr)*100):0;return{...b,fee:f,sale:s,margin}}),[data.bundles,vf,feMap,saMap]);

  const sc=useMemo(()=>{const c={critical:0,warning:0,healthy:0};enr.forEach(x=>c[x.status]++);return c},[enr]);
  const gO=id=>ov[id]||{};const setF=(id,f,v)=>setOv(p=>({...p,[id]:{...(p[id]||{}),[f]:v}}));
  const gPcs=c=>gO(c.id).pcs??0;const gCas=c=>gO(c.id).cas??0;const gInbS=c=>gO(c.id).inbS??0;const gCogP=c=>gO(c.id).cogP??0;const gCogC=c=>gO(c.id).cogC??0;
  const hasPO=c=>(gPcs(c)>0||gCas(c)>0);const effQ=c=>gPcs(c)||gCas(c)*(c.casePack||1);
  const aftD=c=>{const q=effQ(c);return q>0&&c.dsr>0?Math.round((c.allIn+q)/c.dsr):null};
  const tot=useMemo(()=>{let d=0,a=0,n=0,o=0,co=0;enr.forEach(c=>{d+=c.dsr;a+=c.allIn;n+=c.needQty;o+=c.orderQty;co+=c.needDollar});return{d,a,n,o,co}},[enr]);
  const vG=useMemo(()=>{if(vm!=="vendor")return[];const g={};enr.forEach(c=>{if(!g[c.ven])g[c.ven]={v:vMap[c.ven]||{name:c.ven},cores:[],bundles:[]};g[c.ven].cores.push(c)});// attach bundles per vendor
    Object.keys(g).forEach(vn=>{g[vn].bundles=venBundles.filter(b=>(b.vendors||"").indexOf(vn)>=0)});
    return Object.values(g).sort((a,b)=>b.cores.filter(c=>c.status==="critical").length-a.cores.filter(c=>c.status==="critical").length)},[enr,vm,vMap,venBundles]);
  const getPOI=cores=>cores.filter(c=>hasPO(c)).map(c=>({id:c.id,ti:c.ti,vsku:c.vsku,qty:effQ(c),cost:c.cost,cp:c.casePack||1,inbS:gInbS(c)}));
  const fillR=cores=>{const u={...ov};cores.filter(c=>c.needQty>0).forEach(c=>{u[c.id]={...(u[c.id]||{}),pcs:cOQ(c.needQty,c.moq)}});setOv(u)};
  const clrV=cores=>{const u={...ov};cores.forEach(c=>{delete u[c.id]});setOv(u)};

  // Core row for vendor view (shared between cores-only and mix)
  const CoreRow=({c})=>{const p=gPcs(c);const ca=gCas(c);const t=effQ(c)*c.cost;const ad=aftD(c);const hasRS=!!rsMap[c.id];
    return<><tr className={`border-t border-gray-800/30 hover:bg-gray-800/20 ${hasPO(c)?"bg-emerald-900/10":""}`}><td className="py-1 px-1"><Dot status={c.status}/></td><td className="py-1 px-1 text-blue-400 font-mono">{c.id}</td><td className="py-1 px-1 text-gray-400">{c.vsku||"—"}</td><td className="py-1 px-1 text-gray-200 truncate max-w-[110px]">{c.ti}</td><td className="py-1 px-1 text-right">{R(c.dsr)}</td><td className="py-1 px-1 text-right">{R(c.d7)}</td><td className="py-1 px-1 text-center">{c.d7>c.dsr?<span className="text-emerald-400">▲</span>:c.d7<c.dsr?<span className="text-red-400">▼</span>:"—"}</td><td className={`py-1 px-1 text-right font-semibold ${dc(c.doc,c.critDays,c.warnDays)}`}>{R(c.doc)}</td><td className="py-1 px-1 text-right">{R(c.allIn)}</td><td className="py-1 px-1 text-right text-gray-400">{c.moq>0?R(c.moq):"—"}</td><td className="py-1 px-1 text-center">{c.seas&&<span className="text-purple-400 font-bold">{c.seas.peak}</span>}</td><td className="py-1 px-1 text-right text-gray-400">{c.orderQty>0?R(c.orderQty):"—"}</td><td className="py-1 border-l-2 border-gray-600 px-1"/>
      <td className="py-0.5 px-0.5"><input type="number" value={p||''} onChange={e=>setF(c.id,'pcs',Math.max(0,+e.target.value||0))} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center"/></td>
      <td className="py-0.5 px-0.5"><input type="number" value={ca||''} onChange={e=>setF(c.id,'cas',Math.max(0,+e.target.value||0))} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center"/></td>
      <td className="py-0.5 px-0.5"><input type="number" value={gInbS(c)||''} onChange={e=>setF(c.id,'inbS',Math.max(0,+e.target.value||0))} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center"/></td>
      <td className="py-0.5 px-0.5"><input type="number" value={gCogP(c)||''} onChange={e=>setF(c.id,'cogP',Math.max(0,+e.target.value||0))} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center"/></td>
      <td className="py-0.5 px-0.5"><input type="number" value={gCogC(c)||''} onChange={e=>setF(c.id,'cogC',Math.max(0,+e.target.value||0))} placeholder="0" className="bg-gray-800 border border-gray-600 text-white rounded px-1 py-0.5 w-14 text-center"/></td>
      <td className="py-1 px-1 text-right text-amber-300">{t>0?$(t):"—"}</td><td className={`py-1 px-1 text-right ${ad?dc(ad,c.critDays,c.warnDays):"text-gray-500"}`}>{ad?R(ad):"—"}</td>
      <td className="py-1 px-1 flex gap-1">{hasRS&&<button onClick={()=>togExp(c.id)} className={`text-xs px-1 py-0.5 rounded ${expanded[c.id]?"bg-purple-500/30 text-purple-300":"bg-gray-700 text-gray-400"}`}>R</button>}<button onClick={()=>goCore(c.id)} className="text-blue-400 text-xs px-1 py-0.5 bg-blue-400/10 rounded">V</button></td></tr>
      {expanded[c.id]&&<RestockRow rs={rsMap[c.id]}/>}</>};

  // Bundle row for vendor view
  const BundleRow=({b,indent})=>{const f=b.fee;const s=b.sale;
    return<tr className={`border-t border-gray-800/20 hover:bg-gray-800/10 ${indent?"bg-indigo-900/5":""}`}>
      <td className="py-1 px-1"/><td className="py-1 px-1 text-indigo-400 font-mono text-xs">{indent?"└ ":""}{b.j}</td><td className="py-1 px-1 text-gray-400 text-xs">{b.asin||"—"}</td><td className="py-1 px-1 text-gray-200 truncate max-w-[110px]">{b.t}</td>
      <td className="py-1 px-1 text-right">{R(b.cd)}</td><td className="py-1 px-1 text-right">{R(b.d7comp)}</td><td className="py-1 px-1 text-center">{b.d7comp>b.cd?<span className="text-emerald-400">▲</span>:b.d7comp<b.cd?<span className="text-red-400">▼</span>:"—"}</td>
      <td className="py-1 px-1 text-right">{R(b.fibDoc)}</td><td className="py-1 px-1 text-right">{R(b.fibInv)}</td>
      <td className="py-1 px-1 text-right text-emerald-400 text-xs">{f?$2(f.gp):"—"}</td>
      <td className="py-1 px-1 text-right text-xs">{f?$2(f.aicogs):"—"}</td>
      <td className="py-1 px-1 text-right text-xs">{b.margin>0?P(b.margin):"—"}</td>
      <td className="py-1 border-l-2 border-gray-600 px-1"/>
      <td className="py-1 px-1 text-right text-xs">{R(b.scInv)}</td>
      <td className="py-1 px-1 text-right text-xs">{R(b.reserved)}</td>
      <td colSpan={3}/>
      <td className="py-1 px-1 text-right text-xs">{b.replenTag||"—"}</td>
      <td className="py-1 px-1 text-right text-xs">{R(b.doc)}</td>
      <td className="py-1 px-1"><button onClick={()=>goBundle(b.j)} className="text-indigo-400 text-xs px-1 py-0.5 bg-indigo-400/10 rounded">V</button></td>
    </tr>};

  const CoreTHead=()=><tr className="text-gray-500 uppercase bg-gray-900/40"><th className="py-2 px-1 w-6"/><th className="py-2 px-1 text-left">Core</th><th className="py-2 px-1 text-left">VSKU</th><th className="py-2 px-1 text-left">Title</th><th className="py-2 px-1 text-right">DSR</th><th className="py-2 px-1 text-right">7D</th><th className="py-2 px-1 text-center">T</th><th className="py-2 px-1 text-right">DOC</th><th className="py-2 px-1 text-right">All-In</th><th className="py-2 px-1 text-right">MOQ</th><th className="py-2 px-1 text-center">S</th><th className="py-2 px-1 text-right">Rec</th><th className="py-2 border-l-2 border-gray-600 px-1"/><th className="py-2 px-1 text-center">Pcs</th><th className="py-2 px-1 text-center">Cas</th><th className="py-2 px-1 text-center">InbS</th><th className="py-2 px-1 text-center">CogP</th><th className="py-2 px-1 text-center">CogC</th><th className="py-2 px-1 text-right">Cost</th><th className="py-2 px-1 text-right">After</th><th className="py-2 px-1 w-12"/></tr>;

  const BundleTHead=()=><tr className="text-gray-500 uppercase bg-gray-900/40"><th className="py-2 px-1 w-6"/><th className="py-2 px-1 text-left">JLS</th><th className="py-2 px-1 text-left">ASIN</th><th className="py-2 px-1 text-left">Title</th><th className="py-2 px-1 text-right">C.DSR</th><th className="py-2 px-1 text-right">7D</th><th className="py-2 px-1 text-center">T</th><th className="py-2 px-1 text-right">FIB DOC</th><th className="py-2 px-1 text-right">FIB Inv</th><th className="py-2 px-1 text-right">GP</th><th className="py-2 px-1 text-right">AICOGS</th><th className="py-2 px-1 text-right">Margin</th><th className="py-2 border-l-2 border-gray-600 px-1"/><th className="py-2 px-1 text-right">SC Inv</th><th className="py-2 px-1 text-right">Res</th><th colSpan={3}/><th className="py-2 px-1 text-right">Replen</th><th className="py-2 px-1 text-right">C.DOC</th><th className="py-2 px-1 w-8"/></tr>;

  return<div className="p-4">{toast&&<Toast msg={toast} onClose={()=>setToast(null)}/>}
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <div className="flex bg-gray-800 rounded-lg p-0.5">{["core","vendor"].map(m=><button key={m} onClick={()=>setVm(m)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm===m?"bg-blue-600 text-white":"text-gray-400"}`}>{m==="core"?"By Core":"By Vendor"}</button>)}</div>
      <SS value={vf} onChange={setVf} options={vNames}/>
      <select value={sf} onChange={e=>setSf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="">All Status</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>
      <select value={locF} onChange={e=>setLocF(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="us">US Only</option><option value="intl">International</option></select>
      <select value={nf} onChange={e=>setNf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="need">Needs Buy</option><option value="ok">No Need</option></select>
      {vm==="core"&&<><select value={sort} onChange={e=>setSort(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="status">Priority</option><option value="doc">DOC</option><option value="dsr">DSR</option><option value="need$">$</option></select><span className="text-gray-500 text-xs">Min:</span><input type="number" value={minD} onChange={e=>setMinD(+e.target.value)} className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1 w-14"/></>}
      {vm==="vendor"&&<div className="flex bg-gray-800 rounded-lg p-0.5">{[["cores","Cores"],["bundles","Bundles"],["mix","Mix"]].map(([k,l])=><button key={k} onClick={()=>setVendorSub(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${vendorSub===k?"bg-indigo-600 text-white":"text-gray-400"}`}>{l}</button>)}</div>}
      <div className="flex gap-2 ml-auto text-xs"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"/>{sc.critical}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"/>{sc.warning}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"/>{sc.healthy}</span><span className="text-gray-500">|</span><span className="text-gray-300 font-semibold">{enr.length}</span></div></div>
    {vm==="vendor"&&<div className="flex flex-wrap gap-3 mb-4 items-center text-sm"><span className="text-gray-500 text-xs">PO#:</span><input type="text" value={poN} onChange={e=>setPoN(e.target.value)} placeholder="2637" className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 w-20 text-sm"/><span className="text-gray-500 text-xs">Date:</span><input type="date" value={poD} onChange={e=>setPoD(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-sm"/><span className="text-gray-500 text-xs">Buyer:</span><span className="text-white font-semibold">{stg.buyer||<span className="text-red-400">Set in ⚙️</span>}</span></div>}
    {vm==="core"&&<div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead><tr className="bg-gray-900/80 text-xs text-gray-400 uppercase"><th className="py-3 px-2 w-8"/><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left">Vendor</th><th className="py-3 px-2 text-left">Title</th><th className="py-3 px-2 text-right">DSR</th><th className="py-3 px-2 text-right">7D</th><th className="py-3 px-2 text-center">T</th><th className="py-3 px-2 text-right">DOC</th><th className="py-3 px-2 text-right">All-In</th><th className="py-3 px-2 text-right">MOQ</th><th className="py-3 px-2 text-center">S</th><th className="py-3 px-1 border-l-2 border-gray-600"/><th classNa
