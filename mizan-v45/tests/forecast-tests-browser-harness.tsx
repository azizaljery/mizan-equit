// Synthetic UI transport only. Never shipped; no authentication, D1, or product API is changed.
import {createRoot} from 'react-dom/client';
import {ForecastTestsWorkspace} from '../components/forecast-tests-workspace';
import {HORIZONS} from '../lib/research-model';
const company={symbol:'TEST',name:'شركة مصطنعة لاختبار الواجهة',exchange:'بيئة اختبار معزولة'};
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const forecasts=HORIZONS.map((h,i)=>({id:id(i+1),snapshotId:id(99),company,symbol:'TEST',available:true,createdAt:'2026-09-01T12:00:00.000Z',forecast:{id:id(i+1),period:h.name,sessions:h.sessions,price:100,predictedPrice:110,range:[108,112],direction:'صاعد',model:'synthetic-ui-only',window:{estimatedEndAt:'2026-09-02T20:00:00.000Z'}}}));
const tests=Array.from({length:51},(_,i)=>({id:id(i+100),forecastId:id(1),company,symbol:'TEST',currency:'SAR',label:'اكتمل التقييم — مثال مصطنع',createdAt:'2026-09-01T12:00:00.000Z',archived:false,original:{...forecasts[0].forecast,createdAt:'2026-09-01T12:00:00.000Z',basis:['مثال واجهة فقط']},outcome:{actualPrice:106,directionCorrect:true,rangeHit:false,metrics:{absoluteError:4,relativeErrorPct:4/106*100,movementErrorPp:4}}}));
const url=new URL(window.location.href);url.searchParams.set('forecast',id(1));window.history.replaceState(null,'',url);
window.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(u.pathname==='/api/company/search')return Response.json({companies:[],total:0,nextOffset:null});
 if(u.pathname!=='/api/forecast-tests')return Response.json({error:'المسار ليس جزءًا من المحاكاة'},{status:400});
 if(init?.method==='POST'){
  const body=JSON.parse(String(init.body));
  if(body.action==='create')return Response.json({message:'محاكاة: استُلمت '+body.ids.length+' مدد، دون كتابة أي سجل حقيقي.'});
  if(body.action==='archive'){const t=tests.find(t=>t.id===body.id);if(t)t.archived=body.archived;return Response.json({message:'محاكاة أرشفة للعرض فقط'});}
  return Response.json({message:'محاكاة دون اتصال سوق'});
 }
 if(u.searchParams.get('history')==='1')return Response.json({revisions:[{revision:2,createdAt:'2026-09-03T12:00:00Z',reason:'تصحيح مصدر مصطنع مع حفظ السابق',outcome:{actualPrice:106}},{revision:1,createdAt:'2026-09-02T12:00:00Z',reason:'قراءة أولى مصطنعة',outcome:{actualPrice:105}}],nextBefore:null});
 const archived=u.searchParams.get('archived')==='1',query=u.searchParams.get('q')||'',cursor=u.searchParams.get('cursor'),all=tests.filter(t=>t.archived===archived&&(!query||t.company.name.includes(query))),offset=cursor?50:0,rows=all.slice(offset,offset+50);
 return Response.json({forecasts,tests:rows,page:{total:all.length,returned:rows.length,nextCursor:all.length>offset+50?'fixture-page-2':null,cursor,query,archived},scheduler:{configured:false,message:'محاكاة واجهة فقط؛ لا توجد جدولة أو بيانات سوق في هذا الاختبار.'}});
};
createRoot(document.getElementById('root')!).render(<main className="workspace"><h1>اختبار واجهة معزول — جميع الأرقام والشركات مصطنعة</h1><div className="research-workspace"><ForecastTestsWorkspace/></div></main>);
