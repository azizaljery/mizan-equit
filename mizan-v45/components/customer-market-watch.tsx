'use client';
import {useEffect,useState} from 'react';
type ForecastSnapshot={horizon:number;sessions?:number;direction?:string;referencePrice?:number;predictedPrice?:number;range?:unknown;confidence?:string;model?:string;createdAt?:string;priceTime?:string;source?:string};
type Item={symbol:string;name:string;market:string;latestObservation?:{price:number;currency:string;changePct:number|null;quoteTime:string;delayed:boolean;forecastSnapshot?:ForecastSnapshot[];forecastComparison?:{state:string;items?:Array<{horizon:number;predictedPrice:number|null;distancePct:number|null;direction?:string}>;note?:string}}|null};
function firstForecastDistance(item:Item){
 const value=item.latestObservation?.forecastComparison?.items?.[0]?.distancePct;
 return typeof value==='number'&&Number.isFinite(value)?' · فارق أول هدف ميزان '+value.toFixed(2)+'%':'';
}
export function CustomerMarketWatch({company}:{company?:{symbol:string;name:string;exchange?:string}|null}){
 const [items,setItems]=useState<Item[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=async()=>{try{const r=await fetch('/api/market-watch',{cache:'no-store'});if(!r.ok)return;const d=await r.json();setItems(d.items||[])}catch{}};
 useEffect(()=>{void load()},[]);
 const act=async(action:'add'|'remove',item?:Item)=>{const symbol=item?.symbol||company?.symbol;if(!symbol)return;setBusy(true);setMessage('');try{const r=await fetch('/api/market-watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,symbol,name:item?.name||company?.name||symbol})});const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذر الحفظ.');setMessage(d.message||'تم الحفظ.');await load()}catch(e){setMessage(e instanceof Error?e.message:'تعذر الحفظ.')}finally{setBusy(false)}};
 const watched=new Set(items.map(x=>x.symbol));
 return <section className="auto-details customer-watch" aria-label="مراقبة السوق">
  <div className="detail-body">
   <div className="section-heading"><h2>مراقبة السوق</h2><p>احفظ أسهمك، وتُسجل الأسعار المتاحة تلقائيًا للمراجعة اللاحقة.</p></div>
   {company&&<button className="button secondary" disabled={busy||watched.has(company.symbol)} onClick={()=>void act('add')}>{watched.has(company.symbol)?'السهم محفوظ في مراقبتك':'أضف إلى مراقبتي'}</button>}
   {message&&<p className="muted" role="status">{message}</p>}
   {items.length?<ul className="bullet-list">{items.map(item=><li key={item.symbol}><span>{item.name} ({item.symbol})</span>{item.latestObservation&&<small> آخر سعر {item.latestObservation.price} {item.latestObservation.currency} · {item.latestObservation.delayed?'متأخر':'مؤرخ'}{firstForecastDistance(item)} <button className="button link" onClick={()=>void act('remove',item)}>إزالة</button></small>}</li>)}</ul>:<p className="muted">لا توجد أسهم محفوظة بعد.</p>}
  </div>
 </section>;
}