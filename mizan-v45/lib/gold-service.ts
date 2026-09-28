import {GOLD_FRAMES,GOLD_SOURCE_INFO,goldFreshness,parseGoldFx,parseGoldQuote,parseGoldSeries,type GoldFrame,type GoldFx,type GoldProvider,type GoldQuote,type GoldSeries,type Karat} from './gold-core';
import {resolveGoldCredentials} from './gold-credentials';
import {requestGoldJson,GoldRequestError,type GoldFailureCode} from './gold-request';
export type GoldSettings={primary:GoldProvider;backup:GoldProvider;enabled:Record<GoldProvider,boolean>;pollSeconds:number;maxDelaySeconds:number;cacheSeconds:number;monthlyRequestCap:number;fxEnabled:boolean;chartEnabled:boolean;karats:Karat[];sections:{calculator:boolean;chart:boolean;sources:boolean}};
export const DEFAULT_GOLD_SETTINGS:GoldSettings={primary:'goldapi',backup:'metalsdev',enabled:{goldapi:true,metalsdev:true},pollSeconds:15,maxDelaySeconds:900,cacheSeconds:60,monthlyRequestCap:100,fxEnabled:true,chartEnabled:true,karats:[24,21,18],sections:{calculator:true,chart:true,sources:true}};
export type GoldRuntime={DB:any;GOLDAPI_KEY?:string;METALS_DEV_API_KEY?:string;MIZAN_PROVIDER_VAULT_KEY?:string;metalsCredentialError?:string;TWELVE_DATA_API_KEY?:string;GOLDAPI_DISPLAY_APPROVED?:string;METALS_DEV_DISPLAY_APPROVED?:string;TWELVE_DATA_GOLD_DISPLAY_APPROVED?:string;TWELVE_DATA_GOLD_TROY_OUNCE_VERIFIED?:string};
export type GoldDiagnostic={code:GoldFailureCode;httpStatus?:number;attempts:number;checkedAt:string};
export type GoldStatus={id:string;state:'works'|'partial'|'failed'|'needs_setup'|'disabled';message:string;checkedAt:string;lastSuccess?:string;sourceUrl:string;diagnostic?:GoldDiagnostic};
export async function goldRead<T>(db:any,id:string):Promise<T|null>{const r=await db.prepare('SELECT data FROM gold_state WHERE id=?').bind(id).first();return r?JSON.parse(r.data):null;}
export async function goldWrite(db:any,id:string,data:unknown){await db.prepare('INSERT INTO gold_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(id,JSON.stringify(data),new Date().toISOString()).run();}
export async function goldSettings(db:any){return await goldRead<GoldSettings>(db,'settings')??structuredClone(DEFAULT_GOLD_SETTINGS);}
export function validateGoldSettings(v:any):GoldSettings{
  const ids=['goldapi','metalsdev'];if(!ids.includes(v?.primary)||!ids.includes(v.backup)||v.primary===v.backup)throw Error('اختر مصدرًا رئيسيًا وبديلًا مختلفين.');
  for(const [key,min,max] of [['pollSeconds',15,3600],['maxDelaySeconds',60,900],['cacheSeconds',30,3600],['monthlyRequestCap',1,100000]] as const)if(!Number.isInteger(v[key])||v[key]<min||v[key]>max)throw Error('قيمة غير صالحة: '+key);
  if(!Array.isArray(v.karats)||v.karats.length===0||v.karats.length>3||v.karats.some((k:number)=>![24,21,18].includes(k)))throw Error('اختر عيارًا واحدًا على الأقل.');
  if(['goldapi','metalsdev'].some(k=>typeof v.enabled?.[k]!=='boolean')||['calculator','chart','sources'].some(k=>typeof v.sections?.[k]!=='boolean')||typeof v.fxEnabled!=='boolean'||typeof v.chartEnabled!=='boolean')throw Error('إعدادات العرض والمصادر غير صالحة.');
  return {primary:v.primary,backup:v.backup,enabled:{goldapi:v.enabled.goldapi,metalsdev:v.enabled.metalsdev},pollSeconds:v.pollSeconds,maxDelaySeconds:v.maxDelaySeconds,cacheSeconds:v.cacheSeconds,monthlyRequestCap:v.monthlyRequestCap,fxEnabled:v.fxEnabled,chartEnabled:v.chartEnabled,karats:[...new Set(v.karats)] as Karat[],sections:{calculator:v.sections.calculator,chart:v.sections.chart,sources:v.sections.sources}};
}
export async function saveGoldSettings(db:any,next:GoldSettings,action:string){
  const old=await goldSettings(db),now=new Date().toISOString(),id=crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO gold_state(id,data,updated_at) VALUES(?,?,?)').bind('settings-history:'+id,JSON.stringify({old,next,action,at:now}),now),
    db.prepare('INSERT INTO gold_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind('settings',JSON.stringify(next),now),
    db.prepare('INSERT INTO admin_audit(id,created_at,action,data) VALUES(?,?,?,?)').bind(id,now,'gold:'+action,JSON.stringify({old,next})),
  ]);return next;
}
export function goldSetup(runtime:GoldRuntime,settings:GoldSettings):GoldStatus[]{
  const now=new Date().toISOString();return (['goldapi','metalsdev','twelvedata','exchangerate'] as const).map(id=>{
    const active=id==='exchangerate'?settings.fxEnabled:id==='twelvedata'?settings.chartEnabled:settings.enabled[id];
    const key=id==='goldapi'?runtime.GOLDAPI_KEY:id==='metalsdev'?runtime.METALS_DEV_API_KEY:id==='twelvedata'?runtime.TWELVE_DATA_API_KEY:'public';
    const approved=id==='goldapi'?runtime.GOLDAPI_DISPLAY_APPROVED:id==='metalsdev'?runtime.METALS_DEV_DISPLAY_APPROVED:id==='twelvedata'?runtime.TWELVE_DATA_GOLD_DISPLAY_APPROVED:'true';
    const missing=id==='metalsdev'&&runtime.metalsCredentialError?runtime.metalsCredentialError:!key?(id==='metalsdev'?'أدخل مفتاح Metals.dev من إدارة ميزان.':`يلزم إعداد ${GOLD_SOURCE_INFO[id].key} على الخادم.`):approved!=='true'?'يلزم تأكيد حقوق عرض البيانات ضمن خطة المزود.':id==='twelvedata'&&runtime.TWELVE_DATA_GOLD_TROY_OUNCE_VERIFIED!=='true'?'يلزم توثيق أن XAU/USD بالدولار لكل أونصة ترويسية قبل استخدام الشموع.':'';
    return {id,state:!active?'disabled':missing?'needs_setup':'partial',message:!active?'متوقف من إعدادات الذهب.':missing||'مهيأ؛ لم يثبت نجاح قراءة البيانات بعد.',checkedAt:now,sourceUrl:GOLD_SOURCE_INFO[id].url};
  });
}
const requestJson=requestGoldJson;
type Cache<T>={data:T|null;expires:number;error:string;fetchedAt:string;diagnostic?:GoldDiagnostic};
// Cross-request D1 lease + monthly budget: reloading or multiple visitors cannot
// turn a 15-second browser poll into unbounded paid provider calls.
async function cached<T>(db:any,id:string,ttl:number,cap:number,load:()=>Promise<T>):Promise<Cache<T>>{
  const now=Date.now(),old=await goldRead<Cache<T>>(db,'cache:'+id);
  if(old&&old.expires>now)return old;
  const token=crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO gold_locks(id,until_ms,token) VALUES(?,0,\'\')').bind(id).run();
  const lock=await db.prepare('UPDATE gold_locks SET until_ms=?,token=? WHERE id=? AND until_ms<? RETURNING id').bind(now+35000,token,id,now).first();
  if(!lock)return old?{...old,error:old.error||'جارٍ تحديث المصدر.'}:{data:null,expires:0,error:'جارٍ تحديث المصدر.',fetchedAt:''};
  let attempts=0;
  try{
    const quotaId=id.split(':')[0]+':'+new Date(now).toISOString().slice(0,7);
    await db.prepare('INSERT OR IGNORE INTO gold_budgets(id,requests) VALUES(?,0)').bind(quotaId).run();
    while(true){
      const budget=await db.prepare('UPDATE gold_budgets SET requests=requests+1 WHERE id=? AND requests<? RETURNING requests').bind(quotaId,cap).first();
      if(!budget)throw Error('بلغ المصدر سقف الطلبات الشهري الذي حدده المدير.');
      attempts++;
      let data:T;
      try{data=await load();}catch(e){if(attempts<2&&e instanceof GoldRequestError&&e.retryable)continue;throw e;}
      const value={data,expires:Date.now()+ttl*1000,error:'',fetchedAt:new Date().toISOString()};await goldWrite(db,'cache:'+id,value);return value;
    }
  }catch(e){const error=e instanceof Error?e.message:'تعذر جلب المصدر.';const diagnostic=e instanceof GoldRequestError?{code:e.code,httpStatus:e.httpStatus,attempts,checkedAt:new Date().toISOString()}:undefined;const value={data:old?.data??null,expires:Date.now()+Math.max(60,ttl)*1000,error,fetchedAt:old?.fetchedAt??'',diagnostic};await goldWrite(db,'cache:'+id,value);return value;
  }finally{await db.prepare('UPDATE gold_locks SET until_ms=0 WHERE id=? AND token=?').bind(id,token).run();}
}
async function saveStatus(db:any,status:GoldStatus){await goldWrite(db,'status:'+status.id,status);}
export async function getGoldQuote(runtime:GoldRuntime,settings:GoldSettings,loader=requestJson){
  runtime=await resolveGoldCredentials(runtime);
  const setup=goldSetup(runtime,settings),statuses:GoldStatus[]=[];let quote:GoldQuote|null=null,oldestFallback:GoldQuote|null=null;
  for(const id of [settings.primary,settings.backup]){
    const state=setup.find(s=>s.id===id)!;
    if(state.state!=='partial'){statuses.push(state);continue;}
    const c=await cached<GoldQuote>(runtime.DB,id+':quote',settings.cacheSeconds,settings.monthlyRequestCap,async()=>{
      const raw=id==='goldapi'?await loader('https://www.goldapi.io/api/price/XAU/USD',{'x-access-token':runtime.GOLDAPI_KEY!}):await loader('https://api.metals.dev/v1/metal/spot?metal=gold&currency=USD&api_key='+encodeURIComponent(runtime.METALS_DEV_API_KEY!));
      if(id==='metalsdev'&&raw?.status==='failure')throw Error(raw.error_code===1101?'مفتاح Metals.dev غير صحيح.':raw.error_code===1203?'استهلكت حصة Metals.dev المتاحة لهذه الفترة.':[1201,1202].includes(raw.error_code)?'حساب Metals.dev أو اشتراكه غير فعال.':'رفض Metals.dev الطلب؛ راجع إعداد الاتصال.');
      return parseGoldQuote(id,raw);
    });
    const fresh=goldFreshness(c.data,settings.maxDelaySeconds);
    const status:GoldStatus={...state,state:c.error?'failed':fresh.usable?'works':'partial',message:c.error||fresh.label,lastSuccess:c.fetchedAt,diagnostic:c.diagnostic};statuses.push(status);await saveStatus(runtime.DB,status);
    if(c.data&&(!oldestFallback||c.data.quoteTime>oldestFallback.quoteTime))oldestFallback=c.data;
    if(c.data&&fresh.usable&&!c.error){quote=c.data;break;}
  }
  if(quote){const previous=await goldRead<GoldQuote>(runtime.DB,'last-quote');
    if(previous&&previous.source!==quote.source)await goldWrite(runtime.DB,'source-switch:'+crypto.randomUUID(),{at:new Date().toISOString(),from:previous.source,to:quote.source,previousTime:previous.quoteTime,currentTime:quote.quoteTime,reason:statuses.filter(s=>s.id!==quote!.source),note:'اختلاف التغذية ليس دليلًا مستقلًا على حركة السوق.'});
    await goldWrite(runtime.DB,'last-quote',quote);
  }
  const current=quote??oldestFallback??await goldRead<GoldQuote>(runtime.DB,'last-quote');
  return {quote:current,current:!!quote,statuses,notice:quote?(quote.source!==settings.primary?'تم استخدام المصدر الاحتياطي':''):current?'تعذر التحديث — المعروض آخر سعر معروف مؤرخ.':'لم يصل سعر ذهب صالح؛ راجع حالة المصادر.'};
}
export async function getGoldFx(runtime:GoldRuntime,settings:GoldSettings){
  if(!settings.fxEnabled)return {fx:null,status:{id:'exchangerate',state:'disabled',message:'مرجع الصرف متوقف من الإدارة.',sourceUrl:GOLD_SOURCE_INFO.exchangerate.url} as GoldStatus};
  const c=await cached<GoldFx>(runtime.DB,'exchangerate:USD-SAR',21600,150,async()=>parseGoldFx(await requestJson('https://open.er-api.com/v6/latest/USD')));
  const valid=c.data&&Date.now()-Date.parse(c.data.priceTime)<=48*3600000;
  const status:GoldStatus={id:'exchangerate',state:c.error?'failed':valid?'works':'partial',message:c.error||'مرجع صرف يومي؛ ليس تغذية لحظية.',checkedAt:new Date().toISOString(),lastSuccess:c.fetchedAt,sourceUrl:GOLD_SOURCE_INFO.exchangerate.url};await saveStatus(runtime.DB,status);
  return {fx:valid?c.data:null,status};
}
export async function getGoldSeries(runtime:GoldRuntime,settings:GoldSettings,frame:GoldFrame){
  if(!GOLD_FRAMES.includes(frame))throw Error('إطار زمني غير مدعوم.');
  const setup=goldSetup(runtime,settings).find(s=>s.id==='twelvedata')!;if(setup.state!=='partial')return {series:null,status:setup};
  const c=await cached<GoldSeries>(runtime.DB,'twelvedata:'+frame,['1day','1week','1month'].includes(frame)?3600:60,settings.monthlyRequestCap,async()=>parseGoldSeries(await requestJson('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval='+frame+'&outputsize=300&timezone=UTC&order=asc&apikey='+encodeURIComponent(runtime.TWELVE_DATA_API_KEY!)),frame));
  const status:GoldStatus={...setup,state:c.error?'failed':c.data?'works':'partial',message:c.error||'شموع المصدر الأصلية؛ توقيتها وقت بداية الشمعة.',lastSuccess:c.fetchedAt};await saveStatus(runtime.DB,status);
  return {series:c.data,status};
}
