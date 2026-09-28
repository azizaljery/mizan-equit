import {SUPPORTING_SOURCES} from './supporting-sources';
import {SOURCE_CANDIDATES,candidateMetadata,type SourceMetadata} from './source-catalog';
export type SourceConfig={id:string;name:string;url:string;enabled:boolean;deleted:boolean;priority:number;authority:'official'|'secondary';kind:'prices'|'financials'|'news'|'general';adapter:'builtin'|'reference'|'chart-json'|'alpaca';metadata?:SourceMetadata};
export type SectionConfig={id:string;title:string;visible:boolean;deleted:boolean;audience:'everyone'|'owner'};
export const HOME_SECTIONS=[['search','البحث عن الشركة'],['ask','اسأل ميزان'],['welcome','خطوات التحليل'],['company','نتيجة التحليل'],['files','إضافة ملف — اختياري'],['sources','المراجع الإضافية'],['workspace','متابعة وقياس ميزان'],['sample','اختبار عينة من 20 شركة']];
export const COMPANY_SECTIONS=[['decision','غرفة القرار'],['changes','ماذا تغير منذ آخر تحليل؟'],['pulse','نبض الشركة'],['summary','الخلاصة التحليلية'],['executive','الملخص التنفيذي'],['fundamental','التحليل الأساسي'],['valuation','التحليل المالي والتقييم'],['chart','الشارت والتحليل الفني'],['liquidity','السيولة والتذبذب'],['news','الأخبار والإعلانات'],['risk','المخاطر'],['gaps','ما الذي لم يتم التحقق منه؟'],['sources','المصادر وطريقة احتساب الدرجة'],['strengths','نقاط القوة والضعف'],['forecasts','التوقعات المستقبلية'],['temporal','المختبر الزمني'],['conclusion','خلاصة ميزان'],['paper','المحفظة الوهمية'],['private','ميزان الخاص']];
export const sectionDefaults=(rows:string[][]):SectionConfig[]=>rows.map(([id,title])=>({id,title,visible:true,deleted:false,audience:'everyone'}));
export const DEFAULT_SOURCE_CONFIG:SourceConfig[]=[
 {id:'tadawul',name:'تداول السعودية',url:'https://www.saudiexchange.sa/wps/portal/saudiexchange/ourmarkets/main-market-watch?locale=ar',authority:'official',kind:'financials',adapter:'builtin',enabled:true,deleted:false,priority:1},
 {id:'sec',name:'هيئة الأوراق المالية الأمريكية SEC',url:'https://www.sec.gov/edgar/search/',authority:'official',kind:'financials',adapter:'builtin',enabled:true,deleted:false,priority:2},
 {id:'yahoo',name:'Yahoo Finance',url:'https://finance.yahoo.com/',authority:'secondary',kind:'prices',adapter:'builtin',enabled:true,deleted:false,priority:3},
 ...SUPPORTING_SOURCES.filter(s=>!s.official).map((s,i)=>({id:s.id,name:s.name,url:s.url,authority:'secondary' as const,kind:'general' as const,adapter:'reference' as const,enabled:true,deleted:false,priority:i+4}))
];
for(const source of DEFAULT_SOURCE_CONFIG)source.metadata=candidateMetadata(source.id);
for(const c of SOURCE_CANDIDATES)if(!DEFAULT_SOURCE_CONFIG.some(s=>s.id===c.id))DEFAULT_SOURCE_CONFIG.push({id:c.id,name:c.name,url:c.url,authority:c.authority,kind:c.kind,adapter:c.id==='alpaca'?'alpaca':'reference',enabled:false,deleted:false,priority:DEFAULT_SOURCE_CONFIG.length+1,metadata:candidateMetadata(c.id)});
export function safeSourceUrl(raw:string){
 if(typeof raw!=='string'||raw.length>1500)throw Error('رابط المصدر غير صالح.');
 const u=new URL(raw.replaceAll('{symbol}','AAPL'));
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hash)throw Error('استخدم رابط HTTPS عامًا بلا بيانات دخول أو منفذ خاص.');
 const host=u.hostname.toLowerCase();
 if(!/^(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/.test(host)||/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host)||/\.(localdomain|nip\.io|sslip\.io)$/.test(host))throw Error('لا يُسمح بعنوان محلي أو داخلي.');
 if([...u.searchParams.keys()].some(k=>/token|secret|password|api.?key|signature|credential/i.test(k)))throw Error('لا تضع مفاتيح سرية في رابط المصدر.');
 return raw.trim();
}
export function normalizeSourceConfig(input:unknown,legacy:Record<string,boolean>):SourceConfig[]{
 if(!Array.isArray(input)||input.length>100)throw Error('الحد الأقصى 100 مصدر؛ يشمل المرشحين والاتصالات المحفوظة.');
 const seen=new Set<string>();
 const rows=input.map((v:any)=>{
  if(!v||!/^[-a-z0-9]{1,60}$/.test(v.id)||seen.has(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||!Number.isInteger(v.priority)||v.priority<1||v.priority>100||!['official','secondary'].includes(v.authority)||!['prices','financials','news','general'].includes(v.kind)||!['builtin','reference','chart-json','alpaca'].includes(v.adapter)||typeof v.enabled!=='boolean'||typeof v.deleted!=='boolean')throw Error('راجع الاسم والنوع والأولوية وحالة المصدر.');
  seen.add(v.id);safeSourceUrl(v.url);
  const builtin=DEFAULT_SOURCE_CONFIG.find(s=>s.id===v.id&&s.adapter==='builtin');
  if(v.adapter==='builtin'&&!builtin)throw Error('المصدر الجديد يحتاج رابط مراجعة أو رابط أسعار JSON.');
  if(builtin&&(v.url!==builtin.url||v.adapter!=='builtin'))throw Error('عنوان الاتصال للمصدر المدمج ثابت؛ أضف مصدرًا مستقلًا للرابط الجديد.');
  if(v.adapter==='chart-json'&&(v.kind!=='prices'||!v.url.includes('{symbol}')))throw Error('رابط الأسعار JSON يجب أن يحتوي {symbol} ونوعه أسعار.');
  if(v.adapter==='alpaca'&&(v.id!=='alpaca'||v.kind!=='prices'||v.url!==SOURCE_CANDIDATES.find(c=>c.id==='alpaca')!.url))throw Error('اتصال Alpaca مرتبط بعنوانه الموثق فقط؛ لا تُرسل المفاتيح إلى مصدر قابل للتبديل.');
  let metadata=v.metadata||candidateMetadata(v.id);
  if(metadata){
   if(!['sa','us','global'].includes(metadata.market)||!['public-api','licensed-api','document','reference'].includes(metadata.access)||!Array.isArray(metadata.dataTypes)||metadata.dataTypes.length>12||metadata.dataTypes.some((x:any)=>typeof x!=='string'||x.length>80)||typeof metadata.licenseRequired!=='boolean'||typeof metadata.keyRequired!=='boolean'||metadata.delayMinutes!==null&&(!Number.isFinite(metadata.delayMinutes)||metadata.delayMinutes<0||metadata.delayMinutes>1440))throw Error('بيانات ربط المصدر غير صالحة.');
   for(const key of ['setup','coverage','symbolMapping','fieldMapping','lineage'])if(typeof metadata[key]!=='string'||metadata[key].length>1200)throw Error('وصف إعداد المصدر غير صالح.');
   if(metadata.docsUrl)safeSourceUrl(metadata.docsUrl);
   metadata={market:metadata.market,access:metadata.access,dataTypes:[...metadata.dataTypes],docsUrl:metadata.docsUrl||'',setup:metadata.setup,licenseRequired:metadata.licenseRequired,keyRequired:metadata.keyRequired,coverage:metadata.coverage,delayMinutes:metadata.delayMinutes,symbolMapping:metadata.symbolMapping,fieldMapping:metadata.fieldMapping,lineage:metadata.lineage};
  }
  return {id:v.id,name:v.name.trim(),url:v.url.trim(),enabled:builtin?legacy[v.id]!==false&&!v.deleted:v.enabled,deleted:v.deleted,priority:v.priority,authority:v.authority,kind:v.kind,adapter:v.adapter,metadata} as SourceConfig;
 });
 // Missing built-ins are retained on upgrades; removal is an explicit reversible tombstone.
 for(const s of DEFAULT_SOURCE_CONFIG.filter(s=>s.adapter==='builtin'))if(!seen.has(s.id))rows.push({...s,enabled:legacy[s.id]!==false});
 // Add candidate metadata on upgrade; never resurrect a saved disabled/deleted entry.
 for(const s of DEFAULT_SOURCE_CONFIG.filter(s=>SOURCE_CANDIDATES.some(c=>c.id===s.id)))if(!rows.some(r=>r.id===s.id))rows.push({...s,enabled:false});
 return rows;
}
export function normalizeSections(input:unknown,defaults:string[][]){
 // Earlier saved company layouts include the retired sharia section. Validate
 // it before omitting it from the runtime view; never rewrite saved settings here.
 const retired=defaults===COMPANY_SECTIONS?['sharia']:[];
 if(!Array.isArray(input)||input.length>defaults.length+retired.length)throw Error('أقسام الصفحة غير صالحة.');
 const seen=new Set<string>();const rows=input.map((s:any)=>{if(!s||(!defaults.some(([id])=>id===s.id)&&!retired.includes(s.id))||seen.has(s.id)||typeof s.title!=='string'||!s.title.trim()||s.title.length>100||typeof s.visible!=='boolean'||typeof s.deleted!=='boolean'||!['everyone','owner'].includes(s.audience))throw Error('راجع اسم القسم وظهوره وصلاحياته.');seen.add(s.id);return {id:s.id,title:s.id==='private'?'ميزان الخاص':s.title.trim(),visible:s.visible,deleted:s.deleted,audience:s.audience} as SectionConfig}).filter(s=>!retired.includes(s.id));return [...rows,...sectionDefaults(defaults).filter(s=>!seen.has(s.id))];
}
export function settingChanges(before:any,after:any,path=''): {field:string;oldValue:any;newValue:any}[]{
 if(JSON.stringify(before)===JSON.stringify(after))return [];
 if(path==='updatedAt')return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>settingChanges(before[k],after[k],path?path+'.'+k:k));
 return [{field:path,oldValue:before??null,newValue:after??null}];
}
