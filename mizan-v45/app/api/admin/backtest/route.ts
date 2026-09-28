import {env} from 'cloudflare:workers';
import {authorizeAdminRequest} from '@/lib/admin-request';
import {adminSession} from '@/lib/admin-access';
import {runBacktest,parseBacktestConfig,runChampionshipBacktest,parseChampionshipRequest} from '@/lib/backtest/runner';
import {runWalkForward,parseWalkForwardConfig} from '@/lib/backtest/walk-forward';
import {BacktestInputError} from '@/lib/backtest/types';
const headers={'Cache-Control':'no-store, private',Vary:'Cookie'};
const error=(message:string,status:number)=>Response.json({error:message},{status,headers});
async function body(req:Request):Promise<Record<string,unknown>> {
  if (!req.body) throw new BacktestInputError('JSON مطلوب.');
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {for (;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000){await reader.cancel();throw new BacktestInputError('الطلب أكبر من 500000 بايت.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new BacktestInputError('JSON غير صالح.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new BacktestInputError('JSON يجب أن يكون كائنًا.');return parsed as Record<string,unknown>;
}
export async function POST(req:Request) {
  try {
    const runtime=env as unknown as {DB:any;RECOMMENDATION_OWNER_EMAIL?:string};
    const denied=authorizeAdminRequest(req);if(denied)return denied;
    if(!await adminSession(runtime.DB,req))return error('سجّل الدخول إلى إدارة ميزان.',401);
    if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return error('استخدم application/json.',415);
    const input=await body(req);
    const {mode=(Object.hasOwn(input,'dataset')?'championship':'single'),...config}=input;
    if(mode==='championship'){
      const {dataset,report}=parseChampionshipRequest(config);
      const result=runChampionshipBacktest(dataset,report);
      return Response.json({success:true,data:{symbol:result.symbol,summary:{totalTrades:result.totalTrades,winRate:result.winRate,sharpeRatio:result.sharpeRatio,maxDrawdown:result.maxDrawdown,calmarRatio:result.championshipMetrics.calmarRatio,profitFactor:result.profitFactor,initialCapital:result.initialCapital,finalCapital:result.finalCapital},championshipMetrics:result.championshipMetrics,windowsEvaluated:result.windowsEvaluated,trades:result.trades,equityCurve:result.equityCurve,skippedIncompleteHorizons:result.skippedIncompleteHorizons,method:result.method,retrained:result.retrained,limitations:result.limitations,persisted:false}},{headers});
    }
    if(new TextEncoder().encode(JSON.stringify(input)).byteLength>12000)throw new BacktestInputError('إعداد الاختبار أكبر من 12000 بايت.');
    if(mode==='single')return Response.json(await runBacktest(runtime.DB,parseBacktestConfig(config)),{headers});
    if(mode==='walk-forward')return Response.json(await runWalkForward(runtime.DB,parseWalkForwardConfig(config)),{headers});
    throw new BacktestInputError('استخدم single أو walk-forward أو championship.');
  }catch(e){return e instanceof BacktestInputError?error(e.message,400):error('تعذر إتمام الاختبار أو تأكيد حفظه؛ راجع السجل قبل المحاولة بمعرف جديد.',503);}
}
