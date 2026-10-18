/**
 * «سجل الترشيحات اليومي» — PURE logic of PROTOCOL-DIR-0002 (frozen at c831eb62). No I/O here.
 *   feature  : mom126_5 = close[t−5] / close[t−131] − 1, data ≤ t only; < 132 valid closes → excluded that day.
 *   ranking  : descending mom126_5, ties by symbol; in_top = rank ≤ ceil(0.2·N).
 *   target   : the h-th market session strictly after pick_date (Tadawul proxy calendar / SPY).
 *   outcome  : went_up = actual close on target session > reference close. A symbol with no close on the target
 *              session 10 calendar days after it → 'unavailable' (counts as «لم يصعد»; sensitivity excludes it).
 *   stats    : unit = pick date; lift_t = hit(top20%)_t − base_rate_t; non-overlapping dates (next pick ≥ previous
 *              target) with n_eff = n·(1−ρ)/(1+ρ), ρ = lag-1 autocorrelation of lift_t clamped ≥ 0 (AMEND-1).
 *              Formal test only when n_eff ≥ 60 (§5); before that the numbers are descriptive monitoring only.
 */
import {DISPLAY_TOP,MODEL_VERSION,PROTOCOL_COMMIT,TOP_FRACTION,HORIZONS,type LedgerMarket} from './daily-picks-universe';

export const MOM_LOOKBACK=131;
export const MOM_SKIP=5;
export const MIN_CLOSES=MOM_LOOKBACK+1; // 132
export const GRACE_DAYS=10;
export const OWNER_TARGET=0.8;
export const FORMAL_TEST_MIN_NEFF=60;
/** Operational guard (protocol §6): a day where fewer than this share of the universe could be ranked is a GAP
 *  (logged in daily_pick_runs, never back-filled) rather than a ranking of a distorted sub-universe. */
export const MIN_RANKED_FRACTION=0.75;

export type Close={date:string;close:number};
export type Exclusion={symbol:string;reason:'fetch_failed'|'insufficient_history'|'no_close_on_pick_date'};
export type RankedRow={symbol:string;rank:number;universeSize:number;percentile:number;mom:number;inTop:boolean;refPrice:number;refPriceDate:string};
export type OutcomeState='pending'|'complete'|'unavailable';
export type Evaluation={state:'pending';targetDate:string|null}|{state:'complete';targetDate:string;actualPrice:number;changePct:number;wentUp:boolean}|{state:'unavailable';targetDate:string};

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validClose=(p:Close|null|undefined):p is Close=>!!p&&typeof p.date==='string'&&DATE.test(p.date)&&typeof p.close==='number'&&Number.isFinite(p.close)&&p.close>0;
/** Valid closes, ascending by date, one per date (first kept), optionally truncated at `asOf` (inclusive). */
export function cleanSeries(series:readonly Close[],asOf?:string):Close[]{
 const seen=new Set<string>(),out:Close[]=[];
 for(const p of [...series].filter(validClose).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0)){
  if(asOf&&p.date>asOf)continue;if(seen.has(p.date))continue;seen.add(p.date);out.push({date:p.date,close:p.close});
 }
 return out;
}
/** mom126_5 of the LAST close of an already-truncated series; null when fewer than 132 valid closes. */
export function mom126_5(series:readonly Close[]):number|null{
 const c=cleanSeries(series);if(c.length<MIN_CLOSES)return null;
 const t=c.length-1,num=c[t-MOM_SKIP].close,den=c[t-MOM_LOOKBACK].close,v=num/den-1;
 return Number.isFinite(v)?v:null;
}
/** ceil(fraction·N) without floating artefacts (0.2·35 = 7.000000000000001 must give 7). */
export function topCut(n:number,fraction=TOP_FRACTION){return n<=0?0:Math.ceil(Math.round(n*fraction*1e9)/1e9);}

