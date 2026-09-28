'use client';
import {useEffect,useState} from 'react';
import type {Company} from '@/lib/market-data';

/** A directory lookup only: selecting a stock never starts a market scan or requires a file. */
export function PaperStockPicker({currency,selected,onSelect,disabled=false,purpose="portfolio"}:{currency:string;selected:Company|null;onSelect:(company:Company)=>void;disabled?:boolean;purpose?:"portfolio"|"test"}){
 const [market,setMarket]=useState(currency==='USD'?'us':'sa'),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[companies,setCompanies]=useState<Company[]>([]),[nextOffset,setNextOffset]=useState<number|null>(null),[total,setTotal]=useState<number|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setMarket(currency==='USD'?'us':'sa');setQuery('');setOffset(0);setCompanies([]);},[currency]);
 useEffect(()=>{
  const controller=new AbortController();let current=true;setLoading(true);setError('');
  const timer=setTimeout(async()=>{try{
   const response=await fetch('/api/company/search?'+new URLSearchParams({q:query,market,offset:String(offset)}),{signal:controller.signal});
   const result=await response.json();if(!response.ok)throw Error(result.error||'تعذر البحث عن الأسهم.');
   if(current){setCompanies(old=>offset?[...new Map([...old,...result.companies].map(c=>[c.symbol,c])).values()]:result.companies);setNextOffset(result.nextOffset??null);setTotal(result.total??result.companies.length);}
  }catch(e){if(current){setError(e instanceof Error?e.message:'تعذر البحث.');setNextOffset(null);setTotal(null);}}finally{if(current)setLoading(false)}},250);
  return()=>{current=false;clearTimeout(timer);controller.abort()};
 },[query,market,offset]);
 function reset(){setOffset(0);setCompanies([]);setNextOffset(null);setTotal(null);}
 return <section aria-label={purpose==="test"?"اختيار سهم للاختبار":"اختيار سهم للمحفظة الوهمية"}><h4>ابحث عن سهم واختره</h4><p>اختر السوق، ثم اكتب اسم الشركة أو رمزها أو أول حرف. لا تحتاج إلى رفع أو تنزيل أي ملف.</p>
 <div className="metric-grid"><label>السوق<select disabled={disabled} value={market} onChange={e=>{reset();setMarket(e.target.value)}}><option value="sa">السعودي</option><option value="us">الأمريكي</option></select></label><label>اسم الشركة أو رمز التداول<input disabled={disabled} value={query} onChange={e=>{reset();setQuery(e.target.value)}} placeholder={market==='sa'?'أرامكو أو 2222':'Apple أو AAPL'} autoComplete="off"/></label></div>
 {selected&&<p>السهم المختار: <b>{selected.name} · {selected.symbol}</b> · {selected.exchange}</p>}
 <p role="status" aria-live="polite">{loading?'جارٍ البحث عن الأسهم…':error||(!companies.length?'لا توجد نتائج مطابقة. جرّب الرمز أو اسمًا أقصر.':`عدد النتائج: ${total??companies.length} · المعروض: ${companies.length}`)}</p>
 <div className="paper-stock-results" aria-label="نتائج بحث الأسهم">{companies.map(c=><button type="button" className="secondary-btn" disabled={disabled||loading} key={c.symbol} aria-pressed={selected?.symbol===c.symbol} onClick={()=>onSelect(c)}>{c.name} · {c.listedSymbol||c.symbol}<small>{c.exchange}</small></button>)}</div>
 {nextOffset!==null&&<button type="button" className="link-btn" disabled={disabled||loading} onClick={()=>setOffset(nextOffset)}>عرض المزيد من الأسهم</button>}
 </section>;
}
