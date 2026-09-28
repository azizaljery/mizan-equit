import {type Price,type Meta,type Financials,type Checks,type Events,analyze,finite,fmt} from './analysis';
import {type Requirements,type YearRow,requirementAnalysis} from './readiness';
/** Legacy helper: no production route imports this module; app/manual owns its current scoring UI. */
export function recommendation(score:number|null,mode:'trader'|'investor',base:ReturnType<typeof analyze>,extra:ReturnType<typeof requirementAnalysis>,req:Requirements){
 const strength=base.factors.filter(f=>f.score!==null&&f.score<=35).sort((a,b)=>a.score!-b.score!).map(f=>`${f.name}: ${f.display}. ${f.reason}`);
 const weakness=base.factors.filter(f=>f.score!==null&&f.score>=60).sort((a,b)=>b.score!-a.score!).map(f=>`${f.name}: ${f.display}. ${f.reason}`);
 const close=base.technical.last?.close??null;
 const priceInvalidated=(req.exitType==='price'||req.exitType==='both')&&finite(req.exitPrice)&&finite(close)&&close<=req.exitPrice;
 const eventInvalidated=req.invalidated&&!!req.invalidationEvidence.trim();
 let action='لا توصية — التحليل غير مكتمل',reason='تُستكمل البيانات والفحص الشرعي والخطة قبل توليد توصية.',kind='incomplete';
 if(eventInvalidated||priceInvalidated||base.critical){action='بيع / تخفيف مشروط';reason=eventInvalidated?'سجّل المستخدم تحقق شرط إبطال الفرضية مع دليله.':priceInvalidated?'الإغلاق المدخل بلغ أو كسر مستوى إبطال الفرضية الذي سجّلته.':'ظهر خطر جوهري مثبت ضمن البيانات؛ راجع حيازتك وفرضية الاستمرار.';kind='exit'}
 else if(score!==null){
  const problems=extra.items.filter(x=>(x.group==='shared'||x.group===mode)&&x.state!=='pass');
  if(score<40&&!problems.length&&(!base.warnings.length)){action='شراء مشروط';reason='اجتازت البيانات والخطة الشروط المعلنة مع خطر منخفض نسبيًا. تظل التوصية مرتبطة بالمستويات والفرضية المسجلتين، وتُراجع عند تغير البيانات.';kind='entry'}
  else{action='انتظار / مراقبة';reason=problems.length?`لم تستوفَ ${problems.length} من شروط الاختيار رغم اكتمال إدخالها؛ راجع نقاط الضعف.`:score>=60?'الخطر مرتفع وفق قواعد النموذج.':'القراءات لا تحقق شروط توصية الشراء المشروط.';kind='wait'}
 }
 return {action,reason,kind,strength,weakness,priceInvalidated,eventInvalidated};
}
export function referenceLevels(mode:'trader'|'investor',base:ReturnType<typeof analyze>,extra:ReturnType<typeof requirementAnalysis>,cost=0){
 const t=base.technical,atr=t.atr.at(-1);if(!t.last||!finite(atr)||atr<=0)return null;
 let entry:number,stop:number,target:number,why:string;
 if(mode==='trader'){
  if(t.resistance===null||t.support===null)return null;
  entry=t.resistance+atr*.1;stop=Math.min(entry-atr*1.5,t.resistance-atr*.5);target=entry+2*(entry-stop+cost)+cost;
  why='سيناريو اختراق: المقاومة + 0.1 ATR؛ وقف مرجعي أسفل الاختراق بمسافة لا تقل عن 1.5 ATR. الهدف مسافة حسابية 2R، وليس تنبؤًا بوصول السعر أو مقاومة مؤكدة.';
 }else{
  if(!extra.valuation)return null;
  entry=extra.valuation.low*.8;stop=entry-atr*2;target=extra.valuation.low;
  why='سيناريو قيمة: خصم افتراضي 20% من الحد الأدنى لنطاق القيمة؛ الحد السعري الاحترازي أقل بـ2 ATR. إبطال فرضية الاستثمار يرتبط أيضًا بالحدث المالي الذي تحدده.';
 }
 if(stop<=0||target<=entry)return null;
 // No rounding to a tick: market-specific tick size is not supplied.
 return {entry,stop,target,why,rr:(target-entry-cost)/(entry-stop+cost)};
}
