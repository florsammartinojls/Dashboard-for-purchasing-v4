import{useState,useMemo,useCallback,useEffect,useRef}from"react";
import{BarChart,Bar,LineChart,Line,ComposedChart,XAxis,YAxis,CartesianGrid,Tooltip,Legend,ResponsiveContainer}from"recharts";

const API='https://script.google.com/macros/s/AKfycbzt83RC7YYrE59ATSs8E5g9724bMdZPwepFHXDU-mM6IJ4g719ixQDj7x6wVoYg_grk9Q/exec';
let _jid=0;
function jp(url,timeout=60000){return new Promise((res,rej)=>{const cb='__jp'+(++_jid)+'_'+Date.now();const timer=setTimeout(()=>{cl();rej(new Error('Timeout'))},timeout);const s=document.createElement('script');function cl(){clearTimeout(timer);delete window[cb];s.parentNode&&s.parentNode.removeChild(s)}window[cb]=d=>{cl();res(d)};s.src=url+(url.includes('?')?'&':'?')+'callback='+cb;s.onerror=()=>{cl();rej(new Error('Network error'))};document.head.appendChild(s)})}
function apiCall(a){return jp(API+'?action='+a+'&_t='+Date.now())}

const R=n=>n==null?"\u2014":Math.round(n).toLocaleString("en-US");
const D=n=>n==null?"\u2014":"$"+Math.round(n).toLocaleString("en-US");
const D2=n=>n==null?"\u2014":"$"+n.toLocaleString("en-US",{maximumFractionDigits:2});
const D4=n=>n==null?"":"$"+n.toFixed(4);
const P=n=>n==null?"\u2014":n.toFixed(1)+"%";
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YR_C={2023:"#8b5cf6",2024:"#3b82f6",2025:"#22c55e",2026:"#f59e0b"};
const OOS_C={2023:"#ef4444",2024:"#f87171",2025:"#fca5a5",2026:"#fecaca"};
const BLUE="#3b82f6",TEAL="#2dd4bf",GREEN="#22c55e",YELLOW="#eab308";
const TT={contentStyle:{backgroundColor:"#1f2937",border:"1px solid #374151",borderRadius:"8px"}};
const DOMESTIC=["us","usa","united states",""];
const DEC_OPTS=["","Bought","No Recommendation","Sourcing","Ignore"];
const SHIP_TO="JLS Trading Co.\nATTN: Receiving\n5301 Terminal St\nCharlotte, NC 28208";
const BILL_TO="JLS Trading Co.\nATTN: Accounts Payable\n2198 Argentum Ave\nIndian Land, SC 29707";
const JLS_CONTACT="704-345-4660 | Purchasing@JLSTradingCo.com";

function getStatus(doc,lt,buf,th){const cd=th?.critDays||lt,wd=th?.warnDays||(lt+buf);return doc<=cd?"critical":doc<=wd?"warning":"healthy"}
function calcAllIn(c){return(c.raw||0)+(c.inb||0)+(c.pp||0)+(c.jfn||0)+(c.pq||0)+(c.ji||0)+(c.fba||0)}
function calcNeedQty(c,td){return Math.ceil(Math.max(0,td*c.dsr-calcAllIn(c)))}
function calcOrderQty(nq,moq){return nq<=0?0:Math.max(nq,moq||0)}
function calcDocAfter(c,oq){return oq<=0?Math.round(c.doc):c.dsr>0?Math.round((calcAllIn(c)+oq)/c.dsr):999}
function isDom(co){return DOMESTIC.includes((co||"").toLowerCase().trim())}
function getTD(v,stg){return isDom(v?.country)?stg.domesticDoc:stg.intlDoc}
function fmtTs(ts){if(!ts)return"";try{const d=new Date(ts);return isNaN(d.getTime())?"":d.toLocaleTimeString()}catch{return""}}
function fmtEta(s){if(!s)return"";try{const p=s.split("-");if(p.length===3)return MN[parseInt(p[1])-1]+" "+parseInt(p[2])+", "+p[0];return s}catch{return s}}
function cLbl(rec){return MN[(rec.m||1)-1]+" "+String(rec.y||0).slice(2)}
function fmtDay(s){if(!s)return"";try{const p=s.split("-");return MN[parseInt(p[1])-1]+" "+parseInt(p[2])}catch{return s}}
function td(){return new Date().toISOString().split('T')[0]}
function fmtDateSlash(s){if(!s)return"";try{const p=s.split("-");return p[1]+"/"+p[2]+"/"+p[0]}catch{return s}}

function calcSeasonal(coreId,hist){
  const ms=(hist||[]).filter(h=>h.core===coreId);if(ms.length<6)return null;
  const byM={};ms.forEach(h=>{if(!byM[h.m])byM[h.m]=[];byM[h.m].push(h.avgDsr)});
  const avgByM={};Object.entries(byM).forEach(([m,vals])=>{avgByM[m]=vals.reduce((a,b)=>a+b,0)/vals.length});
  const vals=Object.values(avgByM);const mn=vals.reduce((a,b)=>a+b,0)/vals.length;
  if(mn===0)return null;const cv=Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mn,2),0)/vals.length)/mn;
  if(cv<=0.3)return null;
  const qAvg={Q1:0,Q2:0,Q3:0,Q4:0},qN={Q1:0,Q2:0,Q3:0,Q4:0};
  Object.entries(avgByM).forEach(([m,v])=>{const mi=parseInt(m);const q=mi<=3?"Q1":mi<=6?"Q2":mi<=9?"Q3":"Q4";qAvg[q]+=v;qN[q]++});
  Object.keys(qAvg).forEach(q=>{if(qN[q]>0)qAvg[q]/=qN[q]});
  return{cv:cv.toFixed(2),peak:Object.entries(qAvg).sort((a,b)=>b[1]-a[1])[0][0]};
}

// === PO GENERATION (Google Sheets format) ===
function genPO(vendor,items,poNum,buyer){
  const dt=fmtDateSlash(td());
  const addr=vendor.address||[vendor.address1,vendor.address2,vendor.city,vendor.state,vendor.zip].filter(Boolean).join(', ');
  // Build CSV mimicking Google Sheet PO layout
  let rows=[];
  rows.push(['"JLS Trading Co. Purchase Order"']);
  rows.push([]);rows.push([]);rows.push([]);
  rows.push(['Date',dt,'','Order #',poNum||'']);
  rows.push(['Buyer',buyer||'']);
  rows.push(['Contact',JLS_CONTACT]);
  rows.push([]);
  rows.push(['Seller',vendor.name]);
  rows.push(['Rep',vendor.contactName||'N/A']);
  rows.push(['Address',addr]);
  rows.push(['Email',vendor.contactEmail||'']);
  rows.push([]);
  rows.push(['Ship To','JLS Trading Co.','','Bill To','JLS Trading Co.']);
  rows.push(['','ATTN: Receiving','','','ATTN: Accounts Payable']);
  rows.push(['','5301 Terminal St','','','2198 Argentum Ave']);
  rows.push(['','Charlotte, NC 28208','','','Indian Land, SC 29707']);
  rows.push([]);
  rows.push(['Payment',vendor.payment||'']);
  rows.push([]);rows.push([]);
  const useCases=vendor.vou==='Cases';
  rows.push(['SKU','Item','',useCases?'Case(s)':'Qty','Price Per','Total']);
  let subTotal=0;
  items.forEach(i=>{
    const displayQty=useCases?Math.ceil(i.qty/(i.casePack||1)):i.qty;
    const prPer=useCases?(i.cost*(i.casePack||1)):i.cost;
    const tot=displayQty*prPer;subTotal+=tot;
    rows.push([i.vsku||i.id,`"${(i.ti||'').replace(/"/g,'""')}"`,'',""+displayQty,D4(prPer),D2(tot)]);
  });
  // Pad empty rows up to ~30
  for(let i=items.length;i<30;i++)rows.push([]);
  rows.push(['','','','','Sub-Total',D2(subTotal)]);
  const csv=rows.map(r=>r.join(',')).join('\n');
  const b=new Blob([csv],{type:'text/csv;charset=utf-8;'});const u=URL.createObjectURL(b);
  const a=document.createElement('a');a.href=u;a.download=`PO_${poNum||'draft'}_${vendor.name.replace(/[^a-zA-Z0-9]/g,'_')}_${td()}.csv`;a.click();URL.revokeObjectURL(u);
}

// === 7f RECEIVING LEDGER COPY ===
function copyTo7f(vendor,items,poNum,buyer,etaDate){
  const dt=fmtDateSlash(td());const eta=etaDate?fmtDateSlash(etaDate):'';
  // Date|Vendor|Short Title|Vendor SKU|Pieces Ordered|Cases Ordered|Core #|Name|Piece Price|Country|Terms|Expected Arrival|Order #|Comments
  const rows=items.map(i=>{
    const cases=vendor.vou==='Cases'?Math.ceil(i.qty/(i.casePack||1)):'';
    return[dt,vendor.name,i.ti||'',i.vsku||'',i.qty,cases,i.id,buyer||'',D4(i.cost),vendor.country||'',vendor.terms||'',eta,poNum||'','-'].join('\t');
  });
  navigator.clipboard.writeText(rows.join('\n'));
}

