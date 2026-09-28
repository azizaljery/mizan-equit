import {htmlText,type Fact,type News} from './market-data';
import {SEC_TAGS,SEC_INSTANT} from './sec-data';
export type FilingDocument={url:string;cik:string;form:string;publishedAt:string;period:string;accession:string};
const date=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s));
// Discovery is limited to the verified issuer's official submissions response.
export function discoverSECDocuments(data:any,cik:string,asOf:string):FilingDocument[]{
 if(!/^\d{10}$/.test(cik)||String(data?.cik).padStart(10,'0')!==cik)throw Error('هوية مستند SEC لا تطابق الشركة.');
 const recent=data.filings?.recent,out:FilingDocument[]=[];
 for(let i=0;i<(recent?.accessionNumber?.length||0);i++){
  const accession=recent.accessionNumber[i],file=recent.primaryDocument?.[i],form=recent.form?.[i],publishedAt=recent.filingDate?.[i],period=recent.reportDate?.[i];
  if(!['10-K','10-K/A','10-Q','10-Q/A','20-F'].includes(form)||!date(publishedAt)||publishedAt>asOf||!date(period)||period>asOf||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof file!=='string'||!/^[-a-zA-Z0-9_]+(?:[-a-zA-Z0-9_.]*[-a-zA-Z0-9_])?\.html?$/.test(file)||file.includes('..'))continue;
  out.push({cik,form,publishedAt,period,accession,url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-','')}/${file}`});
 }
 // One newest annual and one newest quarterly report, never the entire archive.
 out.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
 return [out.find(d=>/10-Q/.test(d.form)),out.find(d=>/10-K|20-F/.test(d.form))].filter((d):d is FilingDocument=>!!d);
}
/** Discover current event filings for any verified SEC issuer, independently of financial reports. */
export function discoverSECEventDocuments(data:any,cik:string,asOf:string):FilingDocument[]{
 if(!/^\d{10}$/.test(cik)||String(data?.cik).padStart(10,'0')!==cik)throw Error('هوية إفصاح الحدث لا تطابق الشركة.');
 const r=data.filings?.recent,out:FilingDocument[]=[];
 for(let i=0;i<(r?.accessionNumber?.length||0);i++){
  const accession=r.accessionNumber[i],file=r.primaryDocument?.[i],form=r.form?.[i],day=r.filingDate?.[i],accepted=r.acceptanceDateTime?.[i];
  if(!['8-K','8-K/A','6-K','6-K/A'].includes(form)||!date(day)||day>asOf||Date.parse(asOf)-Date.parse(day)>31*86400000||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof file!=='string'||!/^[-a-zA-Z0-9_][a-zA-Z0-9_.-]*\.html?$/.test(file)||file.includes('..'))continue;
  const publishedAt=typeof accepted==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(accepted)&&Number.isFinite(Date.parse(accepted))?accepted:day;
  if(Date.parse(publishedAt)>Math.min(Date.now(),Date.parse(asOf+'T23:59:59Z')))continue;
  out.push({cik,accession,form,publishedAt,period:date(r.reportDate?.[i])?r.reportDate[i]:day,url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-','')}/${file}`});
 }
 return out.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,2);
}
export function readSECEventDocument(raw:string,document:FilingDocument,registrantName:string,asOf:string):News|null{
 const u=new URL(document.url);
 if(u.protocol!=='https:'||u.hostname!=='www.sec.gov'||u.username||u.password||!u.pathname.startsWith(`/Archives/edgar/data/${Number(document.cik)}/${document.accession.replaceAll('-','')}/`)||!['8-K','8-K/A','6-K','6-K/A'].includes(document.form)||Date.parse(document.publishedAt)>Math.min(Date.now(),Date.parse(asOf+'T23:59:59Z'))||Date.parse(asOf)-Date.parse(document.publishedAt)>31*86400000)return null;
 const body=raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];if(!body)return null;
 const plain=htmlText(body),normalize=(v:string)=>v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(),name=normalize(registrantName);
 if(name.length<4||plain.length<500||!normalize(plain).includes(name))return null;
 return {title:`${registrantName} — إفصاح SEC ${document.form}`,url:document.url,date:document.publishedAt,kind:'announcement',contentRead:true,retrievedAt:new Date().toISOString(),lineage:'sec:'+document.accession,contextExcerpt:plain.slice(0,220),impact:'قُرئ أصل الإفصاح وتحققت هوية الشركة ووقت نشره؛ لا يُستنتج أثر سعري من عنوانه ولا أرقام مالية من النص الحر.'};
}
const attrs=(s:string)=>Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2]]));
const content=(s:string)=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,'').replace(/&#160;|&nbsp;/g,' ').trim();
function node(s:string,name:string){return content(s.match(new RegExp('<(?:[\\w-]+:)?'+name+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+name+'>','i'))?.[1]||'');}
/** A narrow, fail-closed inline-XBRL reader. No scripts, network links, page instructions or arbitrary numeric scraping. */
export function readSECInlineDocument(html:string,document:FilingDocument,asOf:string):Fact[]{
 if(html.length>7000000||document.publishedAt>asOf||document.period>asOf)throw Error('التقرير أكبر من الحد أو لم يكن منشورًا في تاريخ التحليل.');
 html=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 const u=new URL(document.url);
 if(u.hostname!=='www.sec.gov'||u.protocol!=='https:'||!u.pathname.startsWith(`/Archives/edgar/data/${Number(document.cik)}/${document.accession.replaceAll('-','')}/`))throw Error('رابط التقرير لا يطابق هوية الإفصاح.');
 const contexts=new Map<string,{end:string;days:number|null;instant:boolean}>(),units=new Map<string,string>();
 for(const m of html.matchAll(/<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi)){
  const a=attrs(m[1]),body=m[2];if(!a.id||/<(?:\w+:)?(?:segment|scenario|explicitMember|typedMember)\b/i.test(body))continue;
  const identifier=node(body,'identifier');if(!/^\d+$/.test(identifier)||identifier.padStart(10,'0')!==document.cik)continue;
  const instant=node(body,'instant'),end=instant||node(body,'endDate'),start=node(body,'startDate');
  if(!date(end)||end>asOf||end>document.period||(!instant&&!date(start)))continue;
  const days=instant?null:(Date.parse(end)-Date.parse(start))/864e5;
  contexts.set(a.id,{end,days,instant:!!instant});
 }
 if(!contexts.size)throw Error('لم تصل سياقات XBRL مؤرخة تطابق هوية الشركة؛ لم تُستخرج أرقام من النص الحر.');
 for(const m of html.matchAll(/<(?:xbrli:)?unit\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?unit>/gi)){
  const a=attrs(m[1]),measure=node(m[2],'measure');if(a.id&&!/<(?:\w+:)?divide\b/i.test(m[2])&&/^iso4217:[A-Z]{3}$/.test(measure))units.set(a.id,measure.slice(-3));
 }
 const found:Fact[]=[],seen=new Map<string,number>(),conflicts=new Set<string>();
 for(const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)){
  const a=attrs(m[1]),context=contexts.get(a.contextref),currency=units.get(a.unitref),tag=(a.name||'').replace(/^us-gaap:/,'');
  const key=Object.entries(SEC_TAGS).find(([,tags])=>tags.includes(tag))?.[0];
  if(!key||!a.name.startsWith('us-gaap:')||!context||!currency||a['xsi:nil']==='true'||a.continuedat)continue;
  if(SEC_INSTANT.has(key)!==context.instant)continue;
  const period=context.instant?(/^10-K|^20-F/.test(document.form)?'annual':'quarterly'):context.days!==null&&context.days>=330&&context.days<=380?'annual':context.days!==null&&context.days>=70&&context.days<=110?'quarterly':null;
  if(!period)continue;
  // Unsupported transforms (e.g. comma decimals) are not guessed.
  if(a.format&&!/(?:^|:)(num-dot-decimal|numdotdecimal)$/.test(a.format))continue;
  const raw=content(m[2]);if(!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw))continue;
  const scale=a.scale===undefined?0:Number(a.scale);if(!Number.isInteger(scale)||Math.abs(scale)>12||a.sign&&a.sign!=='-')continue;
  let value=Number(raw.replaceAll(',',''))*10**scale*(a.sign==='-'?-1:1);if(!Number.isFinite(value))continue;
  if(key==='interestExpense')value=Math.abs(value);
  const id=[key,period,context.end,currency].join('|');
  if(seen.has(id)){if(seen.get(id)!==value)conflicts.add(id);continue;}seen.set(id,value);
  found.push({key,value,date:context.end,period,currency,source:document.url,publishedAt:document.publishedAt,unit:'base',lineage:'sec',accession:document.accession});
 }
 return found.filter(f=>!conflicts.has([f.key,f.period,f.date,f.currency].join('|')));
}
