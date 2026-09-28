'use client';
import {useEffect,useMemo,useState} from 'react';
import {advancedTechnical} from '@/lib/advanced-technical';
import {sma,rsi,atr,ema,finite,fmt,type Price} from '@/lib/analysis';
import {PriceChart,SparkPanel} from './market-charts';
const frames=[['1m','دقيقة'],['5m','5 دقائق'],['60m','ساعة'],['1d','يومي']] as const;
export function TimeframeChart({symbol,dailyPrices,children,liveTick=''}:{symbol:string;dailyPrices:Price[];children:React.ReactNode;liveTick?:string}){
 const [interval,setInterval]=useState('1d'),[count,setCount]=useState(90),[refresh,setRefresh]=useState(0);
 const [data,setData]=useState<{prices:Price[];timeZone:string;retrievedAt:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  setData(null);setError('');setBusy(false);if(interval==='1d'||document.hidden)return;
  const ctrl=new AbortController();let active=true;setBusy(true);const timer=setTimeout(()=>ctrl.abort(),25000);
  fetch(`/api/company/chart?symbol=${encodeURIComponent(symbol)}&interval=${interval}`,{signal:ctrl.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'تعذر جلب الشموع.');if(active)setData(body)}).catch(e=>{if(active)setError(e.name==='AbortError'?'انتهت مهلة جلب الشموع؛ اضغط تحديث للمحاولة مجددًا.':e.message)}).finally(()=>{clearTimeout(timer);if(active)setBusy(false)});
  return ()=>{active=false;clearTimeout(timer);ctrl.abort()};
 },[symbol,interval,refresh,liveTick]);
 const prices=interval==='1d'?dailyPrices:data?.prices||[];
 const indicators=useMemo(()=>{const close=prices.map(p=>p.close),fast=ema(close,12),slow=ema(close,26),macd=fast.map((v,i)=>finite(v)&&finite(slow[i])?v-slow[i]!:null),signal=Array(Math.min(25,prices.length)).fill(null).concat(ema(macd.filter(finite),9));return {sma50:sma(close,50),sma200:sma(close,200),rsi:rsi(close),atr:atr(prices),hist:macd.map((v,i)=>finite(v)&&finite(signal[i])?v-signal[i]:null)}},[prices]);
 const advanced=useMemo(()=>advancedTechnical(prices),[prices]);
 const label=frames.find(f=>f[0]===interval)![1];
 function dateLabel(value:string){if(interval==='1d')return value.slice(5);try{return new Intl.DateTimeFormat('en-GB',{timeZone:data?.timeZone||'UTC',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))}catch{return value.slice(5,16)+' UTC'}}
 return <><div className="mini-controls" aria-label="الفاصل الزمني للشارت">{frames.map(([key,title])=><button key={key} aria-pressed={interval===key} onClick={()=>{setData(null);setError('');setInterval(key)}}>{title}</button>)}{interval!=='1d'&&<button disabled={busy} onClick={()=>setRefresh(n=>n+1)}>تحديث الشموع</button>}</div>
 <p className="reference">كل شمعة تمثل {label}. {interval!=='1d'&&<>جلسات التداول العادية · التوقيت: {data?.timeZone||'يظهر بعد الجلب'} · قد تتأخر البيانات وتكون آخر شمعة غير مكتملة. خلاصة المخاطر والتقييم أعلاه مبنية على التحليل اليومي.</>}</p>
 {busy?<p role="status">جارٍ جلب شموع {label}…</p>:error?<div className="notice error" role="alert">{error} لم نعرض الشموع اليومية بدل الفاصل المطلوب.</div>:prices.length>0?<><div className="panel-head"><div className="chart-legend">المتوسط الذهبي: 50 شمعة · الأزرق: 200 شمعة</div><div className="mini-controls">{[60,90,200,400].map(n=><button key={n} aria-pressed={count===n} onClick={()=>setCount(n)}>{n} شمعة</button>)}</div></div><PriceChart key={interval} prices={prices} tech={indicators} count={count} label={label} dateLabel={dateLabel}/>{interval!=='1d'&&<><p>RSI 14: {fmt(indicators.rsi.at(-1))} · ATR 14: {fmt(indicators.atr.at(-1))} · {prices.length} شمعة متاحة</p><div className="two-col"><SparkPanel values={indicators.rsi} title={`RSI — ${label}`} low={0} high={100}/><SparkPanel values={indicators.hist} title={`MACD — ${label}`}/></div><p className="reference">المؤشرات محسوبة من شموع الفاصل المختار. المتوسط 200 يحتاج 200 شمعة على الأقل. الشموع تُجلب أيضًا كل 15 ثانية أثناء ظهور الصفحة وفتح الجلسة، وفق توافر المصدر.</p></>}</>:null}
 <div className="metric-grid"><div>ADX 14: {fmt(advanced.adx.at(-1))}</div><div>Bollinger 20: {fmt(advanced.bands.at(-1)?.lower)} – {fmt(advanced.bands.at(-1)?.upper)}</div><div>VWAP التقريبي: {fmt(advanced.vwap.at(-1))}<small>{interval==='1d'?'مرجح بحجم 20 جلسة':'مرجح بحجم شموع الجلسة؛ ليس متوسط كل تنفيذ'}</small></div></div>{interval==='1d'&&children}</>;
}