// === 7g COGS LEDGER COPY ===
function copyTo7g(vendor,items,poNum,buyer){
  const dt=fmtDateSlash(td());
  // Date|Name|Core|Pieces Bought|Total Material Price|Inbound Shipping|Tariffs|Other Costs|Note
  const rows=items.map(i=>[dt,buyer||'',i.id,i.qty,D2(i.qty*i.cost),'$0.00','$0.00','$0.00',vendor.name].join('\t'));
  navigator.clipboard.writeText(rows.join('\n'));
}

// === SHARED COMPONENTS ===
function Dot({status}){return<span className={`inline-block w-3 h-3 rounded-full ${status==="critical"?"bg-red-500 animate-pulse":status==="warning"?"bg-amber-500":"bg-emerald-500"}`}/>}
function Loader({text}){return<div className="flex items-center justify-center py-20"><div className="text-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"/><p className="text-gray-400 text-sm">{text}</p></div></div>}
function Toast({msg,onClose}){useEffect(()=>{const t=setTimeout(onClose,3000);return()=>clearTimeout(t)},[onClose]);return<div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-2"><span>{"\u2705"}</span>{msg}</div>}

function SearchSelect({value,onChange,options,placeholder}){
  const[open,setOpen]=useState(false);const[q,setQ]=useState("");const ref=useRef(null);
  useEffect(()=>{function h(e){if(ref.current&&!ref.current.contains(e.target))setOpen(false)}document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);
  const filtered=options.filter(o=>o.toLowerCase().includes(q.toLowerCase()));
  return<div ref={ref} className="relative">
    <input type="text" value={open?q:(value||"")} placeholder={placeholder||"All Vendors"}
      onFocus={()=>{setOpen(true);setQ("")}} onChange={e=>{setQ(e.target.value);setOpen(true)}}
      className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5 w-48"/>
    {open&&<div className="absolute z-40 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-auto w-48">
      <button onClick={()=>{onChange("");setOpen(false)}} className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700">All Vendors</button>
      {filtered.slice(0,30).map(o=><button key={o} onClick={()=>{onChange(o);setOpen(false);setQ("")}} className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 ${o===value?"text-blue-400":"text-gray-300"}`}>{o}</button>)}
    </div>}</div>}

function SettingsModal({s,setS,onClose}){
  const[l,setL]=useState({...s});
  return<div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}>
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e=>e.stopPropagation()}>
      <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
      <div className="space-y-4">
        <div><label className="text-sm text-gray-400 block mb-1">Buyer Initials</label><input type="text" value={l.buyer||''} onChange={e=>setL({...l,buyer:e.target.value})} placeholder="TG" className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm text-gray-400 block mb-1">Domestic DOC</label><input type="number" value={l.domesticDoc} onChange={e=>setL({...l,domesticDoc:+e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div>
          <div><label className="text-sm text-gray-400 block mb-1">Intl DOC</label><input type="number" value={l.intlDoc} onChange={e=>setL({...l,intlDoc:+e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/></div></div>
        <div><label className="text-sm text-gray-400 block mb-1">Critical</label><select value={l.critMode} onChange={e=>setL({...l,critMode:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"><option value="lt">Lead Time</option><option value="custom">Custom</option></select>{l.critMode==="custom"&&<input type="number" value={l.critDays} onChange={e=>setL({...l,critDays:+e.target.value})} className="mt-2 bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/>}</div>
        <div><label className="text-sm text-gray-400 block mb-1">Warning</label><select value={l.warnMode} onChange={e=>setL({...l,warnMode:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"><option value="ltbuf">LT+Buffer</option><option value="custom">Custom</option></select>{l.warnMode==="custom"&&<input type="number" value={l.warnDays} onChange={e=>setL({...l,warnDays:+e.target.value})} className="mt-2 bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 w-full"/>}</div>
        <div className="border-t border-gray-700 pt-4"><div className="space-y-3">
          <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Active</span><select value={l.fA} onChange={e=>setL({...l,fA:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="yes">Yes</option><option value="no">No</option><option value="all">All</option></select></div>
          <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Visible</span><select value={l.fV} onChange={e=>setL({...l,fV:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="yes">Yes</option><option value="no">No</option><option value="all">All</option></select></div>
          <div className="flex items-center justify-between"><span className="text-sm text-gray-300">Ignored</span><select value={l.fI} onChange={e=>setL({...l,fI:e.target.value})} className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-sm w-28"><option value="blank">Blank</option><option value="set">Not Blank</option><option value="all">All</option></select></div>
        </div></div></div>
      <div className="flex gap-3 mt-6"><button onClick={()=>{setS(l);onClose()}} className="flex-1 bg-blue-600 text-white rounded-lg py-2 font-medium">Save</button><button onClick={onClose} className="flex-1 bg-gray-700 text-white rounded-lg py-2 font-medium">Cancel</button></div>
    </div></div>}

// === GLOSSARY ===
const DEF_GL=[{term:"C.DSR",desc:"Composite Daily Sales Rate."},{term:"DOC",desc:"Days of Coverage = All-In / DSR."},{term:"Order Qty",desc:"max(Need, MOQ)."},{term:"Need$",desc:"Order Qty x Cost."},{term:"After DOC",desc:"(All-In + Order Qty) / DSR."},{term:"Seasonal",desc:"CV of monthly DSR > 0.3. Peak quarter shown."},{term:"7f",desc:"Receiving Ledger — tracks when inventory arrives."},{term:"7g",desc:"COGS Ledger — tracks purchase costs."}];
function GlossaryTab({gl,setGl}){const[ed,setEd]=useState(null);const[et,setEt]=useState("");const[edesc,setEdesc]=useState("");const[adding,setAdding]=useState(false);const[nt,setNt]=useState("");const[nd,setNd]=useState("");return<div className="p-4 max-w-4xl mx-auto"><div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold text-white">Glossary</h2><button onClick={()=>setAdding(true)} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg">+ Add</button></div>{adding&&<div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700 space-y-2"><input value={nt} onChange={e=>setNt(e.target.value)} placeholder="Term" className="bg-gray-900 border border-gray-600 text-white rounded px-3 py-2 w-full text-sm"/><textarea value={nd} onChange={e=>setNd(e.target.value)} placeholder="Desc" className="bg-gray-900 border border-gray-600 text-white rounded px-3 py-2 w-full text-sm" rows={2}/><div className="flex gap-2"><button onClick={()=>{if(nt.trim()){setGl([...gl,{term:nt,desc:nd}]);setNt("");setNd("");setAdding(false)}}} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded">Save</button><button onClick={()=>setAdding(false)} className="text-xs bg-gray-600 text-white px-3 py-1.5 rounded">Cancel</button></div></div>}<div className="space-y-1">{gl.map((g,i)=><div key={i} onClick={()=>{setEd(i);setEt(g.term);setEdesc(g.desc)}} className={`flex gap-4 py-3 px-4 rounded-lg cursor-pointer hover:bg-gray-800/70 ${i%2===0?"bg-gray-900/50":""}`}>{ed===i?<div className="w-full space-y-2" onClick={e=>e.stopPropagation()}><input value={et} onChange={e=>setEt(e.target.value)} className="bg-gray-900 border border-gray-600 text-blue-400 font-mono rounded px-3 py-1.5 w-full text-sm font-semibold"/><textarea value={edesc} onChange={e=>setEdesc(e.target.value)} className="bg-gray-900 border border-gray-600 text-gray-200 rounded px-3 py-1.5 w-full text-sm" rows={2}/><div className="flex gap-2"><button onClick={()=>{const u=[...gl];u[i]={term:et,desc:edesc};setGl(u);setEd(null)}} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded">Save</button><button onClick={()=>setEd(null)} className="text-xs bg-gray-600 text-white px-3 py-1.5 rounded">Cancel</button><button onClick={()=>{setGl(gl.filter((_,x)=>x!==i));setEd(null)}} className="text-xs bg-red-600/80 text-white px-3 py-1.5 rounded ml-auto">Delete</button></div></div>:<><span className="text-blue-400 font-mono font-semibold text-sm min-w-[120px] shrink-0">{g.term}</span><span className="text-gray-300 text-sm">{g.desc}</span></>}</div>)}</div></div>}

// === PURCHASING TAB ===
function PurchasingTab({data,stg,onViewCore,daily}){
  const[vm,setVm]=useState("vendor");const[sortBy,setSortBy]=useState("status");const[vf,setVf]=useState("");const[sf,setSf]=useState("");const[nf,setNf]=useState("all");const[minDoc,setMinDoc]=useState(0);
  const[ov,setOv]=useState({});const[toast,setToast]=useState(null);const[poNum,setPoNum]=useState("");const[etaDate,setEtaDate]=useState("");
  const vMap=useMemo(()=>{const m={};(data.vendors||[]).forEach(v=>m[v.name]=v);return m},[data.vendors]);
  const vendorNames=useMemo(()=>(data.vendors||[]).map(v=>v.name).sort(),[data.vendors]);
  const enriched=useMemo(()=>{
    return(data.cores||[]).filter(c=>{
      if(stg.fA==="yes"&&c.active!=="Yes")return false;if(stg.fA==="no"&&c.active==="Yes")return false;
      if(stg.fV==="yes"&&c.visible!=="Yes")return false;if(stg.fV==="no"&&c.visible==="Yes")return false;
      if(stg.fI==="blank"&&!!c.ignoreUntil)return false;if(stg.fI==="set"&&!c.ignoreUntil)return false;return true;
    }).map(c=>{
      const v=vMap[c.ven]||{};const lt=v.lt||30;const tdd=getTD(v,stg);
      const cd=stg.critMode==="custom"?stg.critDays:lt;const wd=stg.warnMode==="custom"?stg.warnDays:lt+(c.buf||14);
      const st=getStatus(c.doc,lt,c.buf,{critDays:cd,warnDays:wd});const allIn=calcAllIn(c);
      const nq=calcNeedQty(c,tdd);const oq=calcOrderQty(nq,c.moq);
      const seas=calcSeasonal(c.id,(data._coreInv||[]));
      return{...c,status:st,allIn,needQty:nq,orderQty:oq,needDollar:+(oq*c.cost).toFixed(2),docAfter:calcDocAfter(c,oq),lt,critDays:cd,warnDays:wd,targetDoc:tdd,vc:v.country||"",seas};
    }).filter(c=>{if(vf&&c.ven!==vf)return false;if(sf&&c.status!==sf)return false;if(minDoc>0&&c.doc<minDoc)return false;if(nf==="need"&&c.needQty<=0)return false;if(nf==="ok"&&c.needQty>0)return false;return true})
    .sort((a,b)=>{const so={critical:0,warning:1,healthy:2};if(sortBy==="status")return so[a.status]-so[b.status];if(sortBy==="doc")return a.doc-b.doc;if(sortBy==="dsr")return b.dsr-a.dsr;if(sortBy==="need$")return b.needDollar-a.needDollar;return 0});
  },[data,stg,vf,sf,sortBy,vMap,nf,minDoc]);
  const sc=useMemo(()=>{const c={critical:0,warning:0,healthy:0};enriched.forEach(x=>c[x.status]++);return c},[enriched]);
  const dc=(d,cd,wd)=>d<=cd?"text-red-400":d<=wd?"text-amber-400":"text-emerald-400";
  const gQ=(c)=>ov[c.id]?.qty??c.orderQty;
  const gD=(c)=>ov[c.id]?.dec??"";
  const setOvF=(id,f,v)=>setOv(p=>({...p,[id]:{...(p[id]||{}),[f]:v}}));
  const totals=useMemo(()=>{let dsr=0,allIn=0,needQ=0,orderQ=0,cost=0;enriched.forEach(c=>{dsr+=c.dsr;allIn+=c.allIn;needQ+=c.needQty;orderQ+=c.orderQty;cost+=c.needDollar});return{dsr,allIn,needQ,orderQ,cost}},[enriched]);
  const vGroups=useMemo(()=>{if(vm!=="vendor")return[];const g={};enriched.forEach(c=>{if(!g[c.ven])g[c.ven]={v:vMap[c.ven]||{name:c.ven},cores:[],d:0,q:0,nq:0};g[c.ven].cores.push(c);g[c.ven].d+=c.needDollar;g[c.ven].q+=c.orderQty;g[c.ven].nq+=c.needQty});return Object.values(g).sort((a,b)=>b.cores.filter(c=>c.status==="critical").length-a.cores.filter(c=>c.status==="critical").length)},[enriched,vm,vMap]);
  const getPO=(cores)=>cores.filter(c=>gD(c)==="Bought"&&gQ(c)>0).map(c=>({id:c.id,ti:c.ti,vsku:c.vsku,qty:gQ(c),cost:c.cost,casePack:c.casePack||1}));
  const markAllBought=(cores)=>{const u={...ov};cores.filter(c=>c.needQty>0).forEach(c=>{u[c.id]={...(u[c.id]||{}),qty:u[c.id]?.qty??c.orderQty,dec:"Bought"}});setOv(u)};
  const clearVendor=(cores)=>{const u={...ov};cores.forEach(c=>{delete u[c.id]});setOv(u)};

  return<div className="p-4">
    {toast&&<Toast msg={toast} onClose={()=>setToast(null)}/>}
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <div className="flex bg-gray-800 rounded-lg p-0.5">{["core","vendor"].map(m=><button key={m} onClick={()=>setVm(m)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${vm===m?"bg-blue-600 text-white":"text-gray-400"}`}>{m==="core"?"By Core":"By Vendor"}</button>)}</div>
      <SearchSelect value={vf} onChange={setVf} options={vendorNames} placeholder="All Vendors"/>
      <select value={sf} onChange={e=>setSf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="">All Status</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="healthy">Healthy</option></select>
      <select value={nf} onChange={e=>setNf(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="all">All</option><option value="need">Needs Purchase</option><option value="ok">No Need</option></select>
      {vm==="core"&&<select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-2 py-1.5"><option value="status">Priority</option><option value="doc">DOC low</option><option value="dsr">DSR high</option><option value="need$">Need$ high</option></select>}
      <div className="flex gap-2 ml-auto text-xs"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"/>{sc.critical}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"/>{sc.warning}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"/>{sc.healthy}</span><span className="text-gray-500">|</span><span className="text-gray-300 font-semibold">{enriched.length}</span></div></div>
    {/* TOTALS BAR */}
    <div className="flex flex-wrap gap-4 mb-4 bg-gray-900/80 rounded-xl px-4 py-3 border border-gray-800 items-center">
      <div><span className="text-gray-500 text-xs">Total DSR</span><div className="text-white font-bold">{R(totals.dsr)}</div></div>
      <div><span className="text-gray-500 text-xs">All-In</span><div className="text-white font-bold">{R(totals.allIn)}</div></div>
      <div><span className="text-gray-500 text-xs">Need Qty</span><div className="text-gray-300 font-bold">{R(totals.needQ)}</div></div>
      <div><span className="text-gray-500 text-xs">Order Qty</span><div className="text-white font-bold">{R(totals.orderQ)}</div></div>
      <div><span className="text-gray-500 text-xs">Total $</span><div className="text-amber-300 font-bold">{D(totals.cost)}</div></div>
      <div className="ml-auto flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1"><span className="text-gray-500 text-xs">PO#:</span><input type="text" value={poNum} onChange={e=>setPoNum(e.target.value)} placeholder="2637" className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1 w-20"/></div>
        <div className="flex items-center gap-1"><span className="text-gray-500 text-xs">ETA:</span><input type="date" value={etaDate} onChange={e=>setEtaDate(e.target.value)} className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1"/></div>
      </div>
    </div>
    {/* CORE VIEW */}
    {vm==="core"&&<div className="overflow-x-auto rounded-xl border border-gray-800"><table className="w-full"><thead>
      <tr className="bg-gray-900/80 text-xs text-gray-400 uppercase"><th className="py-3 px-2 w-8"/><th className="py-3 px-2 text-left">Core</th><th className="py-3 px-2 text-left">Vendor</th><th className="py-3 px-2 text-left">Title</th><th className="py-3 px-2 text-right">DSR</th><th className="py-3 px-2 text-right">7D</th><th className="py-3 px-2 text-center">T</th><th className="py-3 px-2 text-right">DOC</th><th className="py-3 px-2 text-right">All-In</th><th className="py-3 px-2 text-right">MOQ</th><th className="py-3 px-2 text-center">S</th><th className="py-3 px-1 border-l-2 border-gray-600"/><th className="py-3 px-2 text-right">Need</th><th className="py-3 px-2 text-right">Order</th><th className="py-3 px-2 text-right">Cost</th><th className="py-3 px-2 text-right">After</th><th className="py-3 px-2 w-14"/></tr>
    </thead><tbody>{enriched.map(c=><tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 text-sm">
      <td className="py-2 px-2"><Dot status={c.status}/></td><td className="py-2 px-2 text-blue-400 font-mono text-xs">{c.id}</td><td className="py-2 px-2 text-gray-400 text-xs truncate max-w-[100px]">{c.ven}</td><td className="py-2 px-2 text-gray-200 truncate max-w-[180px]">{c.ti}</td><td className="py-2 px-2 text-right">{R(c.dsr)}</td><td className="py-2 px-2 text-right">{R(c.d7)}</td>
      <td className="py-2 px-2 text-center">{c.d7>c.dsr?<span className="text-emerald-400">{"\u25B2"}</span>:c.d7<c.dsr?<span className="text-red-400">{"\u25BC"}</span>:"\u2014"}</td>
      <td className={`py-2 px-2 text-right font-semibold ${dc(c.doc,c.critDays,c.warnDays)}`}>{R(c.doc)}</td><td className="py-2 px-2 text-right">{R(c.allIn)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{c.moq>0?R(c.moq):"\u2014"}</td>
      <td className="py-2 px-2 text-center">{c.seas&&<span className="text-purple-400 text-xs font-bold">{c.seas.peak}</span>}</td>
      <td className="py-2 px-1 border-l-2 border-gray-600"/><td className="py-2 px-2 text-right text-gray-300">{c.needQty>0?R(c.needQty):"\u2014"}</td><td className="py-2 px-2 text-right text-white font-semibold">{c.orderQty>0?R(c.orderQty):"\u2014"}</td><td className="py-2 px-2 text-right text-amber-300 font-semibold">{c.needDollar>0?D(c.needDollar):"\u2014"}</td>
      <td className={`py-2 px-2 text-right ${c.orderQty>0?dc(c.docAfter,c.critDays,c.warnDays):"text-gray-500"}`}>{c.orderQty>0?R(c.docAfter):"\u2014"}</td>
      <td className="py-2 px-2"><button onClick={()=>onViewCore(c.id)} className="text-blue-400 text-xs px-2 py-1 bg-blue-400/10 rounded">View</button></td></tr>)}</tbody>
    <tfoot><tr className="bg-gray-900 border-t-2 border-gray-700 text-sm font-semibold"><td colSpan={4} className="py-3 px-2 text-gray-300">{enriched.length} cores</td><td className="py-3 px-2 text-right text-white">{R(totals.dsr)}</td><td colSpan={3}/><td className="py-3 px-2 text-right text-white">{R(totals.allIn)}</td><td colSpan={2}/><td className="border-l-2 border-gray-600"/><td className="py-3 px-2 text-right text-gray-300">{R(totals.needQ)}</td><td className="py-3 px-2 text-right text-white">{R(totals.orderQ)}</td><td className="py-3 px-2 text-right text-amber-300">{D(totals.cost)}</td><td colSpan={2}/></tr></tfoot></table></div>}
    {/* VENDOR VIEW */}
    {vm==="vendor"&&vGroups.map(grp=>{const v=grp.v;const noNeed=grp.nq===0;const tdd=getTD(v,stg);const poItems=getPO(grp.cores);const poTotal=poItems.reduce((s,i)=>s+i.qty*i.cost,0);const meets=poTotal>=(v.moqDollar||0);
      return<div key={v.name} className="mb-5 border border-gray-800 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 mb-2"><span className="text-white font-semibold">{v.name}</span>{v.country&&<span className="text-xs text-gray-500">{v.country}</span>}<span className="text-xs text-gray-400">LT:{v.lt}d</span><span className="text-xs text-gray-400">MOQ:{D(v.moqDollar)}</span><span className="text-xs text-gray-400">Target:{tdd}d</span><span className="text-xs text-gray-400">{v.payment||''}</span>
            {noNeed?<span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded text-gray-400 bg-gray-700">No Need</span>:<span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded ${meets?"text-emerald-400 bg-emerald-400/10":"text-red-400 bg-red-400/10"}`}>{meets?"\u2713 MOQ":"\u2717 "+D(poTotal)+"/"+D(v.moqDollar)}</span>}</div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={()=>markAllBought(grp.cores)} className="text-xs bg-blue-600/80 text-white px-2.5 py-1 rounded hover:bg-blue-600">Mark All "Bought"</button>
            <button onClick={()=>clearVendor(grp.cores)} className="text-xs bg-gray-700 text-gray-300 px-2.5 py-1 rounded hover:bg-gray-600">Clear</button>
            <div className="ml-auto flex gap-2">
              <button disabled={poItems.length===0} onClick={()=>{genPO(v,poItems,poNum,stg.buyer);setToast("PO downloaded for "+v.name)}} className={`text-xs px-3 py-1.5 rounded font-medium ${poItems.length?"bg-emerald-600 text-white hover:bg-emerald-500":"bg-gray-700 text-gray-500 cursor-not-allowed"}`}>{"\u2B07"} PO</button>
              <button disabled={poItems.length===0} onClick={()=>{copyTo7f(v,poItems,poNum,stg.buyer,etaDate);setToast("7f copied!")}} className={`text-xs px-3 py-1.5 rounded font-medium ${poItems.length?"bg-teal-600 text-white hover:bg-teal-500":"bg-gray-700 text-gray-500 cursor-not-allowed"}`}>7f</button>
              <button disabled={poItems.length===0} onClick={()=>{copyTo7g(v,poItems,poNum,stg.buyer);setToast("7g copied!")}} className={`text-xs px-3 py-1.5 rounded font-medium ${poItems.length?"bg-purple-600 text-white hover:bg-purple-500":"bg-gray-700 text-gray-500 cursor-not-allowed"}`}>7g</button>
            </div>
          </div>
          {poItems.length>0&&<div className="mt-2 text-xs text-emerald-400 font-semibold">{poItems.length} items — {D(poTotal)}</div>}
        </div>
        <table className="w-full"><thead><tr className="text-xs text-gray-500 uppercase bg-gray-900/40"><th className="py-2 px-2 w-8"/><th className="py-2 px-2 text-left">Core</th><th className="py-2 px-2 text-left">VSKU</th><th className="py-2 px-2 text-left">Title</th><th className="py-2 px-2 text-right">DSR</th><th className="py-2 px-2 text-right">DOC</th><th className="py-2 px-2 text-right">All-In</th><th className="py-2 px-2 text-right">Rec.</th><th className="py-2 px-1 border-l-2 border-gray-600"/><th className="py-2 px-2 text-center text-blue-400">Manual Qty</th><th className="py-2 px-2 text-center text-blue-400">Decision</th><th className="py-2 px-2 text-right">Cost</th><th className="py-2 px-2 text-right">After</th><th className="py-2 px-2 w-14"/></tr></thead>
        <tbody>{grp.cores.map(c=>{const mq=gQ(c);const md=gD(c);const mc=mq*c.cost;const mDocA=c.dsr>0?Math.round((c.allIn+mq)/c.dsr):999;
          return<tr key={c.id} className={`border-t border-gray-800/30 hover:bg-gray-800/20 text-sm ${md==="Bought"?"bg-emerald-900/10":""}`}><td className="py-2 px-2"><Dot status={c.status}/></td><td className="py-2 px-2 text-blue-400 font-mono text-xs">{c.id}</td><td className="py-2 px-2 text-gray-400 text-xs">{c.vsku||"\u2014"}</td><td className="py-2 px-2 text-gray-200 truncate max-w-[140px]">{c.ti}</td><td className="py-2 px-2 text-right">{R(c.dsr)}</td><td className={`py-2 px-2 text-right font-semibold ${dc(c.doc,c.critDays,c.warnDays)}`}>{R(c.doc)}</td><td className="py-2 px-2 text-right">{R(c.allIn)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{c.orderQty>0?R(c.orderQty):"\u2014"}</td><td className="py-2 px-1 border-l-2 border-gray-600"/>
          <td className="py-2 px-2 text-center"><input type="number" value={mq} onChange={e=>setOvF(c.id,'qty',Math.max(0,+e.target.value))} className="bg-gray-800 border border-gray-600 text-white text-sm rounded px-2 py-1 w-20 text-center"/></td>
          <td className="py-2 px-2"><select value={md} onChange={e=>setOvF(c.id,'dec',e.target.value)} className={`bg-gray-800 border text-sm rounded px-1 py-1 w-full ${md==="Bought"?"border-emerald-500 text-emerald-400":md?"border-gray-500 text-gray-300":"border-gray-700 text-gray-500"}`}>{DEC_OPTS.map(o=><option key={o} value={o}>{o||"\u2014"}</option>)}</select></td>
          <td className="py-2 px-2 text-right text-amber-300 text-xs">{mq>0?D(mc):"\u2014"}</td>
          <td className={`py-2 px-2 text-right text-xs ${mq>0?dc(mDocA,c.critDays,c.warnDays):"text-gray-500"}`}>{mq>0?R(mDocA):"\u2014"}</td>
          <td className="py-2 px-2"><button onClick={()=>onViewCore(c.id)} className="text-blue-400 text-xs px-2 py-1 bg-blue-400/10 rounded">View</button></td></tr>})}
        <tr className="bg-gray-900/60 font-semibold text-sm border-t-2 border-gray-700"><td colSpan={4} className="py-2 px-2 text-gray-300">{grp.cores.length}</td><td className="py-2 px-2 text-right text-white">{R(grp.cores.reduce((s,c)=>s+c.dsr,0))}</td><td/><td className="py-2 px-2 text-right">{R(grp.cores.reduce((s,c)=>s+c.allIn,0))}</td><td className="py-2 px-2 text-right text-gray-400">{R(grp.q)}</td><td className="border-l-2 border-gray-600"/><td className="py-2 px-2 text-center text-white">{R(grp.cores.reduce((s,c)=>s+gQ(c),0))}</td><td/><td className="py-2 px-2 text-right text-amber-300">{D(grp.cores.reduce((s,c)=>s+gQ(c)*c.cost,0))}</td><td colSpan={2}/></tr>
        </tbody></table></div>})}</div>}

// === CORE DETAIL ===
function CoreDetailTab({data,stg,hist,daily,coreId,onBack,onGoBundle}){
  const[search,setSearch]=useState("");const[sel,setSel]=useState(coreId||null);
  useEffect(()=>{if(coreId)setSel(coreId)},[coreId]);
  const core=sel?(data.cores||[]).find(c=>c.id===sel):null;
  const vendor=core?(data.vendors||[]).find(v=>v.name===core.ven):null;
  const lt=vendor?.lt||30;const tdd=getTD(vendor,stg);
  const feesMap=useMemo(()=>{const m={};(data.fees||[]).forEach(f=>m[f.j]=f);return m},[data.fees]);
  const salesMap=useMemo(()=>{const m={};(data.sales||[]).forEach(s=>m[s.j]=s);return m},[data.sales]);
  const coreHist=useMemo(()=>(hist?.coreInv||[]).filter(h=>h.core===sel),[hist,sel]);
  const years=useMemo(()=>[...new Set(coreHist.map(h=>h.y))].sort(),[coreHist]);
  const oosYears=useMemo(()=>years.filter(y=>coreHist.some(h=>h.y===y&&h.oosDays>0)),[coreHist,years]);
  const yTot=useMemo(()=>{const t={};years.forEach(y=>{const r=coreHist.filter(h=>h.y===y);t[y]=r.length?+(r.reduce((s,x)=>s+x.avgDsr,0)/r.length).toFixed(1):0});return t},[coreHist,years]);
  const dsrChart=useMemo(()=>MN.map((m,i)=>{const row={month:m};years.forEach(y=>{const h=coreHist.find(x=>x.y===y&&x.m===i+1);row["dsr_"+y]=h?.avgDsr??null;if(h?.oosDays>0)row["oos_"+y]=h.oosDays});return row}),[coreHist,years]);
  const coreBundlesAll=useMemo(()=>{if(!core)return[];const byC1=(data.bundles||[]).filter(b=>b.core1===sel);if(byC1.length>0)return byC1;const jls=(core.jlsList||"").split(/[,\n]/).filter(Boolean).map(j=>j.trim());return(data.bundles||[]).filter(b=>jls.includes(b.j))},[core,sel,data.bundles]);
  const bIds=useMemo(()=>coreBundlesAll.map(b=>b.j),[coreBundlesAll]);
  const inboundShipments=useMemo(()=>{if(!sel||!data.inbound)return[];const ids=new Set([sel,...bIds].map(x=>(x||"").trim().toLowerCase()));return data.inbound.filter(s=>ids.has((s.core||"").trim().toLowerCase()))},[data.inbound,sel,bIds]);
  const bSalesH=useMemo(()=>(hist?.bundleSales||[]).filter(h=>bIds.includes(h.j)),[hist,bIds]);
  const unitsChart=useMemo(()=>{const byMY={};bSalesH.forEach(h=>{const k=h.y+"-"+h.m;if(!byMY[k])byMY[k]={y:h.y,m:h.m,u:0};byMY[k].u+=h.units});return MN.map((m,i)=>{const row={month:m};years.forEach(y=>{const r=byMY[y+"-"+(i+1)];row["u_"+y]=r?.u??null});return row})},[bSalesH,years]);
  const allIn=core?calcAllIn(core):0;const status=core?getStatus(core.doc,lt,core.buf||14,stg):"healthy";
  const totalOos=coreHist.filter(h=>h.oosDays>0).reduce((s,h)=>s+h.oosDays,0);
  const nq=core?calcNeedQty(core,tdd):0;const oq=core?calcOrderQty(nq,core.moq):0;const da=core?calcDocAfter(core,oq):0;
  const seas=core?calcSeasonal(core.id,hist?.coreInv||[]):null;
  const pipeline=core?[{l:"Raw",v:core.raw},{l:"Inbound",v:core.inb},{l:"Pre-Proc",v:core.pp},{l:"JFN",v:core.jfn},{l:"Proc Q",v:core.pq},{l:"JI",v:core.ji},{l:"FBA",v:core.fba}]:[];
  const maxP=Math.max(...pipeline.map(p=>p.v),1);
  const[bSort,setBSort]=useState("dsr");
  const totalBDsr=useMemo(()=>coreBundlesAll.reduce((s,b)=>s+(b.cd||0),0),[coreBundlesAll]);
  const totalPortRev=useMemo(()=>(data.sales||[]).reduce((s,x)=>s+(x.ltR||0),0),[data.sales]);
  const totalPortProfit=useMemo(()=>(data.sales||[]).reduce((s,x)=>s+(x.ltP||0),0),[data.sales]);
  const coreBundles=useMemo(()=>coreBundlesAll.map(b=>({...b,fee:feesMap[b.j],sale:salesMap[b.j],pct:totalBDsr>0?+((b.cd/totalBDsr)*100).toFixed(1):0})).sort((a,b)=>{if(bSort==="dsr")return(b.cd||0)-(a.cd||0);if(bSort==="ltP")return((b.sale?.ltP||0)-(a.sale?.ltP||0));if(bSort==="ltR")return((b.sale?.ltR||0)-(a.sale?.ltR||0));return 0}),[coreBundlesAll,feesMap,salesMap,bSort,totalBDsr]);
  const etaText=useMemo(()=>inboundShipments.filter(s=>s.eta).map(s=>fmtEta(s.eta)).join(", "),[inboundShipments]);
  const coreDays=useMemo(()=>(daily?.coreDays||[]).filter(d=>d.core===sel).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10),[daily,sel]);
  const bTotals=useMemo(()=>{let dsr=0,ltR=0,ltP=0;coreBundles.forEach(b=>{dsr+=b.cd||0;if(b.sale){ltR+=b.sale.ltR||0;ltP+=b.sale.ltP||0}});return{dsr,ltR,ltP}},[coreBundles]);

  if(!core)return<div className="p-4 max-w-4xl mx-auto"><div className="flex items-center gap-3 mb-4"><button onClick={onBack} className="text-gray-400 hover:text-white text-sm">{"\u2190"} Purchasing</button><input type="text" placeholder="Search core..." value={search} onChange={e=>setSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 max-w-md text-sm"/></div>{search.length>=2?<div className="space-y-1">{(data.cores||[]).filter(c=>{const q=search.toLowerCase();return c.id.toLowerCase().includes(q)||c.ti.toLowerCase().includes(q)}).slice(0,12).map(c=><button key={c.id} onClick={()=>setSel(c.id)} className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3"><Dot status={getStatus(c.doc,(data.vendors||[]).find(v=>v.name===c.ven)?.lt||30,c.buf,stg)}/><span className="text-blue-400 font-mono text-sm">{c.id}</span><span className="text-gray-300 text-sm truncate">{c.ti}</span></button>)}</div>:<p className="text-gray-500 text-sm">Type at least 2 characters.</p>}</div>;

  return<div className="p-4 max-w-6xl mx-auto">
    <button onClick={()=>{setSel(null);onBack()}} className="text-gray-400 hover:text-white text-sm mb-4">{"\u2190"} Purchasing</button>
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
      <div className="flex flex-wrap items-center gap-3 mb-2"><span className="text-xl font-bold text-white">{core.id}</span><Dot status={status}/><span className={`text-xs px-2 py-0.5 rounded font-semibold ${status==="critical"?"bg-red-500/20 text-red-400":status==="warning"?"bg-amber-500/20 text-amber-400":"bg-emerald-500/20 text-emerald-400"}`}>{status.toUpperCase()}</span>{totalOos>0&&<span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold">OOS:{totalOos}d</span>}{!isDom(vendor?.country)&&<span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">INTL {vendor?.country}</span>}{seas&&<span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-semibold">SEASONAL {seas.peak}</span>}</div>
      <p className="text-gray-300 text-sm mb-1">{core.ti}</p>
      <p className="text-gray-500 text-xs">{core.ven} {"\u00B7"} VSKU:{core.vsku||"\u2014"} {"\u00B7"} {D2(core.cost)} {"\u00B7"} LT:{lt}d {"\u00B7"} Target:{tdd}d</p></div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
      {[{l:"C.DSR",v:R(core.dsr)},{l:"7D DSR",v:R(core.d7)},{l:"DOC",v:R(core.doc),c:core.doc<=lt?"text-red-400":core.doc<=lt+(core.buf||14)?"text-amber-400":"text-emerald-400"},{l:"All-In",v:R(allIn)},{l:"Inbound",v:R(core.inb),sub:etaText||null}].map(k=><div key={k.l} className="bg-gray-900 rounded-lg p-3 border border-gray-800"><div className="text-gray-500 text-xs mb-1">{k.l}</div><div className={`text-lg font-bold ${k.c||"text-white"}`}>{k.v}</div>{k.sub&&<div className="text-emerald-400 text-xs mt-1">ETA: {k.sub}</div>}</div>)}</div>
    {/* INBOUND SHIPMENTS */}
    {inboundShipments.length>0&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Inbound Shipments</h3><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase"><th className="py-1 px-2 text-left">Order#</th><th className="py-1 px-2 text-left">Vendor</th><th className="py-1 px-2 text-right">Pcs</th><th className="py-1 px-2 text-right">Missing</th><th className="py-1 px-2 text-right">ETA</th></tr></thead><tbody>{inboundShipments.map((s,i)=><tr key={i} className={i%2===0?"bg-gray-800/30":""}><td className="py-1.5 px-2 text-gray-300">{s.orderNum}</td><td className="py-1.5 px-2">{s.vendor}</td><td className="py-1.5 px-2 text-right text-white">{R(s.pieces)}</td><td className="py-1.5 px-2 text-right text-red-400">{s.piecesMissing>0?R(s.piecesMissing):"\u2014"}</td><td className="py-1.5 px-2 text-right text-emerald-400">{s.eta?fmtEta(s.eta):"\u2014"}</td></tr>)}</tbody></table></div></div>}
    {/* LAST 10 DAYS */}
    {coreDays.length>0&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Last {coreDays.length} Days</h3><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase"><th className="py-1 px-2 text-left">Date</th><th className="py-1 px-2 text-right">DSR</th><th className="py-1 px-2 text-right">7D</th><th className="py-1 px-2 text-right">DOC</th><th className="py-1 px-2 text-right">All-In</th><th className="py-1 px-2 text-right">FBA</th></tr></thead><tbody>{coreDays.map((d,i)=><tr key={d.date} className={i%2===0?"bg-gray-800/30":""}><td className="py-1.5 px-2 text-gray-300">{fmtDay(d.date)}</td><td className="py-1.5 px-2 text-right text-white font-semibold">{R(d.dsr)}</td><td className="py-1.5 px-2 text-right">{R(d.d7)}</td><td className={`py-1.5 px-2 text-right font-semibold ${d.doc<=lt?"text-red-400":"text-emerald-400"}`}>{R(d.doc)}</td><td className="py-1.5 px-2 text-right">{R(d.own)}</td><td className="py-1.5 px-2 text-right">{R(d.fba)}</td></tr>)}</tbody></table></div></div>}
    {coreHist.length>0&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-1">Monthly DSR (YoY)</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={dsrChart}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis yAxisId="left" tick={{fill:"#9ca3af",fontSize:11}}/>{oosYears.length>0&&<YAxis yAxisId="right" orientation="right" tick={{fill:"#ef4444",fontSize:11}}/>}<Tooltip {...TT}/><Legend formatter={v=>v.startsWith("oos_")?"OOS "+v.split("_")[1]:"DSR "+v.split("_")[1]}/>{years.map(y=><Bar key={"d"+y} yAxisId="left" dataKey={"dsr_"+y} fill={YR_C[y]||"#6b7280"} opacity={0.85} radius={[2,2,0,0]}/>)}{oosYears.map(y=><Bar key={"o"+y} yAxisId="right" dataKey={"oos_"+y} fill={OOS_C[y]} opacity={0.8} barSize={6} radius={[2,2,0,0]}/>)}</ComposedChart></ResponsiveContainer></div>
      {bSalesH.length>0&&<div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Monthly Units (YoY)</h3><ResponsiveContainer width="100%" height={260}><LineChart data={unitsChart}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/><Tooltip {...TT}/><Legend/>{years.map(y=><Line key={"u"+y} dataKey={"u_"+y} stroke={YR_C[y]||"#6b7280"} strokeWidth={2} dot={{r:3}} connectNulls name={""+y}/>)}</LineChart></ResponsiveContainer></div>}</div>}
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Pipeline</h3><div className="flex items-end gap-2 h-32">{pipeline.map((p,i)=><div key={p.l} className="flex-1 flex flex-col items-center"><span className="text-white text-xs font-semibold mb-1">{R(p.v)}</span><div className="w-full rounded-t-md" style={{height:Math.max((p.v/maxP)*80,4)+"px",backgroundColor:i===pipeline.length-1?BLUE:i===0?TEAL:"#6b7280"}}/><span className="text-gray-500 text-xs mt-1">{p.l}</span></div>)}</div></div>
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800 overflow-x-auto">
      <div className="flex items-center justify-between mb-3"><h3 className="text-white font-semibold text-sm">Bundles ({coreBundles.length})</h3><select value={bSort} onChange={e=>setBSort(e.target.value)} className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1"><option value="dsr">DSR</option><option value="ltP">LT Profit</option><option value="ltR">LT Rev</option></select></div>
      {coreBundles.length>0?<table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs uppercase"><th className="py-2 px-2 text-left">JLS</th><th className="py-2 px-2 text-left">Title</th><th className="py-2 px-2 text-right">C.DSR</th><th className="py-2 px-2 text-right">%Core</th><th className="py-2 px-2 text-right">FIB DOC</th><th className="py-2 px-1 border-l-2 border-gray-600"/><th className="py-2 px-2 text-right">Price</th><th className="py-2 px-2 text-right">GP</th><th className="py-2 px-2 text-right">LT Rev</th><th className="py-2 px-2 text-right">%Port</th><th className="py-2 px-2 text-right">LT Profit</th><th className="py-2 px-2 text-right">%Port</th><th className="py-2 px-2 w-14"/></tr></thead><tbody>{coreBundles.map(b=>{const rP=totalPortRev>0?((b.sale?.ltR||0)/totalPortRev*100):0;const pP=totalPortProfit>0?((b.sale?.ltP||0)/totalPortProfit*100):0;return<tr key={b.j} className="border-t border-gray-800/50 hover:bg-gray-800/20"><td className="py-2 px-2 text-blue-400 font-mono text-xs">{b.j}</td><td className="py-2 px-2 text-gray-200 truncate max-w-[140px]">{b.t}</td><td className="py-2 px-2 text-right">{R(b.cd)}</td><td className="py-2 px-2 text-right text-gray-300">{b.pct}%</td><td className="py-2 px-2 text-right">{R(b.fibDoc)}</td><td className="py-2 px-1 border-l-2 border-gray-600"/><td className="py-2 px-2 text-right">{b.fee?D2(b.fee.pr):"\u2014"}</td><td className="py-2 px-2 text-right text-emerald-400">{b.fee?D2(b.fee.gp):"\u2014"}</td><td className="py-2 px-2 text-right">{b.sale?D(b.sale.ltR):"\u2014"}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{rP>0?P(rP):""}</td><td className="py-2 px-2 text-right text-emerald-400">{b.sale?D(b.sale.ltP):"\u2014"}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{pP>0?P(pP):""}</td><td className="py-2 px-2"><button onClick={()=>onGoBundle(b.j)} className="text-blue-400 text-xs px-2 py-1 bg-blue-400/10 rounded">View</button></td></tr>})}
      <tr className="bg-gray-900/60 border-t-2 border-gray-700 font-semibold text-sm"><td colSpan={2} className="py-2 px-2 text-gray-300">Totals</td><td className="py-2 px-2 text-right text-white">{R(bTotals.dsr)}</td><td colSpan={2}/><td className="border-l-2 border-gray-600"/><td colSpan={2}/><td className="py-2 px-2 text-right text-white">{D(bTotals.ltR)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{totalPortRev>0?P(bTotals.ltR/totalPortRev*100):""}</td><td className="py-2 px-2 text-right text-emerald-400">{D(bTotals.ltP)}</td><td className="py-2 px-2 text-right text-gray-400 text-xs">{totalPortProfit>0?P(bTotals.ltP/totalPortProfit*100):""}</td><td/></tr>
      </tbody></table>:<p className="text-gray-500 text-sm">No bundles.</p>}</div>
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Purchase Recommendation</h3><div className="grid grid-cols-2 sm:grid-cols-5 gap-4"><div><div className="text-gray-500 text-xs">Current DOC</div><div className={`text-lg font-bold ${core.doc<=lt?"text-red-400":"text-white"}`}>{R(core.doc)}</div></div><div><div className="text-gray-500 text-xs">Need for {tdd}d</div><div className="text-lg font-bold text-gray-300">{R(nq)}</div></div><div><div className="text-gray-500 text-xs">Order (MOQ:{R(core.moq)})</div><div className="text-lg font-bold text-white">{R(oq)}</div></div><div><div className="text-gray-500 text-xs">Cost</div><div className="text-lg font-bold text-amber-300">{D(oq*core.cost)}</div></div><div><div className="text-gray-500 text-xs">After DOC</div><div className="text-lg font-bold text-emerald-400">{oq>0?R(da):"\u2014"}</div></div></div></div>
  </div>}

// === BUNDLE DETAIL ===
function BundleDetailTab({data,stg,hist,daily,bundleId,onBack,onGoCore}){
  const[search,setSearch]=useState("");const[sel,setSel]=useState(bundleId||null);
  useEffect(()=>{if(bundleId)setSel(bundleId)},[bundleId]);
  const bundle=sel?(data.bundles||[]).find(b=>b.j===sel):null;
  const fee=bundle?(data.fees||[]).find(f=>f.j===bundle.j):null;
  const sale=bundle?(data.sales||[]).find(s=>s.j===bundle.j):null;
  const core=bundle?(data.cores||[]).find(c=>c.id===bundle.core1):null;
  const salesHist=useMemo(()=>(hist?.bundleSales||[]).filter(h=>h.j===sel).sort((a,b)=>a.y===b.y?a.m-b.m:a.y-b.y),[hist,sel]);
  const priceHist=useMemo(()=>(hist?.priceHist||[]).filter(h=>h.j===sel).sort((a,b)=>a.y===b.y?a.m-b.m:a.y-b.y),[hist,sel]);
  const yoyYears=useMemo(()=>[...new Set(salesHist.map(h=>h.y))].sort(),[salesHist]);
  const revData=useMemo(()=>salesHist.map(h=>({month:cLbl(h),rev:h.rev,profit:h.profit})),[salesHist]);
  const priceData=useMemo(()=>{const pm={};priceHist.forEach(p=>{pm[p.y+"-"+p.m]=p.avgPrice});return salesHist.map(h=>({month:cLbl(h),units:h.units,price:pm[h.y+"-"+h.m]??null}))},[salesHist,priceHist]);
  const yoyData=useMemo(()=>MN.map((m,i)=>{const r={month:m};yoyYears.forEach(y=>{const rec=salesHist.find(h=>h.y===y&&h.m===i+1);r["u_"+y]=rec?.units??null});return r}),[salesHist,yoyYears]);
  const totalPortRev=useMemo(()=>(data.sales||[]).reduce((s,x)=>s+(x.ltR||0),0),[data.sales]);
  const totalPortProfit=useMemo(()=>(data.sales||[]).reduce((s,x)=>s+(x.ltP||0),0),[data.sales]);
  const bundleDays=useMemo(()=>(daily?.bundleDays||[]).filter(d=>d.j===sel).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10),[daily,sel]);

  if(!bundle)return<div className="p-4 max-w-4xl mx-auto"><div className="flex items-center gap-3 mb-4"><button onClick={onBack} className="text-gray-400 hover:text-white text-sm">{"\u2190"} Back</button><input type="text" placeholder="Search bundle..." value={search} onChange={e=>setSearch(e.target.value)} className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 flex-1 max-w-md text-sm"/></div>{search.length>=2?<div className="space-y-1">{(data.bundles||[]).filter(b=>{const q=search.toLowerCase();return b.j.toLowerCase().includes(q)||b.t.toLowerCase().includes(q)}).slice(0,12).map(b=><button key={b.j} onClick={()=>setSel(b.j)} className="w-full text-left px-4 py-2.5 rounded-lg bg-gray-900/50 hover:bg-gray-800 flex items-center gap-3"><span className="text-blue-400 font-mono text-sm">{b.j}</span><span className="text-gray-300 text-sm truncate">{b.t}</span></button>)}</div>:<p className="text-gray-500 text-sm">Type at least 2 characters.</p>}</div>;

  const pct=core?.dsr>0?((bundle.cd/core.dsr)*100).toFixed(1):"\u2014";
  return<div className="p-4 max-w-6xl mx-auto">
    <button onClick={()=>{setSel(null);onBack()}} className="text-gray-400 hover:text-white text-sm mb-4">{"\u2190"} Back</button>
    <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><div className="flex flex-wrap items-center gap-3 mb-2"><span className="text-xl font-bold text-white">{bundle.j}</span>{core&&<button onClick={()=>onGoCore(core.id)} className="text-blue-400 text-xs bg-blue-400/10 px-2 py-0.5 rounded">{"\u2192"}{core.id}</button>}</div><p className="text-gray-300 text-sm">{bundle.t}</p><p className="text-gray-500 text-xs">ASIN:{bundle.asin} {"\u00B7"} {bundle.vendors}</p></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h4 className="text-gray-500 text-xs uppercase mb-3">Sales & Inventory</h4><div className="grid grid-cols-3 gap-y-4"><div><div className="text-gray-500 text-xs">C.DSR</div><div className="text-white font-bold text-lg">{R(bundle.cd)}</div></div><div><div className="text-gray-500 text-xs">% Core</div><div className="text-white font-bold text-lg">{pct}%</div></div><div><div className="text-gray-500 text-xs">Comp DOC</div><div className="text-white font-bold text-lg">{R(bundle.doc)}</div></div><div><div className="text-gray-500 text-xs">FIB DOC</div><div className="text-white font-bold text-lg">{R(bundle.fibDoc)}</div></div><div><div className="text-gray-500 text-xs">FBA Inv</div><div className="text-white font-bold text-lg">{R(bundle.fibInv)}</div></div><div><div className="text-gray-500 text-xs">Reserved</div><div className="text-white font-bold text-lg">{R(bundle.reserved)}</div></div></div></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h4 className="text-gray-500 text-xs uppercase mb-3">Profitability</h4><div className="grid grid-cols-3 gap-y-4"><div><div className="text-gray-500 text-xs">Price</div><div className="text-white font-bold text-lg">{fee?D2(fee.pr):"\u2014"}</div></div><div><div className="text-gray-500 text-xs">COGS</div><div className="text-white font-bold text-lg">{fee?D2(fee.pdmtCogs):"\u2014"}</div></div><div><div className="text-gray-500 text-xs">AICOGS</div><div className="text-white font-bold text-lg">{fee?D2(fee.aicogs):"\u2014"}</div></div><div><div className="text-gray-500 text-xs">Total Fee</div><div className="text-white font-bold text-lg">{fee?D2(fee.totalFee):"\u2014"}</div></div><div><div className="text-gray-500 text-xs">GP</div><div className="text-emerald-400 font-bold text-lg">{fee?D2(fee.gp):"\u2014"}</div></div><div><div className="text-gray-500 text-xs">Net Rev</div><div className="text-white font-bold text-lg">{fee?D2(fee.netRev):"\u2014"}</div></div></div></div></div>
    {sale&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800 overflow-x-auto"><h3 className="text-white font-semibold text-sm mb-3">Revenue</h3><table className="w-full text-sm"><thead><tr className="text-gray-500 text-xs uppercase"><th className="py-2 text-left"/><th className="py-2 text-right">Lifetime</th><th className="py-2 text-right">%Port</th><th className="py-2 text-right">Last Year</th><th className="py-2 text-right">This Year</th><th className="py-2 text-right">YoY</th></tr></thead><tbody>
      <tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Revenue</td><td className="py-2 text-right text-white">{D(sale.ltR)}</td><td className="py-2 text-right text-gray-400 text-xs">{totalPortRev>0?P(sale.ltR/totalPortRev*100):""}</td><td className="py-2 text-right">{D(sale.lyR)}</td><td className="py-2 text-right">{D(sale.tyR)}</td><td className="py-2 text-right text-gray-300">{sale.lyR>0?(((sale.tyR-sale.lyR)/sale.lyR)*100).toFixed(0)+"%":"\u2014"}</td></tr>
      <tr className="border-t border-gray-800"><td className="py-2 text-gray-400">Profit</td><td className="py-2 text-right text-emerald-400">{D(sale.ltP)}</td><td className="py-2 text-right text-gray-400 text-xs">{totalPortProfit>0?P(sale.ltP/totalPortProfit*100):""}</td><td className="py-2 text-right text-emerald-400">{D(sale.lyP)}</td><td className="py-2 text-right text-emerald-400">{D(sale.tyP)}</td><td className="py-2 text-right text-gray-300">{sale.lyP>0?(((sale.tyP-sale.lyP)/sale.lyP)*100).toFixed(0)+"%":"\u2014"}</td></tr>
    </tbody></table></div>}
    {bundleDays.length>0&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Last {bundleDays.length} Days</h3><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-500 uppercase"><th className="py-1 px-2 text-left">Date</th><th className="py-1 px-2 text-right">DSR</th><th className="py-1 px-2 text-right">7D</th><th className="py-1 px-2 text-right">DOC</th><th className="py-1 px-2 text-right">FIB</th></tr></thead><tbody>{bundleDays.map((d,i)=><tr key={d.date} className={i%2===0?"bg-gray-800/30":""}><td className="py-1.5 px-2 text-gray-300">{fmtDay(d.date)}</td><td className="py-1.5 px-2 text-right text-white font-semibold">{R(d.dsr)}</td><td className="py-1.5 px-2 text-right">{R(d.d7)}</td><td className="py-1.5 px-2 text-right">{R(d.doc)}</td><td className="py-1.5 px-2 text-right">{R(d.fib)}</td></tr>)}</tbody></table></div></div>}
    {sale&&<div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Recent Sales</h3><div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{[{l:"This Month",u:sale.tmU,r:sale.tmR},{l:"Last Month",u:sale.lmU,r:sale.lmR},{l:"Last 7d",u:sale.l7U,r:sale.l7R},{l:"Last 28d",u:sale.l28U,r:sale.l28R}].map(p=><div key={p.l}><div className="text-gray-500 text-xs">{p.l}</div><div className="text-white font-semibold">{R(p.u)} units</div><div className="text-gray-400 text-xs">{D(p.r)}</div></div>)}</div></div>}
    {salesHist.length>0&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Price vs Units</h3><ResponsiveContainer width="100%" height={240}><ComposedChart data={priceData}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:9}} angle={-45} textAnchor="end" height={50}/><YAxis yAxisId="left" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis yAxisId="right" orientation="right" tick={{fill:"#eab308",fontSize:11}}/><Tooltip {...TT}/><Legend/><Bar yAxisId="left" dataKey="units" fill={BLUE} opacity={0.3} radius={[2,2,0,0]}/><Line yAxisId="right" dataKey="price" stroke={YELLOW} strokeWidth={2} type="stepAfter" dot={false}/></ComposedChart></ResponsiveContainer></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800"><h3 className="text-white font-semibold text-sm mb-3">Revenue & Profit</h3><ResponsiveContainer width="100%" height={240}><BarChart data={revData}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:9}} angle={-45} textAnchor="end" height={50}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/><Tooltip {...TT}/><Legend/><Bar dataKey="rev" fill={BLUE} name="Revenue" radius={[2,2,0,0]}/><Bar dataKey="profit" fill={GREEN} name="Profit" radius={[2,2,0,0]}/></BarChart></ResponsiveContainer></div>
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 lg:col-span-2"><h3 className="text-white font-semibold text-sm mb-3">YoY Units</h3><ResponsiveContainer width="100%" height={240}><LineChart data={yoyData}><CartesianGrid strokeDasharray="3 3" stroke="#374151"/><XAxis dataKey="month" tick={{fill:"#9ca3af",fontSize:11}}/><YAxis tick={{fill:"#9ca3af",fontSize:11}}/><Tooltip {...TT}/><Legend/>{yoyYears.map(y=><Line key={y} dataKey={"u_"+y} stroke={YR_C[y]||"#6b7280"} strokeWidth={2} dot={{r:3}} name={""+y} connectNulls/>)}</LineChart></ResponsiveContainer></div>
    </div>}
  </div>}

// === MAIN APP ===
const TABS=[{id:"glossary",l:"Glossary"},{id:"purchasing",l:"Purchasing"},{id:"core",l:"Core Detail"},{id:"bundle",l:"Bundle Detail"}];
export default function App(){
  const[tab,setTab]=useState("purchasing");const[showS,setShowS]=useState(false);
  const[stg,setStg]=useState({buyer:'',domesticDoc:90,intlDoc:180,critMode:"lt",critDays:30,warnMode:"ltbuf",warnDays:60,fA:"yes",fI:"blank",fV:"yes"});
  const[gl,setGl]=useState(DEF_GL);const[coreId,setCoreId]=useState(null);const[bundleId,setBundleId]=useState(null);
  const[data,setData]=useState({cores:[],bundles:[],vendors:[],sales:[],fees:[],inbound:[]});
  const[hist,setHist]=useState({bundleSales:[],coreInv:[],bundleInv:[],priceHist:[]});
  const[daily,setDaily]=useState({coreDays:[],bundleDays:[]});
  const[loading,setLoading]=useState(true);const[error,setError]=useState(null);const[ts,setTs]=useState("");const[histReady,setHistReady]=useState(false);const[dailyReady,setDailyReady]=useState(false);
  const load=useCallback(()=>{setLoading(true);setError(null);apiCall('live').then(d=>{
    setData({cores:d.cores||[],bundles:d.bundles||[],vendors:d.vendors||[],sales:d.sales||[],fees:d.fees||[],inbound:d.inbound||[]});
    setTs(d.timestamp||"");setLoading(false);
    apiCall('history').then(h=>{setHist(h);setHistReady(true)}).catch(()=>{});
    apiCall('daily').then(d=>{setDaily(d);setDailyReady(true)}).catch(()=>{setDailyReady(true)});
  }).catch(e=>{setError(e.message);setLoading(false)})},[]);
  useEffect(()=>{load()},[load]);
  const dataWithHist=useMemo(()=>({...data,_coreInv:hist.coreInv}),[data,hist]);
  const sc=useMemo(()=>{const c={critical:0,warning:0,healthy:0};(data.cores||[]).forEach(x=>{if(x.active!=="Yes")return;const v=(data.vendors||[]).find(v=>v.name===x.ven);c[getStatus(x.doc,v?.lt||30,x.buf||14,stg)]++});return c},[data,stg]);
  const goCore=useCallback(id=>{setCoreId(id);setTab("core")},[]);const goBundle=useCallback(id=>{setBundleId(id);setTab("bundle")},[]);
  if(loading)return<div className="min-h-screen bg-gray-950"><Loader text="Loading dashboard..."/></div>;
  if(error)return<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-center"><p className="text-red-400 mb-4">{error}</p><button onClick={load} className="bg-blue-600 text-white px-6 py-2 rounded-lg">Retry</button></div></div>;
  return<div className="min-h-screen bg-gray-950 text-gray-200">
    <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40"><div className="flex items-center justify-between max-w-7xl mx-auto"><div className="flex items-center gap-3"><h1 className="text-white font-bold text-lg">FBA Dashboard <span className="text-xs text-blue-400 font-normal">V2</span></h1><span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded font-medium">LIVE {"\u2014"} {data.cores.length} cores</span>{stg.buyer&&<span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{stg.buyer}</span>}{fmtTs(ts)&&<span className="text-xs text-gray-500">{fmtTs(ts)}</span>}{(!histReady||!dailyReady)&&<span className="text-xs text-yellow-500 animate-pulse">Loading...</span>}</div><div className="flex items-center gap-3"><div className="flex gap-2 text-xs"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"/>{sc.critical}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"/>{sc.warning}</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"/>{sc.healthy}</span></div><button onClick={load} className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800">{"\u21BB"}</button><button onClick={()=>setShowS(true)} className="text-gray-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-gray-800">{"\u2699\uFE0F"}</button></div></div></header>
    <nav className="bg-gray-900/50 border-b border-gray-800 px-4 sticky top-[53px] z-30"><div className="flex gap-0 max-w-7xl mx-auto overflow-x-auto">{TABS.map(t=><button key={t.id} onClick={()=>{setTab(t.id);if(t.id!=="core")setCoreId(null);if(t.id!=="bundle")setBundleId(null)}} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab===t.id?"border-blue-500 text-blue-400":"border-transparent text-gray-500 hover:text-gray-300"}`}>{t.l}</button>)}</div></nav>
    <main className="max-w-7xl mx-auto">
      {tab==="glossary"&&<GlossaryTab gl={gl} setGl={setGl}/>}
      {tab==="purchasing"&&<PurchasingTab data={dataWithHist} stg={stg} onViewCore={goCore} daily={daily}/>}
      {tab==="core"&&<CoreDetailTab data={data} stg={stg} hist={hist} daily={daily} coreId={coreId} onBack={()=>setTab("purchasing")} onGoBundle={goBundle}/>}
      {tab==="bundle"&&<BundleDetailTab data={data} stg={stg} hist={hist} daily={daily} bundleId={bundleId} onBack={()=>{if(coreId)setTab("core");else setTab("purchasing")}} onGoCore={goCore}/>}
    </main>
    {showS&&<SettingsModal s={stg} setS={setStg} onClose={()=>setShowS(false)}/>}
  </div>}
