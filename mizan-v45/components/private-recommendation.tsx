'use client';
import {QuietNote} from './quiet-note';
import {useEffect,useRef,useState} from 'react';
import {TradeScenario} from './trade-scenario';
import {Forecasts} from './forecasts';
import {PrivateEvidence} from './private-evidence';
import type {tradeScenario} from '@/lib/trade-scenario';
type Result={decision?:ReturnType<typeof import('@/lib/final-decision').finalDecision>;quote?:import('@/lib/live-quote').LiveQuote|null;result?:ReturnType<typeof tradeScenario>;forecast?:import('@/lib/market-data').MarketReport['forecast'];evidence?:ReturnType<typeof import('@/lib/final-decision').privateDecisionEvidence>;currency:string;priceSource:string;name:string;error?:string};
export function PrivateRecommendationOutput({result}:{result:Result}){
 return <>{result.result?<><TradeScenario result={result.result} currency={result.currency} priceSource={result.priceSource} quote={result.quote} decision={result.decision}/>{result.forecast?<><p className="reference">توقعات ميزان الأصلية لنفس التحليل؛ لا نعيد حسابها أو تغيير أوزانها عند العرض.</p><Forecasts data={result.forecast}/></>:<p role="status">لم تصل توقعات محفوظة مع هذا التحليل؛ لا يُعرض نطاق بديل مختلق.</p>}{result.evidence&&<PrivateEvidence evidence={result.evidence}/>}</>:<p role="status">{result.error}</p>}</>;
}
export function PrivateRecommendation({symbol,disclaimer}:{symbol?:string;disclaimer?:string}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null),[pin,setPin]=useState('');
 const controller=useRef<AbortController|null>(null);
 function lock(){controller.current?.abort();controller.current=null;setOpen(false);setResult(null);setError('');setBusy(false);setPin('')}
 useEffect(()=>{lock()},[symbol]);
 useEffect(()=>{const hide=()=>{if(document.hidden)lock()};document.addEventListener('visibilitychange',hide);return ()=>{document.removeEventListener('visibilitychange',hide);controller.current?.abort();controller.current=null}},[]);
 useEffect(()=>{if(!result)return;const timer=setTimeout(lock,120000);return ()=>clearTimeout(timer)},[result]);
 async function submit(){
  controller.current?.abort();setOpen(true);setError('');setResult(null);
  if(!symbol){setError('اختر الشركة أولًا.');return}if(!/^\d{6,12}$/.test(pin)){setError('أدخل رمز ميزان الخاص المكوّن من 6 إلى 12 رقمًا.');return}
  const ctrl=new AbortController();controller.current=ctrl;setBusy(true);const timer=setTimeout(()=>ctrl.abort(),65000);
  try{const response=await fetch('/api/private-recommendation',{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,body:JSON.stringify({action:'view',symbol,pin})});const body=await response.json();if(ctrl.signal.aborted)return;if(!response.ok)throw new Error(body.error||'تعذر فتح التوصية.');setPin('');setResult(body)}catch(e){if(controller.current===ctrl)setError(ctrl.signal.aborted?'انتهت مهلة الاتصال.':e instanceof Error?e.message:'تعذر الاتصال.')}finally{clearTimeout(timer);if(controller.current===ctrl)setBusy(false)}
 }
 return <section className="panel"><div className="mizan-gate private-gateway" aria-label="بوابة ميزان الخاص"><h3 className="gate-title">بوابة ميزان الخاص</h3><p>فحص السهم المختار وعرض قرار ميزان وأسبابه ومستويات الخطة وفق البيانات المتاحة.</p><label htmlFor="private-recommendation-pin">رمز ميزان الخاص</label><input id="private-recommendation-pin" type="password" inputMode="numeric" autoComplete="off" minLength={6} maxLength={12} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,12))} disabled={busy}/><button type="button" className={`mizan-private-btn${busy?' is-loading':''}`} aria-busy={busy} disabled={busy||!symbol||!/^\d{6,12}$/.test(pin)} onClick={()=>void submit()}>{busy?'جارٍ جلب التوصية…':'طلب فحص المركز المالي'}</button>{!symbol&&<p>اختر الشركة أولًا.</p>}{error&&<p role="alert" className="gate-disclaimer">{error}</p>}{disclaimer&&<p className="gate-disclaimer">{disclaimer}</p>}</div>{open&&<div className="section-gap"><div className="result-controls"><h3>ميزان الخاص</h3><button className="secondary-btn" onClick={lock}>إغلاق</button></div>{result&&<div className="private-recommendation-output"><PrivateRecommendationOutput result={result}/><QuietNote><p className="reference">متاح فقط لحساب مالك ميزان بعد التحقق من الرمز. تُخفى النتائج بعد دقيقتين أو عند إخفاء الصفحة.</p></QuietNote></div>}</div>}</section>;
}
