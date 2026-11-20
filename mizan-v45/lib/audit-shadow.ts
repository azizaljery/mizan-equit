/**
 * Forward shadow log of the /audit decision state. Each session the state is recorded with the price known then; later it is resolved against the real close
 * 5 and 21 sessions ahead. The summary compares UP/DOWN calls with the always-up baseline and states plainly when the sample is too small to judge.
 * Pure functions; research only; feeds no forecast, score or bot.
 */
import type {Price} from './analysis';
import {buildAudit} from './audit-view';

export const SHADOW_PARAMS=Object.freeze({horizons:[5,21] as const,minResolvedPerGroup:30});
export const SHADOW_SYMBOLS=['AAPL','MSFT','NVDA','JPM','XOM','WMT','2222.SR','1120.SR','1180.SR','2010.SR','7010.SR','1211.SR'] as const;
export type ShadowRow={id:string;symbol:string;asof:string;state:string;support:number|null;opposition:number|null;price:number};
export type ShadowOutcome={shadow_id:string;horizon:5|21;end_date:string;end_price:number;up:0|1};

export function shadowRow(symbol:string,prices:Price[],today:string):ShadowRow|null{
 if(prices.length<60)return null;
 const a=buildAudit(prices,today),last=prices[prices.length-1];
 if(!(last.close>0))return null;
 const d:any=a.decision;
 return {id:`${symbol}|${a.asOf}`,symbol,asof:a.asOf,state:d.state,support:Number.isFinite(d.support)?d.support:null,opposition:Number.isFinite(d.against)?d.against:null,price:last.close};
}
/** Outcome rows for every logged row whose horizon bar now exists. `have` = keys "id|h" already stored. */
export function resolveOutcomes(rows:ShadowRow[],prices:Price[],have:Set<string>):ShadowOutcome[]{
 const idx=new Map(prices.map((p,i)=>[p.date,i]));const out:ShadowOutcome[]=[];
 for(const r of rows){
  const i=idx.get(r.asof);if(i===undefined)continue;
  for(const h of SHADOW_PARAMS.horizons){
   if(have.has(`${r.id}|${h}`)||i+h>=prices.length)continue;
   const e=prices[i+h];if(!(e.close>0))continue;
   out.push({shadow_id:r.id,horizon:h,end_date:e.date,end_price:e.close,up:e.close>r.price?1:0});
  }
 }
 return out;
}
export type GroupStat={horizon:5|21;group:'UP'|'DOWN'|'ABSTAIN_ETC';resolved:number;upRate:number|null;enough:boolean};
export function summarize(rows:ShadowRow[],outcomes:ShadowOutcome[]){
 const st=new Map(rows.map(r=>[r.id,r.state]));
 const stats:GroupStat[]=[];
 for(const h of SHADOW_PARAMS.horizons)for(const g of ['UP','DOWN','ABSTAIN_ETC'] as const){
  const o=outcomes.filter(x=>x.horizon===h&&((st.get(x.shadow_id)==='UP'||st.get(x.shadow_id)==='DOWN')?st.get(x.shadow_id)===g:g==='ABSTAIN_ETC'));
  const n=o.length;stats.push({horizon:h,group:g,resolved:n,upRate:n?o.reduce((s,x)=>s+x.up,0)/n:null,enough:n>=SHADOW_PARAMS.minResolvedPerGroup});
 }
 const baseline=SHADOW_PARAMS.horizons.map(h=>{const o=outcomes.filter(x=>x.horizon===h);return {horizon:h,resolved:o.length,upRate:o.length?o.reduce((s,x)=>s+x.up,0)/o.length:null};});
 return {logged:rows.length,stats,baseline};
}
