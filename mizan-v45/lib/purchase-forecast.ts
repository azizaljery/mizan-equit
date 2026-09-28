import {HORIZONS} from './research-model';
export async function capturePurchaseForecast(db:any,symbol:string,at:string,price:number,accountKey:string|null=null){
 const latest=await db.prepare("SELECT id,created_at,data FROM analysis_snapshots WHERE symbol=? AND created_at<=? AND (json_extract(data,'$.recordClass') IS NULL OR json_extract(data,'$.recordClass')='prospective-public' OR json_extract(data,'$.accountKey')=?) ORDER BY created_at DESC LIMIT 1").bind(symbol,at,accountKey).first();
 if(!latest)return {createdAt:at,price,symbol,snapshotId:null,rows:HORIZONS.map(h=>({sessions:h.sessions,period:h.name,available:false,range:null,direction:'غير متاح',confidence:'منخفض',riskLevel:'غير متحقق',reasons:['لم يكن هناك توقع محفوظ لهذا السهم قبل وقت الشراء. لا نستخدم توقعًا صدر بعد الشراء.']}))};
 const records=await db.prepare('SELECT id,data FROM forecast_records WHERE snapshot_id=? ORDER BY horizon').bind(latest.id).all();
 const report=JSON.parse(latest.data);
 return {createdAt:latest.created_at,capturedAt:at,price,symbol,snapshotId:latest.id,company:report.company,currency:report.currency,priceTime:report.quoteTime,inputs:{asOf:report.asOf,priceSource:report.priceSource,checks:report.checks},rows:HORIZONS.map(h=>{const row=(records.results||[]).map((r:any)=>({...JSON.parse(r.data),id:r.id})).find((r:any)=>r.sessions===h.sessions);return row||{sessions:h.sessions,period:h.name,available:false,range:null,direction:'غير متاح',confidence:'منخفض',reasons:['لم تُحفظ هذه المدة في التوقع وقت الشراء.']}})};
}
export function forecastMatch(row:any,outcome:any){
 if(!row?.available)return {state:'unavailable',text:'لم يصدر نطاق موثوق وقت الشراء',matchPct:null};
 if(!outcome)return {state:'pending',text:'الفترة لم تكتمل بعد أو لم تصل بيانات جلسة المقارنة',matchPct:null};
 if(outcome.state!=='complete')return {state:'excluded',text:outcome.reason||'النتيجة تحتاج مراجعة',matchPct:null};
 const [low,high]=row.range||[];if(!Number.isFinite(low)||!Number.isFinite(high)||high<=low||!Number.isFinite(outcome.actualPrice))return {state:'unavailable',text:'النطاق أو النتيجة غير صالحين للمقارنة',matchPct:null};
 const distance=Math.max(low-outcome.actualPrice,0,outcome.actualPrice-high),nearRange=Math.max(0,1-distance/(high-low));
 const base=row.scenarios?.base,baseHit=Array.isArray(base)&&base.length===2?outcome.actualPrice>=base[0]&&outcome.actualPrice<=base[1]:null;
 const matchPct=baseHit===null?null:Math.round(((outcome.directionCorrect?1:0)*.4+nearRange*.3+(baseHit?1:0)*.3)*1000)/10;
 return {state:'complete',text:baseHit===null?'السيناريو الأساسي غير محفوظ؛ لا نسبة مطابقة كلية':'مقارنة مكتملة',matchPct,rangeHit:outcome.rangeHit,directionCorrect:outcome.directionCorrect,baseHit,nearRangePct:nearRange*100,actualPrice:outcome.actualPrice,actualDate:outcome.actualDate,formula:'40% صحة الاتجاه + 30% قرب السعر من النطاق + 30% تحقق السيناريو الأساسي. مقياس وصفي وليس احتمال نجاح.'};
}
