import type {MarketReport,Fact,News} from './market-data';
import {resolveFinancialSources} from './source-resolution';

export type EvidenceStage='found'|'read'|'extracted'|'verified'|'used'|'partial'|'failed';
export type EvidenceRecord={id:string;asset:string;field:string;value:number|string|null;unit:string|null;currency:string|null;period:string|null;url:string;publisher:string;publishedAt:string|null;retrievedAt:string;availableAt:string;stage:EvidenceStage;used:boolean;selected?:boolean;reason:string;lineage:string;excerpt?:string};
export type ResearchAttempt={stage:string;url?:string;query?:string;state:string;reason:string;at:string};
export type ResearchTrace={id:string;asset:string;createdAt:string;missing:string[];attempts:ResearchAttempt[];evidence:EvidenceRecord[];cacheHit:boolean;recorded?:boolean;status:string;limits:{searches:number;reads:number;monthlyCap:number};};
export async function fingerprint(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function canonicalEvidenceUrl(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('رابط غير صالح.');u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;}
export function evidenceIdentity(f:Fact){return [f.key,f.period,f.date,f.currency,'base',f.publishedAt||'',f.accession||''].join('|');}
export function initialEvidence(report:MarketReport):EvidenceRecord[]{
 const selected=resolveFinancialSources(report).facts;
 const all=[...report.facts,...(report.official?.facts||[]),...(report.regulatory?.facts||[])];
 const seen=new Set<string>();
 return all.flatMap((f,i)=>{const key=evidenceIdentity(f)+'|'+f.source+'|'+f.value;if(seen.has(key))return [];seen.add(key);
  const used=selected.some(v=>evidenceIdentity(v)===evidenceIdentity(f)&&v.value===f.value*(f.unit==='million'?1e6:f.unit==='thousand'?1e3:1)&&v.source===f.source);
  const official=/^https:\/\/(?:www\.|data\.)?sec\.gov\//.test(f.source)||/^https:\/\/www\.saudiexchange\.sa\//.test(f.source);
  return [{id:'fact-'+i,asset:report.company.symbol,field:f.key,value:f.value,unit:f.unit||'base',currency:f.currency||null,period:f.date+' / '+f.period,url:f.source,publisher:official?'إفصاح رسمي':'مزود بيانات',publishedAt:f.publishedAt||null,retrievedAt:f.retrievedAt||report.retrievedAt,availableAt:f.retrievedAt||report.retrievedAt,stage:used?'extracted':'partial',selected:used,used:false,reason:used?(f.publishedAt?'اختير ضمن المدخلات بعد مقارنة الفترة والعملة؛ مساهمته الدقيقة تظهر في حساب العامل إن استُخدم.':'مرشح جزئي؛ تاريخ النشر غير مرفق فلا يصلح لإعادة بناء الماضي.'):'لم يدخل الحساب: نسخة مكررة أو بديل أعلى أولوية أو اختلاف غير محسوم.',lineage:f.lineage||f.source} as EvidenceRecord];
 });
}
export function missingInformation(report:MarketReport){const keys=new Set(resolveFinancialSources(report).facts.filter(f=>f.currency===report.currency&&Date.parse(report.asOf)-Date.parse(f.date)<=(f.period==='quarterly'?210:550)*86400000).map(f=>f.key));const missing=['revenue','netIncome','operatingCashFlow','debt'].filter(k=>!keys.has(k));if(!report.news.some(n=>n.contentRead&&Number.isFinite(Date.parse(n.date))&&Date.parse(n.date)<=Date.parse(report.asOf+'T23:59:59Z')&&Date.parse(report.asOf)-Date.parse(n.date)<=31*86400000))missing.push('news_context');return missing;}
export function mergeVerifiedNews(existing:News[],incoming:News[]){const seen=new Set<string>();return [...incoming.filter(n=>n.contentRead),...existing,...incoming.filter(n=>!n.contentRead)].filter(n=>{let url;try{url=canonicalEvidenceUrl(n.url)}catch{return false}const identity=(n as any).lineage||url;if(seen.has(identity))return false;seen.add(identity);return true;});}

export function newsEvidence(report:MarketReport):EvidenceRecord[]{return report.news.filter(n=>n.contentRead).map((n,i)=>({id:'news-'+i,asset:report.company.symbol,field:'سياق خبر',value:n.title,unit:null,currency:null,period:null,url:n.url,publisher:'الناشر الأصلي',publishedAt:n.date,retrievedAt:n.retrievedAt||report.retrievedAt,availableAt:n.retrievedAt||report.retrievedAt,stage:'verified',used:false,selected:true,reason:'قُرئ السياق؛ لم يُمنح الخبر وزنًا سعريًا تلقائيًا.',lineage:n.lineage||n.url}));}
