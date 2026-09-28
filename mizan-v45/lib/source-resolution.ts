import type {Fact,MarketReport} from './market-data';
import {finite,validDate} from './analysis';

/** Select comparable observations only. Priority never depends on a favorable number. */
export function sourceStrength(source:string){
 try{const u=new URL(source),h=u.hostname.toLowerCase();if(u.protocol!=='https:')return 0;
  if(h==='sec.gov'||h.endsWith('.sec.gov')||h==='saudiexchange.sa'||h.endsWith('.saudiexchange.sa')||h==='cma.gov.sa'||h.endsWith('.cma.gov.sa'))return 4;
  if(h.endsWith('.gov')||h.endsWith('.gov.sa'))return 3;
  return 2;
 }catch{return 1;}
}
export function resolveFinancialSources(report:MarketReport){
 const cutoff=Date.parse(report.asOf+'T23:59:59.999Z');
 const all=[...report.facts,...(report.official?.facts||[]),...(report.regulatory?.facts||[])];
 const groups=new Map<string,Fact[]>();
 for(const raw of all){if(raw.unit&&!['base','thousand','million'].includes(raw.unit))continue;const f={...raw,value:raw.value*(raw.unit==='million'?1e6:raw.unit==='thousand'?1e3:1),...(raw.unit?{unit:'base' as const}:{})};if(!finite(f.value)||!validDate(f.date)||f.date>report.asOf||!f.currency||!f.source||f.publishedAt&&(!Number.isFinite(Date.parse(f.publishedAt))||Date.parse(f.publishedAt)>cutoff))continue;
  const k=[f.key,f.period,f.date,f.currency].join('|'),list=groups.get(k)||[];
  if(!list.some(v=>v.source===f.source&&v.value===f.value&&v.publishedAt===f.publishedAt))list.push(f);groups.set(k,list);
 }
 const facts:Fact[]=[],comparisons:any[]=[];
 for(const list of groups.values()){
  list.sort((a,b)=>sourceStrength(b.source)-sourceStrength(a.source)||(Date.parse(b.publishedAt||'')||0)-(Date.parse(a.publishedAt||'')||0)||a.source.localeCompare(b.source));
  const chosen=list[0];
  const ambiguous=list.slice(1).some(other=>sourceStrength(other.source)===sourceStrength(chosen.source)&&(other.publishedAt||'')===(chosen.publishedAt||'')&&Math.abs(other.value-chosen.value)>Math.max(1,Math.abs(chosen.value)*.005));
  // No meaningful authority/freshness tie-break exists: exclude this factor only.
  if(!ambiguous)facts.push(chosen);
  for(const other of list.slice(1)){const diff=other.value-chosen.value,disagreed=Math.abs(diff)>Math.max(1,Math.abs(chosen.value)*.005);
   comparisons.push({...chosen,providerValue:other.value,alternativeSource:other.source,diff,differencePct:chosen.value?diff/Math.abs(chosen.value)*100:null,disagreed,conflict:false,resolved:!ambiguous,excluded:ambiguous,sameLineage:!!chosen.lineage&&chosen.lineage===other.lineage,selectionReason:ambiguous?'استُبعد هذا العامل وحده: اختلاف مؤثر بين مصادر متساوية في الأولوية وتاريخ النشر، دون قرينة لترجيح رقم.':sourceStrength(chosen.source)>sourceStrength(other.source)?'المصدر الأعلى أولوية للمعلومة نفسها':chosen.publishedAt!==other.publishedAt?'الأحدث نشرًا بين مصادر بنفس الأولوية':'أرقام متوافقة ضمن هامش المقارنة؛ لا تُجمع كمصادر مستقلة'});
  }
 }
 return {facts,comparisons,provisional:facts.some(f=>sourceStrength(f.source)<4||!f.publishedAt),changed:comparisons.filter(c=>c.disagreed).length};
}
