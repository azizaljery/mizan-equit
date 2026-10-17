import {candidateExclusion,compareScreenerCandidates,type ScreenerCandidate} from './screener-policy';

/**
 * «توصيات الشركات»: the strongest rising forecasts the site has ALREADY recorded (daily archive + screener + user
 * analyses), re-ranked with the screener's own eligibility rules. No new analysis is run and no threshold is lowered:
 * a forecast qualifies only if the screener itself would accept it (available, rising, confidence متوسط/مرتفع,
 * valid range, consistent target). This is a model ranking, not investment advice.
 */
export const PICK_HORIZONS=[{sessions:1,name:'يومي',maxAgeHours:60},{sessions:5,name:'أسبوعي',maxAgeHours:96},{sessions:21,name:'شهري',maxAgeHours:240}] as const;
export type PickHorizon=typeof PICK_HORIZONS[number]['sessions'];
export type PickMarket='sa'|'us';
export type PickRow={id:string;symbol:string;created_at:string;horizon:number;market:string;confidence:string;available:number;data:string;name?:string|null;exchange?:string|null};
export type Pick=ScreenerCandidate&{id:string;issuedAt:string;priceTime:string;horizonName:string};
export type TrackRecord={evaluated:number;directionCorrect:number;directionAccuracy:number|null;rangeHits:number;rangeCoverage:number|null};

export function validPicksRequest(market:unknown,horizon:unknown,count:unknown){
 const m=market==='us'?'us':market==='sa'?'sa':null;
 const h=PICK_HORIZONS.find(x=>String(x.sessions)===String(horizon));
 const c=count===undefined||count===null||count===''?3:Number(count);
 if(!m)throw new Error('اختر السوق: السعودي أو الأمريكي.');
 if(!h)throw new Error('اختر المدة: يومي أو أسبوعي أو شهري.');
 if(!Number.isInteger(c)||c<1||c>5)throw new Error('عدد الشركات من 1 إلى 5.');
 return {market:m as PickMarket,horizon:h,count:c};
}

const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const strs=(v:unknown)=>Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,6) as string[]:[];

/** Map a stored forecast row to the screener's candidate shape. Unparseable rows are dropped, never patched. */
export function rowToCandidate(row:PickRow,horizonName:string):Pick|null{
 let d:any;try{d=JSON.parse(row.data);}catch{return null;}
 if(!d||typeof d!=='object')return null;
 if(d.recordClass&&d.recordClass!=='prospective-public')return null;
 const market=row.market==='us'?'us':row.market==='sa'?'sa':null;if(!market)return null;
 return {id:row.id,symbol:row.symbol,name:String(row.name||d.companyName||row.symbol),exchange:String(row.exchange||''),market,currency:String(d.currency||(market==='sa'?'SAR':'USD')),
  price:num(d.price),predictedPrice:num(d.predictedPrice),direction:String(d.direction||'غير متاح'),expectedChangePct:num(d.expectedChangePct),
  range:Array.isArray(d.range)&&d.range.length===2&&d.range.every((x:unknown)=>num(x)!==null)?[d.range[0],d.range[1]]:null,
  confidence:String(d.confidence||row.confidence||'غير متاحة'),dataQuality:String(d.dataQuality||'غير متاحة'),coverage:num(d.coverage)??0,sample:num(d.sample)??0,independent:num(d.independent)??0,
  riskLevel:String(d.riskLevel||'غير متاح'),available:row.available===1&&d.available!==false,reasons:strs(d.reasons),basis:strs(d.basis),risks:strs(d.risks),
  issuedAt:row.created_at,priceTime:String(d.priceTime||''),horizonName} as Pick;
}

/** Latest record per symbol, screener eligibility, screener ranking, top `count`. */
export function selectPicks(rows:PickRow[],horizonName:string,count:number){
 const latest=new Map<string,PickRow>();
 for(const r of rows){const prev=latest.get(r.symbol);if(!prev||r.created_at>prev.created_at)latest.set(r.symbol,r);}
 const exclusions:Record<string,number>={};let considered=0;const eligible:Pick[]=[];
 for(const r of latest.values()){
  const c=rowToCandidate(r,horizonName);if(!c)continue;considered++;
  const why=candidateExclusion(c);if(why){exclusions[why]=(exclusions[why]||0)+1;continue;}
  eligible.push(c);
 }
 eligible.sort(compareScreenerCandidates);
 return {picks:eligible.slice(0,count),considered,eligible:eligible.length,exclusions};
}

export function trackRecord(outcomes:{data:string}[]):TrackRecord{
 let evaluated=0,directionCorrect=0,rangeHits=0;
 for(const o of outcomes){let d:any;try{d=JSON.parse(o.data);}catch{continue;}if(d?.state!=='complete')continue;evaluated++;if(d.directionCorrect===true)directionCorrect++;if(d.rangeHit===true)rangeHits++;}
 return {evaluated,directionCorrect,directionAccuracy:evaluated?Math.round(directionCorrect/evaluated*1000)/10:null,rangeHits,rangeCoverage:evaluated?Math.round(rangeHits/evaluated*1000)/10:null};
}