/** Rank the universe on pickDate. Every symbol must have a valid close ON pickDate (its reference price). */
export function rankUniverse(entries:readonly {symbol:string;closes:readonly Close[]|null}[],pickDate:string):{ranked:RankedRow[];excluded:Exclusion[]}{
 const excluded:Exclusion[]=[],ok:{symbol:string;mom:number;ref:Close}[]=[];
 for(const e of entries){
  if(!e.closes){excluded.push({symbol:e.symbol,reason:'fetch_failed'});continue;}
  const c=cleanSeries(e.closes,pickDate),last=c.at(-1);
  if(!last||last.date!==pickDate){excluded.push({symbol:e.symbol,reason:'no_close_on_pick_date'});continue;}
  const m=mom126_5(c);if(m===null){excluded.push({symbol:e.symbol,reason:'insufficient_history'});continue;}
  ok.push({symbol:e.symbol,mom:m,ref:last});
 }
 ok.sort((a,b)=>b.mom-a.mom||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0));
 const n=ok.length,cut=topCut(n);
 const ranked=ok.map((r,i)=>({symbol:r.symbol,rank:i+1,universeSize:n,percentile:n>1?Math.round((n-1-i)/(n-1)*10000)/100:100,mom:r.mom,inTop:i+1<=cut,refPrice:r.ref.close,refPriceDate:r.ref.date}));
 return {ranked,excluded};
}
export const isDisplayed=(r:{rank:number;in_top?:number|boolean;inTop?:boolean})=>Boolean(r.inTop??r.in_top)&&r.rank<=DISPLAY_TOP;

/** Sorted unique session dates (union) from one or more series. */
export function unionCalendar(series:readonly (readonly Close[]|null)[]):string[]{
 const s=new Set<string>();for(const x of series)if(x)for(const p of x)if(validClose(p))s.add(p.date);
 return [...s].sort();
}
/** The h-th session strictly after pickDate, or null when the calendar does not reach it yet. */
export function targetSession(calendar:readonly string[],pickDate:string,h:number):string|null{
 if(!Number.isInteger(h)||h<1)throw new Error('horizon must be a positive integer');
 const after=[...new Set(calendar)].filter(d=>DATE.test(d)&&d>pickDate).sort();
 return after[h-1]??null;
}
export const daysBetween=(from:string,to:string)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
/** Cheap SQL pre-filter: h sessions in a 5-session week never span fewer than floor(7h/5) calendar days. */
export const minCalendarDays=(h:number)=>Math.floor(h*7/5);
export const isNewSession=(pickDate:string,lastRecorded:string|null|undefined)=>DATE.test(pickDate)&&(!lastRecorded||pickDate>lastRecorded);

/**
 * Evaluate one row. `closes` = the symbol's fresh series (null when its fetch failed this run); `providerHealthy`
 * guards against marking rows unavailable during a broad provider outage (only a symbol-specific absence counts).
 */
export function evaluateRow(row:{pick_date:string;horizon:number;ref_price:number},ctx:{calendar:readonly string[];closes:readonly Close[]|null;today:string;providerHealthy:boolean}):Evaluation{
 const targetDate=targetSession(ctx.calendar,row.pick_date,row.horizon);
 if(!targetDate||targetDate>ctx.today)return {state:'pending',targetDate:null};
 const hit=ctx.closes?cleanSeries(ctx.closes).find(p=>p.date===targetDate):undefined;
 if(hit&&row.ref_price>0){
  const changePct=Math.round((hit.close/row.ref_price-1)*1e6)/1e4;
  return {state:'complete',targetDate,actualPrice:hit.close,changePct,wentUp:hit.close>row.ref_price};
 }
 if(daysBetween(targetDate,ctx.today)>GRACE_DAYS&&(ctx.closes!==null||ctx.providerHealthy))return {state:'unavailable',targetDate};
 return {state:'pending',targetDate};
}

