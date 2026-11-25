/**
 * Replays the live forecast model (price inputs only) at past decision dates for the historical simulation.
 * Each call sees bars dated on or before the decision date; no financial statements, news or market index are supplied,
 * so this is the model's price-only behaviour, not what it published on that day. Pure and client-safe.
 */
import type {Price} from '../analysis';
import {forecasts} from '../research-model';
import {DEFAULT_SETTINGS} from '../site-settings';
import type {Series} from './run';

const HORIZON_ROWS=[{name:'أسبوع',sessions:5},{name:'شهر',sessions:21}];
export function replayEngine(symbol:string,market:'sa'|'us',prices:Price[],currency:string,decisionDates:string[]):Series['engine']{
 const out:NonNullable<Series['engine']>={};
 for(const date of decisionDates){
  const cut=prices.filter(p=>p.date<=date);
  if(cut.length<252)continue;
  try{
   const report:any={company:{symbol,name:symbol,exchange:'',sector:'',industry:'',source:'simulation'},asOf:date,retrievedAt:date,mode:'historical',prices:cut,currency,priceSource:'simulation',quoteTime:null,facts:[],official:null,news:[],peers:[],regulatory:null,corporateActions:[],context:{market:null,sector:null},checks:[],warnings:[],historicalNote:'محاكاة تاريخية بمدخلات أسعار فقط'};
   const res=forecasts(report,null,Date.parse(date+'T23:59:59.999Z'),DEFAULT_SETTINGS,HORIZON_ROWS);
   const row=(s:number)=>{const r=res.rows.find((x:any)=>x.sessions===s);return r&&r.available&&Number.isFinite(r.expectedChangePct)?r.expectedChangePct as number:null;};
   out[date]={'5':row(5),'21':row(21)};
  }catch{/* no replay for this date: the engine abstains and is counted as no signal */}
 }
 return out;
}
/** Decision dates the runner will use for a market (the same calendar rule as run.ts). */
export {decisionDatesOf} from './run';
