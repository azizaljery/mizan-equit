'use client';
import {QuietNote} from './quiet-note';
import {useEffect,useState} from 'react';
import {fmt} from '@/lib/analysis';
import {pollDelay,type LiveQuote} from '@/lib/live-quote';
export function LivePrice({symbol,initialPrice,initialTime,currency,onUpdate}:{symbol:string;initialPrice:number|null;initialTime:string;currency:string;onUpdate:(quote:LiveQuote|null)=>void}){
 const [quote,setQuote]=useState<LiveQuote|null>(null),[error,setError]=useState(''),[paused,setPaused]=useState(false);
 useEffect(()=>{
  let active=true,pending=false,nextCheck=0;let ctrl:AbortController|null=null;setQuote(null);setError('');onUpdate(null);
  async function tick(){
   if(!active||document.hidden||pending||Date.now()<nextCheck)return;
   pending=true;const started=Date.now();ctrl=new AbortController();const own=ctrl;const timeout=setTimeout(()=>own.abort(),12000);
   try{const response=await fetch(`/api/company/quote?symbol=${encodeURIComponent(symbol)}`,{signal:own.signal,cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error);if(active&&!document.hidden){setQuote(body);onUpdate(body);setError('');nextCheck=started+pollDelay(body)}}
   catch(e){if(active&&!document.hidden){setError(e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر تحديث السعر؛ تحقق من توقيت آخر قراءة.');nextCheck=Date.now()+60000}}
   finally{clearTimeout(timeout);pending=false}
  }
  const visibility=()=>{setPaused(document.hidden);if(document.hidden)ctrl?.abort();else{nextCheck=0;void tick()}};
  document.addEventListener('visibilitychange',visibility);const timer=setInterval(()=>void tick(),15000);void tick();
  return ()=>{active=false;ctrl?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility)};
 },[symbol,onUpdate]);
 return <div className="quote stock-price-box"><strong className="stock-current-price" dir="ltr">{fmt(quote?.price??initialPrice)} <small>{quote?.currency||currency}</small></strong><small>{paused?'التحديث متوقف أثناء إخفاء الصفحة':quote?.isOpen?'جلسة التداول مفتوحة · جلب السعر كل 15 ثانية':quote?.sessionKnown?'خارج جلسة التداول · نتحقق دوريًا من الافتتاح':'جارٍ التحقق من السعر وحالة الجلسة'}</small>{!quote&&<small>السعر المرجعي من التحليل: {initialTime||'وقت غير متاح'}</small>}{quote&&<small>وقت السعر: {new Date(quote.quoteTime).toLocaleString('ar-SA')} {quote.priceKind==='minute-close'?'· إغلاق شمعة دقيقة؛ الوقت لبداية الشمعة':quote.priceKind==='last-close'?'· آخر سعر للجلسة المنتهية':quote.delayed?'· متأخر عن وقت الجلب '+Math.ceil(quote.ageSeconds/60)+' دقيقة':''}</small>}{error&&<small role="status">{error}</small>}{quote&&<QuietNote><small>وقت الجلب: {quote.retrievedAt} · مصدر السعر: <a href={quote.source} target="_blank" rel="noopener noreferrer">تحقق من المصدر</a> · {quote.coverage}</small></QuietNote>}<QuietNote><small>تكرار الجلب لا يضمن أن المزوّد يحدّث بياناته كل 15 ثانية.</small></QuietNote></div>;
}
