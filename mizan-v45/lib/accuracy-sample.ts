import {forecastMetrics} from './forecast-metrics';
import {ageDays,validDate,type Price} from './analysis';
import {type Company,type MarketReport,parseChart,quoteURL,upstream} from './market-data';
import {validateMarketIdentity} from './market-identity';
import {eligibleSaudiCompanies,searchSaudiPage} from './saudi-directory';
import {eligibleUSCompanies,searchUSDirectory} from './us-directory';
import {forecasts,HORIZONS,forecastModelVersion} from './research-model';
import {forecastMatch} from './purchase-forecast';
import {type SiteSettings,validateSettings} from './site-settings';

export const SAMPLE_COUNT=20;
export const SAMPLE_METHOD='mizan-random-historical-1';
export const samplePeriod=(n:number)=>HORIZONS.find(h=>h.sessions===n)?.name||`${n} جلسة تداول`;
const day=86400000;
const isoDay=(time:number)=>new Date(time).toISOString().slice(0,10);
export const lastCompleteDay=(now=Date.now())=>isoDay(now-day);
const parse=(s:string|null)=>s?JSON.parse(s):null;
const goodId=(s:unknown)=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
const failure=(e:unknown)=>e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message.slice(0,900):'تعذر جلب البيانات أو حفظ النتيجة؛ أعد المحاولة. لم يُنشأ سعر بديل.';

/** Reproducible, without replacement. Draws use rejection to avoid modulo bias. */
export function randomSample(pool:Company[],seed:string,count=SAMPLE_COUNT){
 let state=2166136261;for(const c of seed)state=Math.imul(state^c.charCodeAt(0),16777619);
 const uint=()=>{state=(state+0x6D2B79F5)|0;let t=Math.imul(state^(state>>>15),1|state);t^=t+Math.imul(t^(t>>>7),61|t);return (t^(t>>>14))>>>0;};
 const draw=(n:number)=>{const ceiling=Math.floor(4294967296/n)*n;let v;do{v=uint();}while(v>=ceiling);return v%n;};
 const symbols=new Set<string>(),issuers=new Set<string>();
 const sorted=[...pool].sort((a,b)=>a.symbol.localeCompare(b.symbol)).filter(c=>{
  const issuer=(c.nameEn||c.name).toLowerCase().replace(/\s+-\s+.*$/,'').replace(/[,\s]+class\s+[a-z].*$/,'').trim();
  const key=(c.symbol.endsWith('.SR')?'sa:':'us:')+(issuer||c.symbol);
  if(symbols.has(c.symbol)||issuers.has(key))return false;symbols.add(c.symbol);issuers.add(key);return true;
 });
 if(!Number.isInteger(count)||count<1||sorted.length<count)throw Error('لا توجد شركات كافية لتكوين العينة المطلوبة في الأسواق المسموحة.');
 const universe=sorted.map(c=>c.symbol),rows=[...sorted];for(let i=0;i<count;i++){const j=i+draw(rows.length-i);[rows[i],rows[j]]=[rows[j],rows[i]];}
 return {companies:rows.slice(0,count),universe};
}

export function validateSampleInput(input:any,settings:SiteSettings,now=Date.now()){
 if(!goodId(input?.id)||!['sa','us','both'].includes(input.market)||!validDate(input.date)||input.date< '1970-01-01'||input.date>lastCompleteDay(now)||!Number.isInteger(input.sessions)||input.sessions<1||input.sessions>252)throw Error('اختر تاريخًا مكتملًا في الماضي ومدة بين 1 و252 جلسة تداول وسوقًا صحيحًا.');
 const markets=input.market==='both'?['sa','us']:[input.market];if(markets.some((m:string)=>!settings.enabledMarkets.includes(m)))throw Error('أحد الأسواق المختارة متوقف من الإدارة.');
 if(settings.periods[input.sessions]?.enabled===false)throw Error('هذه المدة متوقفة من الإدارة؛ أعد تفعيلها قبل الاختبار.');
 return {id:input.id as string,market:input.market as 'sa'|'us'|'both',date:input.date as string,sessions:input.sessions as number};
}

