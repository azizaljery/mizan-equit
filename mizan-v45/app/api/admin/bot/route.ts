import {runPaperBot} from '@/worker/paper-bot-scheduled';
import {manualOrder,ManualInputError} from '@/lib/bot/manual';
import {liveFetchers} from '@/lib/bot/data';
import {configuredReader} from '@/lib/source-status';
import {readSettings} from '@/lib/site-settings';
import {botGuard,botError,botHeaders} from './guard';
import {BotInputError,createExperiment,experimentDashboard,listDecisions,listExperiments,listFills,listOrders,vosaSummary,vosaSilenceCheck,setExperimentStatus,sourceScorecard} from '@/lib/bot/queries';

const CREATE_KEYS=['action','name','market','mode','initialCash','positionPct','maxPositionsPerHorizon','dailyLossHaltPct','start','note'];

export async function GET(req:Request){
  try{
    const g=await botGuard(req,false);if(g instanceof Response)return g;
    const id=new URL(req.url).searchParams.get('experiment');
    if(!id)return Response.json({experiments:await listExperiments(g.db)},{headers:botHeaders});
    const dashboard=await experimentDashboard(g.db,id);
    if(!dashboard)return botError('التجربة غير موجودة.',404);
    const [orders,decisions,fills,scorecard,vosa]=await Promise.all([listOrders(g.db,id,200),listDecisions(g.db,id,200),listFills(g.db,id,200),sourceScorecard(g.db),vosaSummary(g.db,id)]);
    const silence=await vosaSilenceCheck(g.db,id);
    return Response.json({dashboard,orders,decisions,fills,scorecard,vosa,silence},{headers:botHeaders});
  }catch{return botError('تعذر قراءة بيانات البوت من قاعدة البيانات.',503);}
}

export async function POST(req:Request){
  try{
    const g=await botGuard(req,true);if(g instanceof Response)return g;
    if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return botError('استخدم application/json.',415);
    const raw=await req.text();if(raw.length>2000)return botError('الطلب أكبر من الحد.',413);
    let body:any;try{body=JSON.parse(raw);}catch{return botError('JSON غير صالح.',400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return botError('JSON غير صالح.',400);
    if(body.action==='create'){
      if(Object.keys(body).some(k=>!CREATE_KEYS.includes(k)))return botError('حقل غير مسموح في إنشاء التجربة.',400);
      const {action,...input}=body;
      return Response.json(await createExperiment(g.db,input),{status:201,headers:botHeaders});
    }
    if(['start','pause','stop'].includes(body.action)){
      if(typeof body.id!=='string'||Object.keys(body).some(k=>!['action','id'].includes(k)))return botError('الطلب يقبل action وid فقط.',400);
      return Response.json(await setExperimentStatus(g.db,body.id,body.action),{headers:botHeaders});
    }
    if(body.action==='run-now'){
      if(typeof body.id!=='string'||Object.keys(body).some(k=>!['action','id'].includes(k)))return botError('الطلب يقبل action وid فقط.',400);
      const exp=await g.db.prepare('SELECT status FROM bot_experiments WHERE id=?').bind(body.id).first();
      if(!exp)return botError('التجربة غير موجودة.',404);
      if(exp.status!=='running')return botError('التجربة غير مشغّلة؛ شغّلها أولًا.',409);
      // Same step, same rules and lock as the schedule; bounded so the request stays under the edge time limit (repeat to continue).
      return Response.json(await runPaperBot(g.db,{triggeredBy:'manual',experimentId:body.id,maxFetches:24}),{headers:botHeaders});
    }
    if(body.action==='manual-order'){
      const ALLOWED=['action','id','symbol','side','horizon','amount','requestId'];
      if(typeof body.id!=='string'||typeof body.symbol!=='string'||typeof body.requestId!=='string'||Object.keys(body).some(k=>!ALLOWED.includes(k)))return botError('حقول الطلب غير صحيحة.',400);
      const now=Date.now(),read=await configuredReader(g.db,await readSettings(g.db)),f=liveFetchers(read,new Date(now).toISOString().slice(0,10));
      // Paper money only: same frozen strategy, costs and quote rules as the scheduled step; refusals are recorded with their reason.
      const r=await manualOrder(g.db,now,{experimentId:body.id,symbol:body.symbol,side:body.side,horizon:body.horizon===undefined?undefined:Number(body.horizon),amount:body.amount===undefined||body.amount===''?undefined:Number(body.amount),requestId:body.requestId},f);
      return Response.json(r,{headers:botHeaders});
    }
    return botError('إجراء غير معروف.',400);
  }catch(e){
    if(e instanceof ManualInputError)return botError(e.message,e.status);
    if(e instanceof BotInputError)return botError(e.message,400);
    return botError('تعذر تنفيذ الإجراء؛ لم يُحفظ شيء مؤكد.',503);
  }
}
