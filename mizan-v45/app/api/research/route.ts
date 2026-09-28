import {forecastAccount,canReadForecast} from '@/lib/forecast-access';
import {env} from 'cloudflare:workers';
import {ownerIdentity} from '@/lib/pin-lock';
import {fetchCompany,fetchLiveQuote,validSymbol} from '@/lib/market-data';
import {recordAnalysis,performanceStats,resolveForecasts} from '@/lib/forecast-journal';
import {appendPaperCash,appendPaperTrade,createPaperPortfolio,listPaperPortfolios,normalizeCash,normalizeTrade,openPaperPortfolio,paperPortfolioSummary,requirePaperPortfolio,setLegacyPortfolioPin,validManualDate} from '@/lib/paper-portfolio';
import {readSettings} from '@/lib/site-settings';
import {configuredReader} from '@/lib/source-status';
import {analyzedCompany} from '@/lib/research-service';
import {capturePurchaseForecast,forecastMatch} from '@/lib/purchase-forecast';
import {walkForward} from '@/lib/backtest';
const headers={'Cache-Control':'no-store, private'};
class ResearchAccessError extends Error {constructor(message:string,public status:number,public code:string){super(message)}}
function runtime(req:Request){
 const r=env as unknown as {DB:any;RECOMMENDATION_OWNER_EMAIL:string};
 if(!req.headers.get('oai-authenticated-user-email'))throw new ResearchAccessError('سجّل الدخول بحساب مالك ميزان لفتح المحافظ والسجل. بياناتك المحفوظة لم تُحذف.',401,'SIGN_IN_REQUIRED');
 if(!r.RECOMMENDATION_OWNER_EMAIL)throw new ResearchAccessError('تعذر التحقق من إعداد حساب المالك على الخادم. المحافظ محفوظة؛ يلزم إصلاح إعداد الدخول.',503,'OWNER_CONFIG_UNAVAILABLE');
 if(!ownerIdentity(req.headers,r.RECOMMENDATION_OWNER_EMAIL))throw new ResearchAccessError('الحساب المسجل حاليًا لا يطابق حساب مالك ميزان. افتح الموقع بحساب المالك.',403,'OWNER_REQUIRED');
 return r;
}
function failure(e:unknown,fallback:string){
 if(e instanceof ResearchAccessError)return Response.json({error:e.message,code:e.code},{status:e.status,headers});
 const message=e instanceof Error?e.message:fallback;
 if(/D1_ERROR|SQLITE_|no such (?:table|column)|database|JSON|Unexpected token/i.test(message)){
  console.error('Mizan research storage failed',message.slice(0,300));
  return Response.json({error:'تعذر قراءة أو حفظ هذا الجزء من السجل. لم نؤكد نجاح العملية؛ أعد المحاولة بعد التحقق من التخزين.',code:'STORAGE_UNAVAILABLE'},{status:503,headers});
 }
 return Response.json({error:message},{status:400,headers});
}
const token=(req:Request)=>req.headers.get('x-mizan-portfolio-token')||'';
const validId=(value:unknown)=>typeof value==='string'&&/^[-a-f0-9]{36}$/.test(value);
const finitePositive=(value:unknown,max=1e12)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
async function openData(db:any,portfolioId:string|null,portfolioToken:string){
 const portfolios=await listPaperPortfolios(db);const item=portfolioId?portfolios.find((p:any)=>p.id===portfolioId)||null:null;
 if(!item)return {portfolios,activePortfolio:null,unlocked:false,trades:[],cashEntries:[],portfolioSummary:null};
 let activePortfolio;
 try{activePortfolio=await requirePaperPortfolio(db,item.id,portfolioToken);}
 catch(e){if(e instanceof Error&&/افتح المحفظة برمزها|انتهت جلسة المحفظة/.test(e.message))return {portfolios,activePortfolio:item,unlocked:false,trades:[],cashEntries:[],portfolioSummary:null};throw e;}
  const [trades,cash]=await Promise.all([
   db.prepare('SELECT t.*,t.rowid AS ledger_sequence FROM paper_trades t WHERE t.portfolio_id=? ORDER BY t.created_at,t.rowid').bind(item.id).all(),
   db.prepare('SELECT * FROM paper_cash_entries WHERE portfolio_id=? ORDER BY created_at,id').bind(item.id).all()
  ]);
  const ledger=(trades.results||[]).map(normalizeTrade),cashEntries=(cash.results||[]).map(normalizeCash);
  const ids=[...new Set<string>(ledger.flatMap((t:any)=>[t.forecastId,...(t.purchaseForecast?.rows||[]).map((r:any)=>r.id)]).filter(Boolean))];
  const outcomes=new Map<string,any>();let comparisonError:string|null=null;
  try{
   for(let i=0;i<ids.length;i+=90){const batch=ids.slice(i,i+90),result=await db.prepare('SELECT id,data FROM forecast_outcomes WHERE id IN ('+batch.map(()=>'?').join(',')+')').bind(...batch).all();for(const r of result.results||[])outcomes.set(r.id,JSON.parse(r.data));}
  }catch(e){console.error('Mizan portfolio outcomes failed',e instanceof Error?e.message.slice(0,200):'unknown');outcomes.clear();comparisonError='تعذر جلب نتائج مطابقة التوقعات. الصفقات والأرصدة محفوظة ومتاحة؛ أعد المحاولة لعرض المطابقة.';}
  for(const t of ledger as any[]){t.forecastOutcome=outcomes.get(t.forecastId)||null;t.purchaseComparisons=(t.purchaseForecast?.rows||[]).map((r:any)=>({period:r.period,sessions:r.sessions,forecast:r,...(comparisonError?{state:'unavailable',text:comparisonError,matchPct:null}:forecastMatch(r,outcomes.get(r.id)))}));}
  return {portfolios,activePortfolio,unlocked:true,trades:ledger,cashEntries,comparisonError,portfolioSummary:paperPortfolioSummary(activePortfolio,ledger,cashEntries,{})};
}
export async function GET(req:Request){try{
 const {DB}=runtime(req),account=await forecastAccount(req.headers),url=new URL(req.url),symbol=url.searchParams.get('symbol'),portfolioId=url.searchParams.get('portfolio');
 if(symbol&&!validSymbol(symbol))throw Error('رمز غير صالح.');
 const historySql='SELECT f.*,o.data AS outcome_data FROM forecast_records f LEFT JOIN forecast_outcomes o ON o.id=f.id '+(symbol?'WHERE f.symbol=? ':'')+'ORDER BY f.created_at DESC,f.id LIMIT 200';
 const historyQuery=symbol?DB.prepare(historySql).bind(symbol):DB.prepare(historySql);
 // A failed performance/history query must not prevent access to the ledger.
 const results=await Promise.allSettled([
  historyQuery.all(),
  DB.prepare('SELECT f.id,f.symbol,f.created_at,f.horizon,f.model,f.market,f.sector,f.confidence,f.available,COALESCE(json_extract(f.data,\'$.recordClass\'),\'legacy-unverified\') AS recordClass,o.data AS outcome_data FROM forecast_records f LEFT JOIN forecast_outcomes o ON o.id=f.id').all(),
  DB.prepare("SELECT w.data,(SELECT f.data FROM forecast_records f WHERE f.symbol=w.symbol ORDER BY f.created_at DESC,f.horizon ASC LIMIT 1) AS forecast_data FROM watchlist w ORDER BY w.created_at DESC").all(),
  DB.prepare('SELECT data FROM backtest_runs ORDER BY created_at DESC LIMIT 20').all(),
  openData(DB,portfolioId,token(req))
 ]);
 const sectionErrors:Record<string,string>={};
 const readPart=(i:number,name:string,convert:(value:any)=>any,fallback:any)=>{try{const result=results[i];if(result.status==='rejected')throw result.reason;return convert(result.value);}catch(e){console.error('Mizan research section failed',name,e instanceof Error?e.message.slice(0,200):'unknown');sectionErrors[name]='تعذر جلب هذا الجزء من السجل: '+name+'. أعد المحاولة؛ لم تُحذف البيانات.';return fallback;}};
 const rows=readPart(0,'سجل التوقعات',history=>(history.results||[]).filter((r:any)=>canReadForecast(r,account,true)).map((r:any)=>({...r,data:JSON.parse(r.data),outcome:r.outcome_data?JSON.parse(r.outcome_data):null})),[]);
 const statsRows=readPart(1,'إحصاءات الأداء',allStats=>(allStats.results||[]).map((r:any)=>({...r,outcome:r.outcome_data?JSON.parse(r.outcome_data):null})),[]);
 const watch=readPart(2,'قائمة المتابعة',v=>(v.results||[]).map((r:any)=>({...JSON.parse(r.data),latestForecast:r.forecast_data&&canReadForecast({data:r.forecast_data},account,true)?JSON.parse(r.forecast_data):null})),[]);
 const backtests=readPart(3,'الاختبارات التاريخية',v=>(v.results||[]).map((r:any)=>JSON.parse(r.data)),[]);
 const paper=readPart(4,'المحفظة الوهمية',v=>v,{portfolios:[],activePortfolio:null,unlocked:false,trades:[],cashEntries:[],portfolioSummary:null});
 if(paper.comparisonError)sectionErrors['مطابقة توقعات المحفظة']=paper.comparisonError;
 return Response.json({history:rows,stats:sectionErrors['إحصاءات الأداء']?null:{all:performanceStats(statsRows),days30:performanceStats(statsRows,30),days90:performanceStats(statsRows,90)},watch,backtests,sectionErrors,pendingSymbols:[...new Set<string>(statsRows.filter((r:any)=>r.available&&!r.outcome&&(Date.now()-Date.parse(r.created_at))/864e5>=r.horizon*7/5).map((r:any)=>r.symbol))].slice(0,10),historyLimit:200,...paper},{headers});
 }catch(e){return failure(e,'تعذر تحميل السجل.')}}
