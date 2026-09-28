import {htmlText,parseSaudiProfile,type MarketReport,type Fact,type News} from './market-data';
import {readSECInlineDocument,readSECEventDocument,type FilingDocument} from './sec-documents';
import {safeSourceUrl} from './admin-config';
import {readExternalSource} from './source-probe';
import {configuredReader} from './source-status';
import {readSettings,type SiteSettings} from './site-settings';
import {readDiscoverySettings,reserveSearch,recordSearchUsage} from './discovery-budget';
import {canonicalEvidenceUrl,fingerprint,initialEvidence,newsEvidence,missingInformation,mergeVerifiedNews,type ResearchTrace,type ResearchAttempt} from './evidence-ledger';

const ISSUER_HOSTS:Record<string,string[]>={'2222.SR':['www.aramco.com','www.aramco.com.sa'],'7010.SR':['www.stc.com.sa'],'4190.SR':['www.jarir.com','www.jarir.com.sa'],'AAPL':['investor.apple.com','www.apple.com'],'MSFT':['www.microsoft.com']};
const ISSUER_SOURCE_IDS:Record<string,string>={'2222.SR':'aramco-ir','7010.SR':'stc-ir','4190.SR':'jarir-ir','AAPL':'apple-ir','MSFT':'microsoft-ir'};
const APPROVED_HOSTS=['www.sec.gov','data.sec.gov','www.saudiexchange.sa',...Object.values(ISSUER_HOSTS).flat()];
export function approvedResearchUrl(raw:string,symbol:string){safeSourceUrl(raw);const u=new URL(raw),allowed=[symbol.endsWith('.SR')?'www.saudiexchange.sa':'www.sec.gov',...(ISSUER_HOSTS[symbol]||[])];if(!APPROVED_HOSTS.includes(u.hostname)||!allowed.includes(u.hostname))throw Error('المستند عُثر عليه لكن ناشره لم يُتحقق لهذه الشركة؛ لم تُرسل إليه بيانات أو يُستخدم في التوقع.');return canonicalEvidenceUrl(raw);}
export function researchQueries(report:MarketReport,missing:string[]){const year=report.asOf.slice(0,4),symbol=report.company.symbol.replace('.SR',''),name=(report.company.nameEn||report.company.name).replace(/[\r\n<>]/g,' ').slice(0,140);return [missing.some(k=>k!=='news_context')?`${name} ${symbol} ${year} annual quarterly financial statements operating cash flow debt`:`${name} ${symbol} earnings risks material disclosures ${year}`,report.company.symbol.endsWith('.SR')?`${report.company.name.slice(0,140)} ${symbol} ${year} نتائج مالية إفصاحات مخاطر خسائر تدفقات نقدية`:`${name} ${symbol} ${year} results risk factors losses material events`];}
export class DiscoveryError extends Error{constructor(public code:string,message:string,public retryAfter:string|null=null){super(message);}}
export async function discoverUrls(query:string,domains:string[],fetcher:typeof fetch=fetch,apiKey?:string){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{const r=await fetcher('https://api.tavily.com/search',{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json',...(apiKey?.trim()?{Authorization:'Bearer '+apiKey.trim()}:{'X-Tavily-Access-Mode':'keyless'})},body:JSON.stringify({query,search_depth:'basic',auto_parameters:false,topic:'general',max_results:5,include_domains:domains,include_domains_mode:'filter',include_answer:false,include_raw_content:false,include_images:false,include_usage:true})});
  if([429,432,433].includes(r.status))throw new DiscoveryError('quota','بلغ الباحث حد المزود؛ توقفت طلبات البحث فقط، وتستمر المصادر المباشرة.',r.headers.get('retry-after'));
  if([401,403].includes(r.status))throw new DiscoveryError('access',apiKey?.trim()?'لم يقبل المزود صلاحية مفتاح البحث على الخادم؛ لم تُغيّر خطة الحساب.':'لم يسمح المزود بوصول البحث بلا مفتاح من هذا الخادم. يمكن إعداد مفتاح حساب مسموح؛ لم يُفعّل دفع تلقائي.');
  if(!r.ok)throw new DiscoveryError('connection','تعذر الوصول إلى الباحث (HTTP '+r.status+').');
  if(Number(r.headers.get('content-length'))>1000000)throw new DiscoveryError('schema','استجابة الباحث أكبر من الحد.');
  const reader=r.body?.getReader();if(!reader)throw new DiscoveryError('schema','لم يصل محتوى من الباحث.');let size=0;const chunks:Uint8Array[]=[];for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>1000000){await reader.cancel();throw new DiscoveryError('schema','استجابة الباحث أكبر من الحد.');}chunks.push(v.value);}const bytes=new Uint8Array(size);let offset=0;for(const v of chunks){bytes.set(v,offset);offset+=v.length;}
  let data:any;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new DiscoveryError('schema','المزود لم يُرجع نتائج بحث منظمة.');}
  if(!Array.isArray(data.results))throw new DiscoveryError('schema','لم تصل نتائج بحث منظمة؛ تعليمات المزود النصية لا تُنفذ.');
  // Deliberately discard provider answer, relevance score, raw content and snippets.
  return {urls:[...new Set<string>(data.results.filter((x:any)=>typeof x?.url==='string').map((x:any)=>x.url))].slice(0,5),credits:data.usage?.credits};
 }catch(e){if(e instanceof DiscoveryError)throw e;throw new DiscoveryError('connection',controller.signal.aborted?'انتهت مهلة البحث؛ يستمر التحليل بالمعلومات المتاحة.':'تعذر الاتصال بالباحث؛ يستمر التحليل بالمعلومات المتاحة.');}finally{clearTimeout(timer);}
}
export function readOriginalNews(raw:string,url:string,report:MarketReport):News|null{
 const article=raw.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1];if(!article)return null;const plain=htmlText(article),symbol=report.company.symbol.replace('.SR','');
 const name=(report.company.nameEn||report.company.name).toLowerCase().replace(/\b(inc|corp|company|ltd|plc)\.?/g,'').trim();
 if(name.length<4||!plain.toLowerCase().includes(name)||!new RegExp('(?:^|[^A-Z0-9])'+symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:[^A-Z0-9]|$)','i').test(plain))return null;
 const metas=[...raw.matchAll(/<meta\b[^>]*>/gi)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map(v=>[v[1].toLowerCase(),v[2]])));
 const published=metas.find(m=>m.property==='article:published_time'||m.name==='datePublished')?.content;
 if(!published||!Number.isFinite(Date.parse(published))||Date.parse(published)>Math.min(Date.now(),Date.parse(report.asOf+'T23:59:59Z'))||Date.parse(report.asOf)-Date.parse(published)>31*86400000)return null;
 const title=metas.find(m=>m.property==='og:title')?.content||htmlText(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 if(!title||plain.length<600)return null;
 return {title:title.slice(0,400),url,date:published,kind:'news',contentRead:true,retrievedAt:new Date().toISOString(),lineage:url,contextExcerpt:plain.slice(0,220),impact:'قُرئ السياق وتحققت هوية الشركة وتاريخ النشر؛ لم يُستنتج أثر سعري آلي من العنوان.'} as News;
}
export function researchSourcePolicy(settings:SiteSettings,symbol:string){
 const official=symbol.endsWith('.SR')?'tadawul':'sec',source=settings.sourceConfig.find(s=>s.id===official),domains:string[]=[];
 if(settings.sources[official]&&(!source||source.enabled&&!source.deleted))domains.push(official==='sec'?'www.sec.gov':'www.saudiexchange.sa');
 const issuer=settings.sourceConfig.find(s=>s.id===ISSUER_SOURCE_IDS[symbol]);
 for(const host of (!issuer||issuer.enabled&&!issuer.deleted)?ISSUER_HOSTS[symbol]||[]:[]){const matching=settings.sourceConfig.filter(s=>{try{const root=new URL(s.url).hostname.replace(/^www\./,'');return host===root||host.endsWith('.'+root);}catch{return false;}});if(!matching.length||matching.some(s=>s.enabled&&!s.deleted))domains.push(host);}
 return {domains,official,sourcePolicy:settings.sourceConfig.map(s=>({id:s.id,enabled:s.enabled,deleted:s.deleted,url:s.url})),switches:settings.sources};
}
export async function supplementResearch(report:MarketReport,db:any,fetcher:typeof fetch=fetch,options:{read?:typeof import('./market-data').upstream;siteSettings?:SiteSettings;apiKey?:string}={}):Promise<MarketReport>{
 if(report.mode!=='current')return report;
 const settings=await readDiscoverySettings(db),siteSettings=options.siteSettings||await readSettings(db),policy=researchSourcePolicy(siteSettings,report.company.symbol),now=new Date().toISOString(),missing=missingInformation(report),trace:ResearchTrace={id:crypto.randomUUID(),asset:report.company.symbol,createdAt:now,missing,attempts:[],evidence:initialEvidence(report),cacheHit:false,status:'direct-only',limits:{searches:0,reads:0,monthlyCap:settings.monthlyCap}};
 const persist=async()=>{try{trace.recorded=true;await db.prepare('INSERT INTO research_runs(id,symbol,created_at,data) VALUES(?,?,?,?)').bind(trace.id,report.company.symbol,trace.createdAt,JSON.stringify(trace)).run();}catch{trace.recorded=false;}};
 const attempt=(stage:string,state:string,reason:string,extra:Partial<ResearchAttempt>={})=>trace.attempts.push({stage,state,reason,at:new Date().toISOString(),...extra});
 attempt('direct','checked','فُحصت المصادر المباشرة والبيانات المقبولة قبل البحث عن النواقص.');
 if(!missing.length||!settings.enabled||!policy.domains.length){attempt('search',!missing.length?'unneeded':'disabled',!missing.length?'المعلومات المطلوبة متوفرة.':!settings.enabled?'البحث متوقف من الإدارة؛ المصادر المباشرة مستمرة.':'المصادر المناسبة لهذا البحث معطلة؛ لا يتجاوز الباحث اختيار الإدارة.');await persist();return {...report,research:trace};}
 const key='discovery:v3:'+await fingerprint(JSON.stringify([report.company.symbol,report.asOf,missing,settings,policy,!!options.apiKey?.trim()])),cache=await db.prepare('SELECT data,updated_at FROM research_state WHERE id=?').bind(key).first();
 if(cache&&Date.now()-Date.parse(cache.updated_at)<1800000){const saved=JSON.parse(cache.data);report={...report,facts:[...report.facts,...saved.facts],news:mergeVerifiedNews(report.news,saved.news)};trace.cacheHit=true;trace.evidence=[...initialEvidence(report),...newsEvidence(report)];trace.status=saved.trace.status;attempt('cache','read','استُخدمت مستندات محفوظة لمدة 30 دقيقة وبسياسة المصادر الحالية؛ لم يُرسل طلب بحث جديد.');await persist();return {...report,research:trace};}
 const lease=crypto.randomUUID(),claimed=await db.prepare('INSERT INTO research_locks(id,token,until_ms) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until_ms=excluded.until_ms WHERE until_ms<? RETURNING token').bind(key,lease,Date.now()+60000,Date.now()).first();
 if(!claimed){attempt('search','running','يوجد بحث جارٍ لهذا الأصل؛ لم يُكرر الإنفاق. أعد التحليل بعد اكتماله.');await persist();return {...report,research:trace};}
 const facts:Fact[]=[],news:News[]=[],seen=new Set<string>(),bodyHashes=new Set<string>(),started=Date.now(),read=options.read||await configuredReader(db,siteSettings);
 const consume=async(candidate:string)=>{
  if(trace.limits.reads>=settings.maxReads||Date.now()-started>30000)return;
  let url:string;try{url=approvedResearchUrl(candidate,report.company.symbol);if(!policy.domains.includes(new URL(url).hostname))throw Error('المصدر معطل من الإدارة؛ لم تُقرأ صفحته أو تستخدم نسخة محفوظة منه.');}catch(e){attempt('verify','rejected',e instanceof Error?e.message:'رابط غير صالح.');return;}
  if(seen.has(url)){attempt('deduplicate','duplicate','رابط مكرر؛ لم يُحتسب دليلًا مستقلًا.',{url});return;}seen.add(url);trace.limits.reads++;
  try{
   const regulated=['www.sec.gov','www.saudiexchange.sa'].includes(new URL(url).hostname);
   const response=regulated?{raw:await read(url,false,300000),contentType:'text/html'}:await readExternalSource(url,fetcher,6500),{raw,contentType}=response;
   if(typeof raw!=='string'||!/text\/html|application\/xhtml/.test(contentType)||!/<(?:html|body|article|main|table)\b/i.test(raw))throw new DiscoveryError('reader','نوع المستند يحتاج قارئًا مختلفًا؛ لم يُستخرج منه رقم تخميني.');
   const bodyHash=await fingerprint(htmlText(raw));if(bodyHashes.has(bodyHash)){attempt('deduplicate','duplicate','المحتوى منقول أو مكرر؛ لم يُحتسب دليلًا آخر.',{url});return;}bodyHashes.add(bodyHash);attempt('read','read','قُرئ المستند الأصلي.',{url});
   let extracted:Fact[]=[];
   const regulatory=report.regulatory as any,filing=regulatory?.filings?.find((f:FilingDocument)=>canonicalEvidenceUrl(f.url)===url),event=regulatory?.eventDocuments?.find((f:FilingDocument)=>canonicalEvidenceUrl(f.url)===url);
   if(filing)extracted=readSECInlineDocument(raw,filing,report.asOf);
   // A company-profile URL alone does not verify the identity of returned HTML.
   else if(new URL(url).hostname==='www.saudiexchange.sa'&&new URL(url).searchParams.get('companySymbol')===report.company.symbol.replace('.SR',''))extracted=parseSaudiProfile(raw,report.company.symbol,report.asOf,true).facts;
   facts.push(...extracted.map(f=>({...f,retrievedAt:new Date().toISOString()})));
   const item=event?readSECEventDocument(raw,event,regulatory.registrantName,report.asOf):readOriginalNews(raw,url,report);if(item)news.push(item);
   attempt('extract',extracted.length||item?'verified':'partial',extracted.length?`استُخرج ${extracted.length} بندًا بهوية وفترة ووحدة؛ تُقارن بالموجود قبل الاستخدام.`:item?'تحققت هوية الإفصاح وتاريخ نشره؛ أثره على السعر غير مفترض.':'لم تستوفِ الحقول أو تاريخ النشر أو الهوية شروط الاستخراج؛ لم تدخل أرقام النص في التقييم.',{url});
  }catch(e){attempt('read',e instanceof DiscoveryError?e.code:'unreadable',e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذرت قراءة المستند؛ لا يعني ذلك عدم وجود المعلومة.',{url});}
 };
 try{
  // Official issuer event URLs are already known from verified submissions: read them before paying for discovery.
  for(const doc of (report.regulatory as any)?.eventDocuments||[])if(missing.includes('news_context'))await consume(doc.url);
  const remaining=missingInformation({...report,facts:[...report.facts,...facts],news:mergeVerifiedNews(report.news,news)});
  for(const query of (remaining.length?researchQueries(report,remaining):[]).slice(0,settings.maxSearches)){
   if(trace.limits.reads>=settings.maxReads)break;
   if(Date.now()-started>24000){attempt('search','timeout','انتهى الوقت المخصص للبحث المساعد.');break;}
   const cooldown=await db.prepare("SELECT until_ms FROM research_locks WHERE id='tavily:cooldown'").first();
   if(cooldown?.until_ms>Date.now()){attempt('search','cooldown','توجد مهلة مشتركة للمزود بعد رفض أو تعذر سابق؛ لم تُستهلك محاولة أخرى.');break;}
   const reservedAt=Date.now();if(!await reserveSearch(db,settings.monthlyCap,reservedAt)){attempt('search','quota','انتهى سقف البحث الشهري داخل ميزان؛ الأسعار والمصادر المباشرة مستمرة.');break;}
   trace.limits.searches++;
   let result;try{result=await discoverUrls(query,policy.domains,fetcher,options.apiKey);await recordSearchUsage(db,result.credits,reservedAt);attempt('search',result.urls.length?'found':'not_found',result.urls.length?'عُثر على روابط مرشحة؛ لا تُستخدم مقتطفات البحث كأرقام.':'لم يعثر الباحث على نتيجة مناسبة لهذا السؤال.',{query});}catch(e){
    attempt('search',e instanceof DiscoveryError?e.code:'failed',e instanceof Error?e.message:'تعذر البحث.',{query});
    const after=e instanceof DiscoveryError?e.retryAfter:null,requested=after&&/^\d+$/.test(after)?Date.now()+Number(after)*1000:after?Date.parse(after):NaN,until=Number.isFinite(requested)?Math.max(Date.now()+1000,requested):Date.now()+(e instanceof DiscoveryError&&e.code==='connection'?30000:60000);
    await db.prepare("INSERT INTO research_locks(id,token,until_ms) VALUES('tavily:cooldown','cooldown',?) ON CONFLICT(id) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)").bind(until).run();break;
   }
   for(const candidate of result.urls)await consume(candidate);
  }
  report={...report,facts:[...report.facts,...facts],news:mergeVerifiedNews(report.news,news)};trace.evidence=[...initialEvidence(report),...newsEvidence(report)];trace.recorded=true;trace.status=facts.length||news.length?'supplemented':'partial';
  const writes=[db.prepare('INSERT INTO research_runs(id,symbol,created_at,data) VALUES(?,?,?,?)').bind(trace.id,report.company.symbol,now,JSON.stringify(trace))];
  // A repaired key or recovered provider must not remain blocked by a cached access/transport failure.
  if(!trace.attempts.some(a=>['access','setup','connection','quota','cooldown','timeout','failed'].includes(a.state)))writes.push(db.prepare('INSERT INTO research_state(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(key,JSON.stringify({facts,news,trace}),now));
  await db.batch(writes);
  return {...report,research:trace};
 }finally{await db.prepare('DELETE FROM research_locks WHERE id=? AND token=?').bind(key,lease).run();}
}