export function ledgerRowId(p:{modelVersion?:string;market:LedgerMarket;pickDate:string;horizon:number;symbol:string}){
 return [p.modelVersion??MODEL_VERSION,p.market,p.pickDate,'h'+p.horizon,p.symbol].join('|');
}
export type MizanForecast={id:string;predictedPrice:number};
/** One row per (ranked symbol × horizon). Reference fields only; outcome columns are left to their defaults. */
export function buildLedgerRows(market:LedgerMarket,pickDate:string,ranked:readonly RankedRow[],currency:string,createdAt:string,mizan:ReadonlyMap<string,MizanForecast>=new Map()){
 return HORIZONS.flatMap(h=>ranked.map(r=>{const f=mizan.get(r.symbol+'|'+h);return {
  id:ledgerRowId({market,pickDate,horizon:h,symbol:r.symbol}),pick_date:pickDate,market,horizon:h,symbol:r.symbol,rank:r.rank,universe_size:r.universeSize,
  percentile:r.percentile,mom126_5:r.mom,in_top:r.inTop?1:0,ref_price:r.refPrice,ref_price_date:r.refPriceDate,currency,
  mizan_predicted_price:f&&Number.isFinite(f.predictedPrice)&&f.predictedPrice>0?f.predictedPrice:null,mizan_forecast_id:f?f.id:null,
  model_version:MODEL_VERSION,protocol_commit:PROTOCOL_COMMIT,created_at:createdAt};}));
}

export type StatRow={pick_date:string;rank:number;in_top:number;outcome_state:string;went_up:number|null;target_date:string|null};
type DateStat={date:string;target:string;n:number;up:number;nTop:number;upTop:number;nTop3:number;upTop3:number};
export type RateBlock={dates:number;hitTop:number|null;hitTop3:number|null;baseRate:number|null;lift:number|null;rows:{all:number;top:number;top3:number}};
export type LedgerStats={horizon:number;startDate:string|null;counts:{rows:number;pending:number;complete:number;unavailable:number};
 all:RateBlock;excludingUnavailable:RateBlock;nonOverlap:RateBlock&{n:number;rho:number;nEff:number;selectedDates:string[]};
 ownerTarget:number;formalTestEligible:boolean;formalTestMinNEff:number;note:string};

const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const r4=(x:number|null)=>x===null?null:Math.round(x*1e4)/1e4;
/** Lag-1 autocorrelation clamped to ≥ 0 (no extra credit); 0 when undefined (n < 3 or zero variance). */
export function lag1Autocorrelation(xs:readonly number[]):number{
 if(xs.length<3)return 0;const m=xs.reduce((a,b)=>a+b,0)/xs.length;let num=0,den=0;
 for(let i=0;i<xs.length;i++){den+=(xs[i]-m)**2;if(i+1<xs.length)num+=(xs[i]-m)*(xs[i+1]-m);}
 if(den<=0)return 0;const r=num/den;return Number.isFinite(r)?Math.min(Math.max(r,0),0.999999):0;
}
export const effectiveN=(n:number,rho:number)=>{const r=Math.max(0,rho);return n*(1-r)/(1+r);};