export async function createAccuracyRun(db:any,input:any,settings:SiteSettings,now=Date.now(),poolOverride?:Company[]){
 const v=validateSampleInput(input,settings,now),existing=await db.prepare('SELECT data FROM accuracy_runs WHERE id=?').bind(v.id).first();
 if(existing){const old=parse(existing.data);if(old.date!==v.date||old.sessions!==v.sessions||old.market!==v.market)throw Error('معرف الاختبار مستخدم لإعدادات مختلفة.');return getAccuracyRun(db,v.id);}
 const pool=poolOverride||[...(v.market!=='us'?eligibleSaudiCompanies():[]),...(v.market!=='sa'?eligibleUSCompanies():[])];
 const seed=crypto.randomUUID(),sample=randomSample(pool,seed),createdAt=new Date(now).toISOString();
 const config=validateSettings(settings);
 const run={...v,createdAt,seed,period:samplePeriod(v.sessions),method:SAMPLE_METHOD,model:forecastModelVersion(config),settings:config,universe:sample.universe,
  directories:[...(v.market!=='us'?[{market:'sa',...searchSaudiPage('').directory}]:[]),...(v.market!=='sa'?[{market:'us',...searchUSDirectory('').directory}]:[])],
  limitations:['اختبار رجعي للنموذج بإعداداته المحفوظة عند بدء التجربة؛ ليس توقعًا صدر فعلًا في التاريخ المختار ولا يدخل الدقة الحية أو معايرة النموذج.',
   'العينة من دليل الشركات المتاح عند إنشاء الاختبار، وقد يغيب عنه سهم مشطوب أو تغير اسمه. ليست عينة مؤكدة لجميع الشركات المدرجة في التاريخ القديم، ولا نعتبر تحيز البقاء محلولًا.',
   'قد يعيد المزود تعديل الأسعار التاريخية. نقارن وحدة السعر عند القياس ونستبعد التجزئة داخل الفترة بدل حساب مطابقة مضللة.',
   'لا تُستخدم قوائم أو أخبار اليوم في تاريخ قديم. عند غياب أرشيف سابق يعتمد التوقع على السعر والحجم وسياق السوق المتاح فقط بثقة منخفضة.',
   'المدة عدد جلسات تداول مكتملة بعد سعر الإغلاق المرجعي، لا أيام تقويمية. النتائج عائد سعري دون التوزيعات أو الرسوم.',
   'العينة الصغيرة لا تثبت دقة عامة أو ضمان ربح. الشركات المتعذرة تبقى في الجدول ولا تُستبدل لتحسين النتيجة.']};
 await db.batch([db.prepare('INSERT INTO accuracy_runs(id,created_at,data) VALUES(?,?,?)').bind(v.id,createdAt,JSON.stringify(run)),...sample.companies.map((c,i)=>db.prepare('INSERT INTO accuracy_rows(id,run_id,ordinal,symbol,company,updated_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),v.id,i+1,c.symbol,JSON.stringify(c),createdAt))]);
 return getAccuracyRun(db,v.id);
}

export function sampleSummary(rows:any[]){
 const done=rows.filter(r=>r.state==='complete'&&r.outcome?.state==='complete'),count=done.length;
 const mean=(key:string)=>{const values=done.map(r=>r.outcome[key]).filter((v:any)=>typeof v==='number'&&Number.isFinite(v));return values.length?values.reduce((a:number,b:number)=>a+b,0)/values.length:null;};
 return {total:rows.length,completed:count,failed:rows.filter(r=>r.state==='failed').length,unavailable:rows.filter(r=>r.state==='unavailable').length,excluded:rows.filter(r=>r.state==='excluded').length,pending:rows.filter(r=>['pending','forecasted','waiting'].includes(r.state)).length,
  directionAccuracy:count?done.filter(r=>r.outcome.directionCorrect).length/count*100:null,rangeCoverage:count?done.filter(r=>r.outcome.rangeHit).length/count*100:null,meanMatchPct:mean('matchPct'),meanPriceError:mean('priceErrorPct')};
}

export async function listAccuracyRuns(db:any){const r=await db.prepare('SELECT id,created_at,data FROM accuracy_runs ORDER BY created_at DESC LIMIT 100').all();return (r.results||[]).map((v:any)=>{const d=parse(v.data);return {id:v.id,createdAt:v.created_at,date:d.date,market:d.market,period:d.period,sessions:d.sessions};});}
export async function getAccuracyRun(db:any,id:string){
 if(!goodId(id))throw Error('معرف الاختبار غير صالح.');const r=await db.prepare('SELECT data FROM accuracy_runs WHERE id=?').bind(id).first();if(!r)throw Error('الاختبار غير موجود.');
 const run=parse(r.data),stored=await db.prepare('SELECT * FROM accuracy_rows WHERE run_id=? ORDER BY ordinal').bind(id).all();
 const rows=(stored.results||[]).map((v:any)=>({id:v.id,ordinal:v.ordinal,symbol:v.symbol,company:parse(v.company),state:v.state,forecast:parse(v.forecast),outcome:parse(v.outcome),error:v.error,updatedAt:v.updated_at,processing:v.lease_until>Date.now()}));
 const {settings,universe,...publicRun}=run;
 return {run:{...publicRun,universeCount:universe.length,settingsUsed:{weights:settings.weights,maxSigma:settings.maxSigma,minConfidence:settings.minConfidence}},rows,summary:sampleSummary(rows)};
}

export function historicalPriceUrl(symbol:string,start:string,endInclusive:string){const startSec=Math.floor(Date.parse(start+'T00:00:00Z')/1000),endSec=Math.floor(Date.parse(endInclusive+'T00:00:00Z')/1000)+86400;return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${startSec}&period2=${endSec}&events=splits%2Cdiv`;}
async function historySeries(symbol:string,start:string,end:string,read:typeof upstream,allowIndex=false){
 const data=await read(historicalPriceUrl(symbol,start,end),true,300000),parsed=parseChart(data,end,allowIndex);validateMarketIdentity(parsed.meta,symbol,allowIndex);
 if(parsed.meta.dataGranularity&&parsed.meta.dataGranularity!=='1d')throw Error('فاصل المصدر ليس جلسات يومية.');
 if(!allowIndex&&parsed.meta.instrumentType!=='EQUITY')throw Error('العينة للشركات؛ بيانات المصدر تخص نوع ورقة مختلفًا.');
 const prices=parsed.prices.filter(p=>p.date>=start&&p.date<=end);
 if(!prices.length)throw Error('لا توجد جلسات صالحة للشركة ضمن التاريخ المطلوب من المصدر.');
 const expected=symbol.endsWith('.SR')?'SAR':'USD';if(!allowIndex&&parsed.meta.currency!==expected)throw Error('عملة المصدر لا تطابق سوق الشركة.');
 return {prices,currency:parsed.meta.currency as string,source:data._mizanSource||quoteURL(symbol),corporateActions:parsed.corporateActions.filter(a=>a.date>=start&&a.date<=end),retrievedAt:new Date().toISOString()};
}

const SA_CALENDAR_PROXIES=['2222.SR','1120.SR','2010.SR'];
/** Tadawul session calendar when the provider's ^TASI.SR history is degenerate (single point, verified 2026-10-17):
 *  union of trading dates of liquid large caps. Only the dates are consumed (session counting), never returns. */
async function saudiCalendarSeries(start:string,end:string,read:typeof upstream){
 const got=await Promise.allSettled(SA_CALENDAR_PROXIES.map(s=>historySeries(s,start,end,read)));
 const byDate=new Map<string,Price>();
 for(const g of got)if(g.status==='fulfilled')for(const p of g.value.prices)if(!byDate.has(p.date))byDate.set(p.date,p);
 if(!byDate.size)throw Error('تعذر بناء تقويم جلسات تداول من الشركات المرجعية.');
 return {prices:[...byDate.values()].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0),currency:'SAR',source:quoteURL('^TASI.SR'),corporateActions:[],retrievedAt:new Date().toISOString(),calendar:'TADAWUL-CALENDAR'};
}
/** Market reference for a window: the index when its history covers the window, otherwise (Saudi only) the calendar. */
async function marketSeries(symbol:string,start:string,end:string,read:typeof upstream,minSessions:number){
 const index=await historySeries(symbol,start,end,read,true).catch((e:unknown)=>e instanceof Error?e:Error(String(e)));
 if(!(index instanceof Error)&&index.prices.length>=minSessions)return index;
 if(symbol!=='^TASI.SR'){if(index instanceof Error)throw index;return index;}
 return saudiCalendarSeries(start,end,read);
}

/** Financial observations must have actually been stored before the cutoff, including publication dates. */
export async function pastFinancialInputs(db:any,symbol:string,date:string){
 const cutoff=date+'T23:59:59.999Z',r=await db.prepare("SELECT created_at,data FROM analysis_snapshots WHERE symbol=? AND created_at<=? ORDER BY created_at DESC LIMIT 1").bind(symbol,cutoff).first();
 if(!r)return null;const p=parse(r.data);if(p.company?.symbol!==symbol||!Number.isFinite(Date.parse(p.retrievedAt))||Date.parse(p.retrievedAt)>Date.parse(cutoff)||p.mode==='historical')return null;
 const facts=(p.facts||[]).filter((f:any)=>f.date<=date&&f.publishedAt&&Number.isFinite(Date.parse(f.publishedAt))&&Date.parse(f.publishedAt)<=Date.parse(cutoff)&&!String(f.source).startsWith('ملف المستخدم:'));
 return {facts,currency:p.currency,observedAt:r.created_at};
}

export function historicalReport(company:Company,date:string,series:any,market:any=null,archive:any=null):MarketReport{
 const prices=(series.prices as Price[]).filter(p=>p.date<=date),last=prices.at(-1);
 if(!last||prices.length<20||ageDays(date,last.date)>10)throw Error('لا تتوفر 20 جلسة صالحة قريبة من تاريخ البداية لهذه الشركة.');
 const currency=series.currency;
 const facts=archive?.currency===currency?(archive.facts||[]).filter((f:any)=>f.currency===currency&&f.date<=date&&f.publishedAt&&Date.parse(f.publishedAt)<=Date.parse(date+'T23:59:59.999Z')):[];
 return {company:{...company,sector:'',industry:''},asOf:date,retrievedAt:series.retrievedAt,mode:'historical',prices,currency,priceSource:series.source,quoteTime:null,facts,official:null,news:[],peers:[],regulatory:null,corporateActions:(series.corporateActions||[]).filter((a:any)=>a.date<=date),
  context:{market:market?{...market,prices:market.prices.filter((p:Price)=>p.date<=date)}:null,sector:null},checks:[{name:'الأسعار اليومية',url:series.source,state:'ok',detail:'تحقق الرمز والسوق والعملة؛ لم تدخل جلسة بعد تاريخ القطع في مدخلات التوقع.'}],warnings:[],historicalNote:'إعادة حساب بإعدادات الاختبار على مدخلات حتى التاريخ المختار؛ ليست توصية مسجلة في ذلك اليوم.'};
}

export function evaluateSampleOutcome(saved:any,series:any,sessions:number){
 if(!saved?.available||!Number.isFinite(saved.price)||!Array.isArray(saved.range))return {state:'excluded',reason:'لا يوجد توقع صالح محفوظ للمقارنة.',matchPct:null};
 if(saved.currency!==series.currency)return {state:'excluded',reason:'عملة النتيجة لا تطابق عملة التوقع المحفوظ.',matchPct:null};
 const anchor=series.prices.find((p:Price)=>p.date===saved.anchorDate);
 if(!anchor)return {state:'waiting',reason:'لم يرجع المصدر جلسة الأساس للتحقق من وحدة السعر.',matchPct:null};
 const dates=(series.sessionDates||[]).filter((d:string)=>d>saved.anchorDate);
 if(!series.sessionDates)return {state:'waiting',reason:'لم تتوفر جلسات مرجع السوق للتحقق من اكتمال المدة؛ لم نحسب مطابقة نهائية.',matchPct:null};
 if(dates.length<sessions)return {state:'waiting',reason:`اكتملت ${dates.length} من ${sessions} جلسة في مرجع السوق؛ الفترة لم تكتمل بعد أو بياناتها ناقصة.`,observedSessions:dates.length,matchPct:null};
 const required=dates.slice(0,sessions),path=required.map((d:string)=>series.prices.find((p:Price)=>p.date===d));
 if(path.some((p:Price|undefined)=>!p))return {state:'waiting',reason:'توجد جلسات مفقودة للشركة داخل المدة؛ لا نمدد الاختبار إلى تاريخ لاحق لتعويضها.',matchPct:null};
 const actual=path.at(-1)!;
 if(Math.abs(anchor.close/saved.price-1)>.0005)return {state:'excluded',reason:'تغير السعر التاريخي المرجعي لدى المزود؛ يلزم التحقق من تعديل السلسلة قبل حساب المطابقة.',matchPct:null};
 if(series.corporateActions.some((a:any)=>a.kind==='split'&&a.date>saved.anchorDate&&a.date<=actual.date))return {state:'excluded',reason:'حدثت تجزئة أو تجميع داخل الفترة؛ استُبعد القياس لحين مراجعة وحدات الأسعار.',matchPct:null};
 const metrics=forecastMetrics({reference:saved.price,predicted:saved.predictedPrice,actual:actual.close,range:saved.range,direction:saved.direction,neutralThresholdPct:saved.neutralThresholdPct??1}),change=metrics.actualChangePct,actualDirection=metrics.actualDirection;
 const outcome={state:'complete',actualDate:actual.date,actualPrice:actual.close,actualDirection,changePct:change,periodLow:Math.min(...path.map((p:Price)=>p.low)),periodHigh:Math.max(...path.map((p:Price)=>p.high)),directionCorrect:actualDirection===saved.direction,rangeHit:actual.close>=saved.range[0]&&actual.close<=saved.range[1],priceErrorPct:forecastMetrics({reference:saved.price,predicted:saved.predictedPrice,actual:actual.close,range:saved.range,direction:saved.direction,neutralThresholdPct:saved.neutralThresholdPct??1}).relativeErrorPct,source:series.source,retrievedAt:series.retrievedAt};
 return {...outcome,...forecastMatch(saved,outcome),observedSessions:sessions};
}

/** Forecast and measurement are separate requests; the forecast commits before any outcome fetch. */
export async function processAccuracyRow(db:any,runId:string,rowId:string,action:'forecast'|'measure',read:typeof upstream=upstream,now=Date.now()){
 if(!goodId(runId)||!goodId(rowId))throw Error('معرف الصف أو الاختبار غير صالح.');
 const runRow=await db.prepare('SELECT data FROM accuracy_runs WHERE id=?').bind(runId).first(),row=await db.prepare('SELECT * FROM accuracy_rows WHERE id=? AND run_id=?').bind(rowId,runId).first();if(!runRow||!row)throw Error('لم يُعثر على الشركة ضمن هذا الاختبار.');
 if(action==='forecast'&&row.forecast||action==='measure'&&['complete','excluded'].includes(row.state))return getAccuracyRun(db,runId);
 if(action==='measure'&&!parse(row.forecast)?.available)throw Error('يجب حفظ توقع صالح قبل طلب النتيجة الفعلية.');
 const lease=crypto.randomUUID();await db.prepare('UPDATE accuracy_rows SET lease_token=?,lease_until=? WHERE id=? AND lease_until<=?').bind(lease,now+120000,row.id,now).run();
 const claimed=await db.prepare('SELECT lease_token,forecast,outcome FROM accuracy_rows WHERE id=?').bind(row.id).first();if(claimed?.lease_token!==lease)throw Error('هذه الشركة قيد المعالجة الآن؛ انتظر قليلًا ثم تابع.');
 // Another request may have committed while this request was acquiring its lease.
 if(action==='forecast'&&claimed.forecast||action==='measure'&&['complete','excluded'].includes(parse(claimed.outcome)?.state)){await db.prepare('UPDATE accuracy_rows SET lease_token=\'\',lease_until=0 WHERE id=? AND lease_token=?').bind(row.id,lease).run();return getAccuracyRun(db,runId);}
 const run=parse(runRow.data),company=parse(row.company);let stage='failed';
 try{
  if(action==='forecast'){
   const start=isoDay(Date.parse(run.date)-5*366*day),symbol=company.symbol.endsWith('.SR')?'^TASI.SR':'^GSPC';
   const parts=await Promise.allSettled([historySeries(company.symbol,start,run.date,read),marketSeries(symbol,start,run.date,read,20),pastFinancialInputs(db,company.symbol,run.date)]);
   if(parts[0].status==='rejected')throw parts[0].reason;
   const market=parts[1].status==='fulfilled'?{symbol,name:company.symbol.endsWith('.SR')?'تاسي':'S&P 500',prices:parts[1].value.prices,source:parts[1].value.source}:null;
   const archive=parts[2].status==='fulfilled'?parts[2].value:null,report=historicalReport(company,run.date,parts[0].value,market,archive),settings=validateSettings(run.settings);
   const projected=forecasts(report,null,Date.parse(run.date+'T23:59:59.999Z'),settings,[{name:run.period,sessions:run.sessions}]);
   const saved={...projected.rows[0],anchorDate:report.prices.at(-1)!.date,price:projected.price,currency:report.currency,priceTime:'إغلاق '+report.prices.at(-1)!.date+' — وقت التنفيذ بالدقيقة غير متاح',model:projected.version,computedAt:new Date(now).toISOString(),cutoff:run.date,source:report.priceSource,financialArchiveTime:archive?.observedAt||null};
   stage=saved.available?'forecasted':'unavailable';
   await db.prepare('UPDATE accuracy_rows SET forecast=?,inputs=?,state=?,error=\'\',updated_at=? WHERE id=? AND lease_token=? AND forecast IS NULL').bind(JSON.stringify(saved),JSON.stringify({report,settingsUsed:projected.settingsUsed,financialArchiveTime:archive?.observedAt||null,contextErrors:parts.slice(1).flatMap(p=>p.status==='rejected'?[failure(p.reason)]:[])}),stage,new Date(now).toISOString(),row.id,lease).run();
  }else{
   const saved=parse(claimed.forecast),end=isoDay(Math.min(Date.parse(lastCompleteDay(now)),Date.parse(saved.anchorDate)+(run.sessions*2+40)*day));
   const marketSymbol=row.symbol.endsWith('.SR')?'^TASI.SR':'^GSPC';
   const results=await Promise.allSettled([historySeries(row.symbol,saved.anchorDate,end,read),marketSeries(marketSymbol,saved.anchorDate,end,read,0)]);
   if(results[0].status==='rejected')throw results[0].reason;
   // Degenerate index history (fewer dated bars than the company in the same window) → Saudi session calendar.
   if(marketSymbol==='^TASI.SR'&&(results[1].status==='rejected'||results[1].value.prices.length<results[0].value.prices.length))results[1]=await Promise.allSettled([saudiCalendarSeries(saved.anchorDate,end,read)]).then(x=>x[0]);
   const series={...results[0].value,sessionDates:results[1].status==='fulfilled'?results[1].value.prices.map(p=>p.date):null};
   const outcome=evaluateSampleOutcome(saved,series,run.sessions);stage=outcome.state;
   await db.prepare('UPDATE accuracy_rows SET outcome=?,state=?,error=\'\',updated_at=? WHERE id=? AND lease_token=?').bind(JSON.stringify({...outcome,evaluatedAt:new Date(now).toISOString()}),stage,new Date(now).toISOString(),row.id,lease).run();
  }
 }catch(e){
  // The provider has no data at all for this symbol (404, e.g. delisted/merged): terminal, otherwise one dead row
  // keeps the sample "pending" forever and the daily cron never creates a new sample.
  const msg=failure(e),terminal=/\(404\)/.test(msg);
  await db.prepare('UPDATE accuracy_rows SET state=?,error=?,updated_at=? WHERE id=? AND lease_token=?').bind(terminal?'unavailable':'failed',msg,new Date(now).toISOString(),row.id,lease).run();}
 finally{await db.prepare('UPDATE accuracy_rows SET lease_token=\'\',lease_until=0 WHERE id=? AND lease_token=?').bind(row.id,lease).run();}
 return getAccuracyRun(db,runId);
}
