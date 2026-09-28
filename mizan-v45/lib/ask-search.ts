import {searchUSDirectory} from './us-directory';
import {searchSaudiPage} from './saudi-directory';
import {normalizeQuery,type Company} from './market-data';
const aliases:Record<string,string>={'ارامكو':'2222.SR','ارامكو السعودية':'2222.SR','الراجحي':'1120.SR','stc':'7010.SR','اس تي سي':'7010.SR','الاتصالات السعودية':'7010.SR'};
export function comparisonNames(q:string){const list=q.replace(/^.*?قارن\s*(?:لي\s*)?(?:بين\s*)?|^.*?مقارن[ةه]\s*(?:بين\s*)?/,'').replace(/^بين\s*/,'').replace(/\s+(?:للمضاربة|للاستثمار).*$/,'').trim();return list.split(/\s+و|،|,|\s+(?:and|vs\.?)\s+/i).map(s=>s.trim().replace(/[.؟?]+$/,'')).filter(Boolean);}
export function resolveComparison(q:string,market:string):Company[]{
 const names=comparisonNames(q);if(names.length<2||names.length>8)throw Error('تتطلب المقارنة اسمين إلى 8 أسماء؛ افصل بينها بحرف الواو أو الفاصلة.');
 return [...new Map(names.map(name=>{
  const normalized=normalizeQuery(name),symbol=(normalized==='stc'&&market==='us'?null:aliases[normalized])||name.toUpperCase();
  const sa=searchSaudiPage(symbol.replace(/\.SR$/,'')),us=searchUSDirectory(symbol);
  let candidates=symbol.endsWith('.SR')||/^\d{4,5}$/.test(symbol)?sa.companies:market==='sa'&&sa.total?sa.companies:us.companies;
  const exact=candidates.filter(c=>c.symbol===symbol||c.listedSymbol===symbol||normalizeQuery(c.name)===normalized||normalizeQuery(c.nameEn||'')===normalized);
  if(exact.length===1)candidates=exact;
  if(candidates.length!==1)throw Error(`لم تتحدد هوية «${name}» بشكل منفرد. أضف رمزها إلى السؤال لتجنب تحليل شركة أخرى.`);
  return [candidates[0].symbol,candidates[0]] as const;
 })).values()];
}