export async function POST(req:Request){try{
 const {DB}=runtime(req);if(req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'طلب غير مسموح.'},{status:403,headers});
 const raw=await req.text();if(raw.length>3000)throw Error('الطلب أكبر من الحد.');const b=JSON.parse(raw),action=String(b.action||'');
 const settings=await readSettings(DB);if(['trade','cash_deposit','portfolio_create'].includes(action)&&!settings.paperEnabled)throw Error('العمليات الوهمية الجديدة متوقفة من الإدارة؛ سجلاتك محفوظة.');
 if(action==='portfolio_create'){const created=await createPaperPortfolio(DB,{name:b.name,currency:b.currency,pin:b.pin,capital:b.capital});return Response.json({message:'أُنشئت المحفظة وحُفظت برمزها.',portfolio:created.portfolio,token:created.token.token,expiresAt:created.token.expiresAt},{headers});}
 if(action==='portfolio_unlock'){const unlocked=await openPaperPortfolio(DB,b.portfolioId,b.pin);return Response.json({message:'فُتحت المحفظة لمدة 12 ساعة في هذه الصفحة.',portfolio:unlocked.portfolio,token:unlocked.token,expiresAt:unlocked.expiresAt},{headers});}
 if(action==='portfolio_set_pin'){const unlocked=await setLegacyPortfolioPin(DB,b.portfolioId,b.pin);return Response.json({message:'تم تعيين رمز المحفظة السابقة وفتحها.',token:unlocked.token,expiresAt:unlocked.expiresAt},{headers});}
 if(action==='cash_deposit'){
  const active=await requirePaperPortfolio(DB,b.portfolioId,token(req));if(active.currency==='MULTI')throw Error('المحفظة السابقة للعرض فقط؛ أنشئ محفظة جديدة بعملة واحدة للتداول الوهمي.');if(!finitePositive(b.amount)||!validId(b.id)||!validManualDate(b.createdAt||new Date().toISOString()))throw Error('راجع الرصيد والتاريخ.');
  const entry={id:b.id,portfolioId:active.id,cashType:'deposit' as const,amount:b.amount,currency:active.currency,createdAt:b.createdAt||new Date().toISOString(),source:'إدخال المستخدم',note:typeof b.note==='string'?b.note.slice(0,300):''};
  await appendPaperCash(DB,entry);return Response.json({message:'أضيف رصيد وهمي '+entry.amount+' '+active.currency+'.',entry},{headers});
 }
 if(!validSymbol(b.symbol||''))throw Error('اختر شركة برمز صحيح.');
 if(action==='watch'){const company=b.company;if(company?.symbol!==b.symbol||typeof company.name!=='string'||company.name.length>250)throw Error('هوية الشركة غير مكتملة.');const item={symbol:b.symbol,name:company.name,exchange:String(company.exchange||'').slice(0,120),createdAt:new Date().toISOString()};await DB.prepare('INSERT OR IGNORE INTO watchlist (symbol,created_at,data) VALUES (?,?,?)').bind(b.symbol,item.createdAt,JSON.stringify(item)).run();return Response.json({message:'أضيف السهم إلى قائمة المتابعة.'},{headers});}
 if(action==='unwatch'){await DB.prepare('DELETE FROM watchlist WHERE symbol=?').bind(b.symbol).run();return Response.json({message:'أزيل السهم من المتابعة.'},{headers});}
 if(action==='resolve'){const report=await fetchCompany(b.symbol,await configuredReader(DB,settings));const count=await resolveForecasts(DB,report);return Response.json({message:'حُدّثت '+count+' نتيجة مستحقة.'},{headers});}
 if(action==='evaluate'){const report=await fetchCompany(b.symbol,await configuredReader(DB,settings));const forecast=await recordAnalysis(DB,report,settings);return Response.json({forecast,message:'حُدث التحليل وقورنت التوقعات المستحقة بالأسعار المتاحة.'},{headers});}
 if(action==='backtest'){const report=await fetchCompany(b.symbol,await configuredReader(DB,settings)),result=walkForward(report);await DB.prepare('INSERT INTO backtest_runs (id,symbol,created_at,data) VALUES (?,?,?,?)').bind(crypto.randomUUID(),b.symbol,result.createdAt,JSON.stringify(result)).run();return Response.json({message:'حُفظ الاختبار المرجعي وحدود استخدامه.',backtest:result},{headers});}
 if(action==='trade'){
  const active=await requirePaperPortfolio(DB,b.portfolioId,token(req));
  if(active.currency==='MULTI')throw Error('المحفظة السابقة للعرض فقط؛ أنشئ محفظة جديدة بعملة واحدة للتداول الوهمي.');
  if(!['buy','sell'].includes(b.side)||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>700||!finitePositive(b.quantity,1e9)||!validId(b.id))throw Error('راجع نوع الصفقة والكمية وسببها.');
  const manual=finitePositive(b.price,1e9);let createdAt=b.createdAt||new Date().toISOString();if(!validManualDate(createdAt))throw Error('تاريخ الصفقة غير صالح أو في المستقبل.');
  let price:number,currency:string,quoteTime:string,source:string;
  if(manual){price=b.price;currency=String(b.currency||'').toUpperCase();quoteTime=createdAt;source='سعر إدخال المحاكاة';}else{const quote=await fetchLiveQuote(b.symbol,await configuredReader(DB,settings));price=quote.price;currency=quote.currency;quoteTime=quote.quoteTime;source=quote.source;}
  if(currency!==active.currency)throw Error('عملة السهم '+(currency||'غير معروفة')+' لا تطابق عملة المحفظة '+active.currency+'. أنشئ محفظة بالعملة المناسبة.');
  if(b.currentTime===true){createdAt=new Date().toISOString();if(manual)quoteTime=createdAt;}
  let prediction:any=null;if(b.forecastId){const row=await DB.prepare('SELECT data FROM forecast_records WHERE id=? AND symbol=? AND available=1').bind(b.forecastId,b.symbol).first();if(!row||!canReadForecast(row,await forecastAccount(req.headers),true))throw Error('التوقع المختار لا يطابق السهم أو لم يصدر عنه نطاق.');prediction=JSON.parse(row.data);if(!prediction.createdAt||Date.parse(prediction.createdAt)>Date.parse(createdAt))throw Error('التوقع صدر بعد وقت العملية؛ لا يمكن نسبته إلى شراء أقدم.');}
  const forecastSnapshot=prediction?{id:b.forecastId,createdAt:prediction.createdAt,period:prediction.period,direction:prediction.direction,range:prediction.range,confidence:prediction.confidence}:null;
  // A trade captures the last issued forecast. It must not silently issue a new one.
  const purchaseForecast=b.side==='buy'?await capturePurchaseForecast(DB,b.symbol,createdAt,price,await forecastAccount(req.headers)):null;
  const trade={id:b.id,portfolioId:active.id,symbol:b.symbol,side:b.side,quantity:b.quantity,price,currency,createdAt,reason:b.reason.trim(),forecastId:b.forecastId||null,forecastSnapshot,purchaseForecast,companyName:purchaseForecast?.company?.name||String(b.companyName||b.symbol).slice(0,250),exchange:purchaseForecast?.company?.exchange||String(b.exchange||'').slice(0,100),confidence:prediction?.confidence||null,source,quoteTime};
  const saved=await appendPaperTrade(DB,trade);return Response.json({message:'سُجلت صفقة وهمية بسعر '+saved.price+' '+saved.currency+' في '+saved.createdAt+'. لا يوجد تنفيذ تداول حقيقي.',trade:saved},{headers});
 }
 throw Error('عملية غير مدعومة.');
 }catch(e){return failure(e,'تعذرت العملية؛ لم يتم تأكيد الحفظ.')}}
