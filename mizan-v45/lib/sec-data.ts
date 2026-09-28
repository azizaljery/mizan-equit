import type {Fact,News} from './market-data';
export const SEC_TAGS:Record<string,string[]>={revenue:['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],netIncome:['NetIncomeLoss'],operatingIncome:['OperatingIncomeLoss'],operatingCashFlow:['NetCashProvidedByUsedInOperatingActivities'],equity:['StockholdersEquity'],assets:['Assets'],cash:['CashAndCashEquivalentsAtCarryingValue'],currentAssets:['AssetsCurrent'],currentLiabilities:['LiabilitiesCurrent'],grossProfit:['GrossProfit'],interestExpense:['InterestExpense']};
export const SEC_INSTANT=new Set(['equity','assets','cash','currentAssets','currentLiabilities']);
export function parseSECFacts(data:any,cik:string,asOf:string):Fact[]{
 if(String(data?.cik).padStart(10,'0')!==cik)throw Error('هوية SEC غير مطابقة.');
 const facts:Fact[]=[];
 for(const [key,tags] of Object.entries(SEC_TAGS)){
  const seen=new Set<string>();
  for(const tag of tags){const units=data.facts?.['us-gaap']?.[tag]?.units||{};
   for(const [currency,records] of Object.entries(units)){
    if(!/^[A-Z]{3}$/.test(currency)||!Array.isArray(records))continue;
    for(const r of [...records].sort((a,b)=>String(b.filed).localeCompare(String(a.filed)))){
     if(!Number.isFinite(r.val)||!/^\d{4}-\d{2}-\d{2}$/.test(r.end)||!/^\d{4}-\d{2}-\d{2}$/.test(r.filed)||r.end>asOf||r.filed>asOf||!['10-K','10-K/A','10-Q','10-Q/A'].includes(r.form))continue;
     const days=r.start?(Date.parse(r.end)-Date.parse(r.start))/864e5:null;
     const period=SEC_INSTANT.has(key)?(/^10-K/.test(r.form)&&r.fp==='FY'?'annual':'quarterly'):days!==null&&days>=330&&days<=380?'annual':days!==null&&days>=70&&days<=110?'quarterly':null;
     if(!period)continue;
     const id=[key,period,r.end,currency].join(':');if(seen.has(id))continue;seen.add(id);
     facts.push({key,value:key==='interestExpense'?Math.abs(r.val):r.val,date:r.end,period,currency,publishedAt:r.filed,source:`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,unit:'base',lineage:'sec',accession:r.accn});
    }
   }
  }
 }
 return facts;
}
export function parseSECFilings(data:any,cik:string,asOf:string):News[]{
 if(String(data?.cik).padStart(10,'0')!==cik)throw Error('هوية الإفصاح غير مطابقة.');const r=data.filings?.recent;const out:News[]=[];
 for(let i=0;i<(r?.accessionNumber?.length||0)&&out.length<8;i++){
  if(!['10-K','10-Q','8-K','20-F','6-K'].includes(r.form?.[i])||r.filingDate?.[i]>asOf||!/^\d{4}-\d{2}-\d{2}$/.test(r.filingDate?.[i]))continue;
  const accession=r.accessionNumber[i];if(!/^\d{10}-\d{2}-\d{6}$/.test(accession))continue;
  out.push({title:`إفصاح SEC ${r.form[i]} — ${data.name||''}`,date:r.filingDate[i],kind:'announcement',lineage:'sec:'+accession,url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g,'')}/${accession}-index.html`});
 }return out;
}
