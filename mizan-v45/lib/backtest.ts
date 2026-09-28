import {technical,finite} from './analysis';
import {quantile,HORIZONS} from './research-model';
import type {MarketReport} from './market-data';
export function walkForward(report:MarketReport){
 const prices=report.prices,records:any[]=[];
 for(const h of HORIZONS){for(let origin=504;origin+h.sessions<prices.length;origin+=h.sessions){
  const history=prices.slice(0,origin+1),t=technical(history),p=history.at(-1)!.close,s50=t.sma50.at(-1),s200=t.sma200.at(-1),rsi=t.rsi.at(-1);
  if(!finite(s50)||!finite(s200)||!finite(rsi))continue;
  const bias=Math.max(-1,Math.min(1,((p/s50-1)/.15+(s50/s200-1)/.15+(rsi-50)/30)/3));
  const past:number[]=[];for(let i=h.sessions;i<history.length;i++)past.push(Math.log(history[i].close/history[i-h.sessions].close));
  const med=quantile(past,.5)!,lo=quantile(past,.1)!,hi=quantile(past,.9)!;const center=bias*.3*h.sessions/252;
  const range=[p*Math.exp(center+lo-med),p*Math.exp(center+hi-med)],actual=prices[origin+h.sessions],change=(actual.close/p-1)*100;
  if((report.corporateActions||[]).some(a=>a.kind==='split'&&a.date>history.at(-1)!.date&&a.date<=actual.date))continue;
  const direction=bias>.15?'صاعد':bias<-.15?'هابط':'محايد',actualDirection=change>1?'صاعد':change< -1?'هابط':'محايد';
  records.push({horizon:h.name,sessions:h.sessions,issuedAt:history.at(-1)!.date,trainThrough:history.at(-1)!.date,actualDate:actual.date,anchor:p,range,direction,actualPrice:actual.close,actualDirection,correct:direction===actualDirection,errorPct:Math.abs(Math.sqrt(range[0]*range[1])-actual.close)/actual.close*100,rangeHit:actual.close>=range[0]&&actual.close<=range[1]});
 }}
 const summaries=HORIZONS.map(h=>{const r=records.filter(x=>x.sessions===h.sessions);const counts=['صاعد','محايد','هابط'].map(d=>r.filter(x=>x.actualDirection===d).length);return {period:h.name,count:r.length,directionAccuracy:r.length?r.filter(x=>x.correct).length/r.length*100:null,error:r.length?r.reduce((s,x)=>s+x.errorPct,0)/r.length:null,majorityBaseline:r.length?Math.max(...counts)/r.length*100:null};});
 return {model:'technical-reference-walk-forward-1',symbol:report.company.symbol,createdAt:new Date().toISOString(),source:report.priceSource,firstDate:prices[0]?.date,lastDate:prices.at(-1)?.date,records,summaries,limitations:['هذا اختبار مرجعي فني لسهم محدد، وليس اختبارًا صالحًا لاعتماد النموذج المالي المتكامل.','كل توقع يستخدم الشموع حتى تاريخ إصداره فقط؛ تُقاس النتيجة بعد المدة، بفترات غير متداخلة داخل كل مدة.','لم تُستخدم القوائم الحالية أو الأخبار الحالية في الماضي؛ لا توجد لدينا قاعدة كاملة للبيانات المالية كما كانت منشورة في كل يوم تاريخي.','الأسعار التاريخية من المزود قد تكون أعيد تعديلها؛ هذا ليس سجل أسعار محفوظًا في حينه.','اختيار سهم مدرج اليوم لا يمثل سوقًا يشمل الأسهم المشطوبة؛ لا تُعمم النتائج ولا يُدّعى علاج تحيز البقاء.','لا تُعدل أوزان النموذج الرئيسي بناءً على هذا الاختبار. الاعتماد يتطلب اختبارًا خارج بيانات التطوير وقياس سجل التوقعات اللاحق.']};
}