function perDate(rows:readonly StatRow[],dropUnavailable:boolean):DateStat[]{
 const by=new Map<string,StatRow[]>();for(const r of rows){const a=by.get(r.pick_date);if(a)a.push(r);else by.set(r.pick_date,[r]);}
 const out:DateStat[]=[];
 for(const [date,rs] of [...by.entries()].sort((a,b)=>a[0]<b[0]?-1:1)){
  if(rs.some(r=>r.outcome_state!=='complete'&&r.outcome_state!=='unavailable'))continue; // date not fully resolved yet
  const use=dropUnavailable?rs.filter(r=>r.outcome_state==='complete'):rs;if(!use.length)continue;
  const up=(r:StatRow)=>r.outcome_state==='complete'&&r.went_up===1?1:0; // unavailable = not up (§3, conservative)
  const top=use.filter(r=>r.in_top===1),top3=top.filter(r=>r.rank<=DISPLAY_TOP);
  out.push({date,target:rs.map(r=>r.target_date||'').sort().at(-1)||'',n:use.length,up:use.reduce((s,r)=>s+up(r),0),nTop:top.length,upTop:top.reduce((s,r)=>s+up(r),0),nTop3:top3.length,upTop3:top3.reduce((s,r)=>s+up(r),0)});
 }
 return out;
}
function rates(ds:readonly DateStat[]):RateBlock{
 const withTop=ds.filter(d=>d.nTop>0),withTop3=ds.filter(d=>d.nTop3>0);
 const hitTop=mean(withTop.map(d=>d.upTop/d.nTop)),hitTop3=mean(withTop3.map(d=>d.upTop3/d.nTop3)),baseRate=mean(ds.map(d=>d.up/d.n));
 const lift=mean(withTop.map(d=>d.upTop/d.nTop-d.up/d.n));
 return {dates:ds.length,hitTop:r4(hitTop),hitTop3:r4(hitTop3),baseRate:r4(baseRate),lift:r4(lift),rows:{all:ds.reduce((s,d)=>s+d.n,0),top:ds.reduce((s,d)=>s+d.nTop,0),top3:ds.reduce((s,d)=>s+d.nTop3,0)}};
}
/** Greedy non-overlapping pick dates: the next date must be on/after the previous date's target session. */
export function nonOverlappingDates<T extends {date:string;target:string}>(ds:readonly T[]):T[]{
 const out:T[]=[];for(const d of ds){const prev=out.at(-1);if(!prev||(prev.target&&d.date>=prev.target))out.push(d);}return out;
}
/** Stats for ONE (market, horizon, model_version) slice. Means are over pick dates (the unit of §5). */
export function ledgerStats(rows:readonly StatRow[],horizon:number):LedgerStats{
 const counts={rows:rows.length,pending:0,complete:0,unavailable:0};
 for(const r of rows){if(r.outcome_state==='complete')counts.complete++;else if(r.outcome_state==='unavailable')counts.unavailable++;else counts.pending++;}
 const ds=perDate(rows,false),sel=nonOverlappingDates(ds);
 const lifts=sel.filter(d=>d.nTop>0).map(d=>d.upTop/d.nTop-d.up/d.n),rho=lag1Autocorrelation(lifts),n=lifts.length,nEff=Math.round(effectiveN(n,rho)*100)/100;
 const formalTestEligible=nEff>=FORMAL_TEST_MIN_NEFF;
 return {horizon,startDate:rows.reduce<string|null>((m,r)=>!m||r.pick_date<m?r.pick_date:m,null),counts,all:rates(ds),excludingUnavailable:rates(perDate(rows,true)),
  nonOverlap:{...rates(sel),n,rho:Math.round(rho*1e4)/1e4,nEff,selectedDates:sel.map(d=>d.date)},ownerTarget:OWNER_TARGET,formalTestEligible,formalTestMinNEff:FORMAL_TEST_MIN_NEFF,
  note:formalTestEligible?'بلغت العينة الفعالة الحد المسجل مسبقاً (n_eff ≥ 60): يجوز إجراء الاختبار الرسمي الواحد وفق §5 (Bootstrap بكتل التاريخ + Permutation + الأرباع).'
   :'أرقام وصفية للمراقبة فقط: لا اختبار رسمي ولا حكم قبل n_eff ≥ 60 ملاحظة مستقلة (البروتوكول §5). الهدف 80% مرجع طموح وليس معيار النجاح؛ المعيار lift > 0.'};
}

export function validLedgerRequest(market:unknown,horizon:unknown,limit:unknown){
 const m=market==='us'?'us':market==='sa'?'sa':null;if(!m)throw new Error('اختر السوق: السعودي أو الأمريكي.');
 const h=Number(horizon);if(!(HORIZONS as readonly number[]).includes(h))throw new Error('المدة: 5 أو 21 جلسة.');
 const l=limit===undefined||limit===null||limit===''?30:Number(limit);if(!Number.isInteger(l)||l<1||l>120)throw new Error('عدد التواريخ من 1 إلى 120.');
 return {market:m as LedgerMarket,horizon:h,limit:l};
}
