import {env} from 'cloudflare:workers';
import {readSettings,adjustedWeights} from '@/lib/site-settings';
import {parseAskIntent} from '@/lib/ask-intent';
import {resolveComparison} from '@/lib/ask-search';
import {analyzedCompany} from '@/lib/research-service';
import {researchScore,forecasts,RESEARCH_WEIGHTS} from '@/lib/research-model';
import {searchUSDirectory} from '@/lib/us-directory';
import {eligibleUSCompanies} from '@/lib/us-directory';
import {eligibleSaudiCompanies} from '@/lib/saudi-directory';
import {searchSaudiPage} from '@/lib/saudi-directory';
export async function POST(req:Request){try{
 const raw=await req.text();if(raw.length>1800)throw Error('الطلب أكبر من الحد.');const b=JSON.parse(raw);
 if(typeof b.question!=='string')throw Error('اكتب طلبك.');
 const settings=await readSettings((env as any).DB),intent=parseAskIntent(b.question,settings),{q,market,mode,horizon,compare,limit}=intent;
 const offset=Number(b.offset||0);if(!Number.isInteger(offset)||offset<0)throw Error('صفحة غير صالحة.');
 const directory=market==='us'?searchUSDirectory:searchSaudiPage;
 const page=directory('',0),all=compare?resolveComparison(q,market):null;
 const universe=market==='us'?eligibleUSCompanies():eligibleSaudiCompanies();
 const companies=all||universe.slice(offset,offset+2),total=all?.length||universe.length;
 const rows=await Promise.all(companies.map(async c=>{
  try{
   if(c.analysisAvailable===false||c.instrument==='OTHER'||c.instrument==='ETF')throw Error('نوع الورقة غير مؤهل لنموذج الشركات.');
   const report=await analyzedCompany(c.symbol,(env as any).DB),rank=researchScore(report,horizon,intent.minTurnover,settings),a=rank.a;
   const exclusions=[...rank.reasons];
   if(intent.lowRisk&&(a.risk===null||a.risk>=60))exclusions.push('المخاطر مرتفعة أو لم يتم التحقق منها؛ لا تستوفي شرط المخاطر الأقل.');
   if(a.tech.vol===null||a.tech.vol>intent.maxVolatility)exclusions.push('التذبذب أعلى من الحد أو غير متحقق.');
   if(intent.positiveMomentum&&!rank.factors.some(f=>f.key==='momentum'&&f.signal!==null&&f.signal>0))exclusions.push('لم يتحقق زخم موجب.');
   if(intent.positiveCashFlow&&!(a.annual.operatingCashFlow!==null&&a.annual.operatingCashFlow>0))exclusions.push('لم يتحقق تدفق تشغيلي موجب.');
   if(intent.shariaOnly)exclusions.push('طلبت شركات متوافقة شرعيًا؛ لا يوجد تصنيف حديث موثق لهذه الورقة في النظام.');
   if(intent.sector&&!new RegExp(intent.sector,'i').test(report.company.sector+' '+report.company.industry))exclusions.push('القطاع لا يطابق طلبك أو لم يتم التحقق منه.');
   const quote=report.liveQuote,price=quote?.price||a.price;
   if(intent.maxPrice&&(!price||price>=intent.maxPrice))exclusions.push('السعر لا يطابق الحد المطلوب أو غير متاح.');
   return {company:report.company,score:exclusions.length?null:rank.score,coverage:rank.coverage,exclusions,error:null,
    facts:{price,currency:report.currency,quoteTime:quote?.quoteTime||report.quoteTime||report.prices.at(-1)?.date,retrievedAt:report.retrievedAt,priceSource:report.priceSource,sector:report.company.sector,quarter:a.latestQuarterDate,annual:a.annualDate,
    pe:a.pe,pb:a.pb,evEbitda:a.evEbitda,roe:a.roe,revenueGrowth:a.cagrRevenue,cfoGrowth:a.cagrCfo,cashConversion:a.cashConversion,netDebtEbitda:a.netDebtEbitda,interestCoverage:a.interestCoverage,rsi:a.tech.rsi.at(-1),sma200:a.tech.sma200.at(-1),support:a.tech.support,resistance:a.tech.resistance,relativeVolume:a.tech.relativeVolume,turnover:a.tech.turnover,volatility:a.tech.vol},
    horizon,risk:a.riskLabel,strengths:a.strengths,risks:a.weaknesses,missing:a.missing,news:report.news,events:report.official?.events||[],factors:rank.factors,forecast:report.forecast||forecasts(report,quote||null),sources:report.checks};
  }catch(e){return {company:c,error:e instanceof Error?e.message:'تعذر جلب البيانات.',score:null,exclusions:[]}}
 }));
 const weights=adjustedWeights(RESEARCH_WEIGHTS[horizon],settings);
 return Response.json({rows,total,next:compare||offset+companies.length>=total?null:offset+companies.length,mode,horizon,compare,limit,directory:page.directory,
 understood:`${compare?'مقارنة الشركات المحددة':'مسح السوق '+(market==='sa'?'السعودي':'الأمريكي')} · ${horizon==='short'?'مضاربة قصيرة':horizon==='long'?'استثمار طويل':'استثمار متوسط'} · ${limit} نتائج${intent.shariaOnly?' · توافق شرعي موثق مطلوب':''}${intent.maxPrice?' · السعر أقل من '+intent.maxPrice:''}${intent.sector?' · فلتر قطاع':''}${intent.lowRisk?' · استبعاد المخاطر المرتفعة وغير المتحققة':''}${intent.positiveMomentum?' · زخم موجب':''} · حد السيولة ${intent.minTurnover}`,
 criteria:`النمو ${weights.growth}%، الجودة ${weights.quality}%، الديون ${weights.debt}%، التقييم ${weights.valuation}%، الاتجاه ${weights.trend}%، الزخم ${weights.momentum}%، السيولة ${weights.liquidity}%، التذبذب ${weights.risk}%، الدعم والمقاومة ${weights.levels}%، السوق ${weights.market}%، القطاع ${weights.sector}%، الأحداث ${weights.events}%.`},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'تعذر المسح.'},{status:422,headers:{'Cache-Control':'no-store'}})}}
