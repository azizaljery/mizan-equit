'use client';
// Home-page market overview: index prices and a descriptive analysis for the Saudi and US markets (RTL).
import {useEffect,useState} from 'react';
import type {MarketOverview,IndexAnalysis} from '@/lib/market-overview';

const fmt=(v:number|null|undefined,d=2)=>v===null||v===undefined?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=(v:number|null|undefined)=>v===null||v===undefined?'—':(v>0?'+':'')+v.toFixed(2)+'%';
const tone=(v:number|null|undefined)=>v===null||v===undefined||v===0?undefined:v>0?'#13734f':'#a33a35';
const time=(iso:string|null)=>{if(!iso)return '—';try{return new Date(iso).toLocaleString('ar-SA-u-nu-latn',{timeZone:'Asia/Riyadh',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch{return iso.slice(0,16);}};

function IndexCard({x}:{x:IndexAnalysis}){
 return <div className="metric" style={{minWidth:0}}>
  <div className="title">{x.name}</div>
  <div className="value" dir="ltr">{fmt(x.price)}</div>
  <div dir="ltr" style={{textAlign:'right',color:tone(x.changePct),fontWeight:600}}>{x.change!==null?(x.change>0?'+':'')+fmt(x.change):'—'} ({pct(x.changePct)})</div>
  <div className="hint">نطاق اليوم: <span dir="ltr">{fmt(x.dayLow)} – {fmt(x.dayHigh)}</span></div>
  <div className="hint">آخر تحديث: {time(x.asOf)} · <a href={x.source} target="_blank" rel="noopener noreferrer">المصدر</a></div>
 </div>;
}

function Analysis({x,title}:{x:IndexAnalysis;title:string}){
 const rows:[string,React.ReactNode][]=[
  ['أسبوع',<span key="w" style={{color:tone(x.returns.w1)}}>{pct(x.returns.w1)}</span>],
  ['شهر',<span key="m" style={{color:tone(x.returns.m1)}}>{pct(x.returns.m1)}</span>],
  ['3 أشهر',<span key="q" style={{color:tone(x.returns.m3)}}>{pct(x.returns.m3)}</span>],
  ['منذ بداية السنة',<span key="y" style={{color:tone(x.returns.ytd)}}>{pct(x.returns.ytd)}</span>],
  ['سنة',<span key="a" style={{color:tone(x.returns.y1)}}>{pct(x.returns.y1)}</span>],
  ['متوسط 50 جلسة',<>{fmt(x.ma50)} {x.aboveMa50===null?'':x.aboveMa50?'(السعر فوقه)':'(السعر تحته)'}</>],
  ['متوسط 200 جلسة',<>{fmt(x.ma200)} {x.aboveMa200===null?'':x.aboveMa200?'(السعر فوقه)':'(السعر تحته)'}</>],
  ['القوة النسبية RSI (14)',fmt(x.rsi14,1)],
  ['التذبذب السنوي (20 جلسة)',x.vol20===null?'—':x.vol20.toFixed(1)+'%'],
  ['أعلى / أدنى 52 أسبوعًا',<span key="h" dir="ltr">{fmt(x.low52)} – {fmt(x.high52)}</span>],
  ['البعد عن قمة 52 أسبوعًا',pct(x.fromHigh52Pct)],
 ];
 return <div style={{minWidth:0}}>
  <h3 style={{marginBottom:8}}>{title}</h3>
  <div className="wide-table"><table className="data-table" dir="rtl" style={{width:'100%',borderCollapse:'collapse'}}>
   <thead><tr><th scope="col">المقياس</th><th scope="col">القيمة</th></tr></thead>
   <tbody>{rows.map(([k,v])=><tr key={k} style={{borderTop:'1px solid #e7ece9'}}><td>{k}</td><td dir="ltr" style={{textAlign:'right'}}>{v}</td></tr>)}</tbody>
  </table></div>
 </div>;
}

export function MarketOverviewPanel(){
 const [market,setMarket]=useState<'sa'|'us'>('sa'),[data,setData]=useState<Partial<Record<'sa'|'us',MarketOverview>>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let stop=false;
  const load=async()=>{setBusy(true);try{const r=await fetch('/api/market-overview?market='+market,{cache:'no-store'});const raw=await r.text();let d:any=null;try{d=JSON.parse(raw);}catch{}if(!r.ok||!d)throw Error((d&&(d.error+(d.stage?' ['+d.stage+(d.detail?': '+d.detail:'')+']':'')))||('تعذر جلب بيانات السوق (رمز '+r.status+'). أعد تحميل الصفحة بعد لحظات.'));if(!stop){setData(p=>({...p,[market]:d}));setError('');}}catch(e){if(!stop)setError(e instanceof Error?e.message:'تعذر جلب بيانات السوق.');}finally{if(!stop)setBusy(false);}};
  void load();const t=setInterval(()=>{if(document.visibilityState==='visible')void load();},120000);return ()=>{stop=true;clearInterval(t);};
 },[market]);
 const d=data[market];
 const trend=d?(market==='sa'?d.proxy:d.indices.find(x=>x.symbol==='^GSPC')??null):null;
 const b=d?.breadth;const moved=b?b.advancers+b.decliners+b.unchanged:0;
 return <section className="panel" aria-label="نظرة على السوق" dir="rtl">
  <div className="panel-head"><h2>نظرة على السوق</h2>
   <div className="mini-controls" role="group" aria-label="اختيار السوق">
    <button type="button" aria-pressed={market==='sa'} onClick={()=>setMarket('sa')}>السوق السعودي</button>
    <button type="button" aria-pressed={market==='us'} onClick={()=>setMarket('us')}>السوق الأمريكي</button>
   </div></div>
  {error&&!d&&<p role="alert" className="muted">{error}</p>}
  {!d&&busy&&<p role="status" className="muted">جارٍ جلب بيانات السوق…</p>}
  {d&&<>
   <div className="metric-grid">{d.indices.map(x=><IndexCard key={x.symbol} x={x}/>)}</div>
   <div className="two-col">
    {trend?<Analysis x={trend} title={market==='sa'?'تحليل الفترات — مؤشر بديل (40 شركة سعودية كبيرة، أوزان متساوية)':'تحليل S&P 500'}/>:<p className="muted">لا يتوفر تاريخ كافٍ لتحليل الفترات الآن.</p>}
    <div style={{minWidth:0}}>
     <h3 style={{marginBottom:8}}>اتساع السوق — عينة ميزان ({b?.priced??0} من {b?.universe??0} شركة)</h3>
     {b&&moved>0&&<><div className="bar" style={{height:12,display:'flex',direction:'rtl'}} aria-hidden="true">
       <span style={{width:`${b.advancers/moved*100}%`,background:'#2f8a63',borderRadius:0}}/><span style={{width:`${b.unchanged/moved*100}%`,background:'#c9d3cd',borderRadius:0}}/><span style={{width:`${b.decliners/moved*100}%`,background:'#c0504a',borderRadius:0}}/></div>
      <p className="small" style={{marginTop:6}}>صاعدة {b.advancers} · دون تغيّر {b.unchanged} · هابطة {b.decliners}{b.sessionDate&&<> · جلسة <span dir="ltr">{b.sessionDate}</span></>}</p>
      <p className="small">فوق متوسط 50 جلسة: {b.aboveMa50} من {b.priced} · فوق متوسط 200 جلسة: {b.aboveMa200} من {b.eligibleMa200}</p></>}
     <h3 style={{margin:'14px 0 6px'}}>الخلاصة الوصفية</h3>
     <ul className="bullet-list">{d.summary.map(s=><li key={s}>{s}</li>)}</ul>
    </div>
   </div>
   {!!d.notes.length&&<details style={{marginTop:10}}><summary className="muted">ملاحظات البيانات</summary><ul className="bullet-list">{d.notes.map(n=><li key={n}>{n}</li>)}</ul></details>}
   <p className="reference" style={{marginTop:8}}>المصدر: Yahoo Finance (أسعار المؤشرات قد تتأخر). حُسب في {time(d.generatedAt)}. أرقام وصفية للحالة الحالية، وليست توقعًا ولا توصية.</p>
  </>}
 </section>;
}
