export const EVALUATION_POLICY='mizan-end-close-v2';
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function directionOf(change:number,neutralThresholdPct=0){return change>neutralThresholdPct?'صاعد':change< -neutralThresholdPct?'هابط':'محايد';}
/** No synthetic point estimate is inferred from a legacy range. */
export function forecastMetrics(input:{reference:number;predicted?:number|null;actual:number;range?:number[]|null;direction?:string;neutralThresholdPct?:number}){
 const {reference:p0,predicted:pf,actual:pt}=input;
 const epsilon=Math.max(1,Math.abs(p0||0),Math.abs(pt||0),Math.abs(pf||0))*1e-12;
 const referenceValid=number(p0)&&Math.abs(p0)>epsilon,actualValid=number(pt)&&Math.abs(pt)>epsilon,point=number(pf)&&number(pt);
 const expectedChange=number(pf)&&number(p0)?pf-p0:null,actualChange=number(pt)&&number(p0)?pt-p0:null;
 const expectedChangePct=referenceValid&&expectedChange!==null?100*expectedChange/p0:null,actualChangePct=referenceValid&&actualChange!==null?100*actualChange/p0:null;
 const signedError=point?pt-pf!:null,absoluteError=signedError===null?null:Math.abs(signedError);
 const relativeErrorPct=actualValid&&absoluteError!==null?100*absoluteError/Math.abs(pt):null;
 const movementErrorPp=expectedChangePct!==null&&actualChangePct!==null?Math.abs(expectedChangePct-actualChangePct):null;
 const actualDirection=actualChangePct===null?null:directionOf(actualChangePct,input.neutralThresholdPct??0);
 const range=input.range,rangeValid=Array.isArray(range)&&range.length===2&&range.every(number)&&range[0]<=range[1];
 return {expectedChange,expectedChangePct,actualChange,actualChangePct,signedError,absoluteError,relativeErrorPct,movementErrorPp,actualDirection,directionCorrect:actualDirection&&['صاعد','هابط','محايد'].includes(input.direction||'')?actualDirection===input.direction:null,endRangeHit:rangeValid&&number(pt)?pt>=range[0]&&pt<=range[1]:null,rangeWidth:rangeValid?range[1]-range[0]:null,baselineErrorPct:referenceValid&&actualValid?100*Math.abs(pt-p0)/Math.abs(pt):null,pointReason:number(pf)?null:'لم يصدر سعر مركزي في التوقع الأصلي؛ يُقاس اتجاهه ونطاقه فقط.',denominatorReason:!referenceValid?'سعر البداية صفر أو قريب من الصفر؛ نسبة الحركة غير صالحة.':!actualValid?'سعر النهاية صفر أو قريب من الصفر؛ الخطأ النسبي غير صالح، ويُعرض الخطأ النقدي.':null};
}
export function pathEvents(bars:{date:string;high:number;low:number}[],target:number|null,invalidation:number|null,direction:string){
 if(!bars.length)return {targetTouched:null,invalidationTouched:null,firstTargetAt:null,firstInvalidationAt:null,order:'لا تتوفر سلسلة داخل الفترة'};
 const targetBar=number(target)?bars.find(b=>direction==='هابط'?b.low<=target:b.high>=target):undefined;
 const invalidBar=number(invalidation)?bars.find(b=>direction==='هابط'?b.high>=invalidation:b.low<=invalidation):undefined;
 return {targetTouched:number(target)?!!targetBar:null,invalidationTouched:number(invalidation)?!!invalidBar:null,firstTargetAt:targetBar?.date||null,firstInvalidationAt:invalidBar?.date||null,order:targetBar&&invalidBar?(targetBar.date===invalidBar.date?'الترتيب غير محسوم':targetBar.date<invalidBar.date?'الهدف أولًا':'الإبطال أولًا'):'لا يوجد ترتيب مزدوج مثبت'};
}
