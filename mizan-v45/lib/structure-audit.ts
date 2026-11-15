/**
 * Wyckoff / Elliott as an AUDIT, not an interpretation (book W-001..W-048).
 * Every function answers a yes/no rule question with the numbers behind it. Nothing here names a "phase", counts "waves" as fact,
 * predicts a target, or attributes intent to anyone. Parameters are declared up front and frozen (uncalibrated: research only).
 * Pure functions; they feed no score or decision. All pivots/events are causal: a pivot is only known `k` bars after it forms.
 */
import type {Price} from './analysis';

export const STRUCTURE_PARAMS=Object.freeze({
 pivotK:3,                 // bars each side for a swing high/low (confirmed k bars later)
 rangeBars:40,             // bars used to define the trading range (before the evaluation zone)
 evalBars:5,               // most recent bars checked for events
 maxRangeWidthPct:25,      // (high-low)/mid above this is not treated as a range
 volumeLookback:20,
 sosVolumeMultiple:1.5,    // breakout needs this multiple of average volume
 effortVolumeMultiple:2,   // effort-vs-result: volume at least this multiple...
 effortMoveMultiple:0.5,   // ...while the close-to-close move is at most this multiple of the average absolute move
});
type P=typeof STRUCTURE_PARAMS;
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const okBar=(p:Price)=>fin(p.high)&&fin(p.low)&&fin(p.close)&&fin(p.volume)&&p.high>=p.low&&p.volume>=0;

export type Pivot={index:number;type:'high'|'low';price:number;date:string;confirmedAt:number};
/** Swing points. Index i is a pivot high if its high is strictly above the k bars on each side (and below for lows). Consecutive same-type pivots keep the more extreme one. */
export function pivots(prices:Price[],k=STRUCTURE_PARAMS.pivotK):Pivot[]{
 const raw:Pivot[]=[];
 for(let i=k;i<prices.length-k;i++){
  let hi=true,lo=true;
  for(let j=i-k;j<=i+k&&(hi||lo);j++){if(j===i)continue;if(!(prices[i].high>prices[j].high))hi=false;if(!(prices[i].low<prices[j].low))lo=false;}
  if(hi)raw.push({index:i,type:'high',price:prices[i].high,date:prices[i].date,confirmedAt:i+k});
  else if(lo)raw.push({index:i,type:'low',price:prices[i].low,date:prices[i].date,confirmedAt:i+k});
 }
 const out:Pivot[]=[];
 for(const p of raw){const last=out[out.length-1];if(last&&last.type===p.type){if((p.type==='high'&&p.price>last.price)||(p.type==='low'&&p.price<last.price))out[out.length-1]=p;}else out.push(p);}
 return out;
}

export type RuleResult={id:string;rule:string;passed:boolean;detail:string};
/** Elliott impulse hard rules on six alternating points p0..p5 (up: low,high,low,high,low,high; down mirrored). Returns each rule's result; never says "wave 3 is happening". */
export function elliottImpulseAudit(points:number[],direction:'up'|'down'){
 if(points.length!==6||points.some(v=>!fin(v)))return null;
 const s=direction==='up'?1:-1,p=points.map(v=>s*v);
 const legsAlternate=p[1]>p[0]&&p[2]<p[1]&&p[3]>p[2]&&p[4]<p[3]&&p[5]>p[4];
 const w1=p[1]-p[0],w3=p[3]-p[2],w5=p[5]-p[4];
 const rules:RuleResult[]=[
  {id:'W-030',rule:'خمس قطع بالتناوب: ثلاث دافعة واثنتان معاكستان',passed:legsAlternate,detail:legsAlternate?'التناوب سليم':'القمم والقيعان لا تتناوب كما يشترط العد'},
  {id:'W-031',rule:'الموجة 2 لا تتراجع إلى ما وراء بداية الموجة 1',passed:p[2]>p[0],detail:`نهاية 2 = ${points[2]} مقابل بداية 1 = ${points[0]}`},
  {id:'W-032',rule:'الموجة 3 ليست الأقصر بين 1 و3 و5',passed:!(w3<w1&&w3<w5),detail:`الأطوال 1=${w1.toFixed(4)} 3=${w3.toFixed(4)} 5=${w5.toFixed(4)}`},
  {id:'W-033',rule:'الموجة 4 لا تتداخل مع منطقة الموجة 1',passed:p[4]>p[1],detail:`نهاية 4 = ${points[4]} مقابل نهاية 1 = ${points[1]}`},
 ];
 const valid=rules.every(r=>r.passed);
 const diagonalFlag=!rules[3].passed&&rules[0].passed&&rules[1].passed&&rules[2].passed;
 return {direction,valid,rules,note:diagonalFlag?'تداخل الموجة 4 مع 1 يخالف الدافع القياسي؛ لا يُقبل إلا بتسمية صريحة كشكل قطري (W-034) ولا يُخفى (W-048)':'قواعد الإبطال فقط؛ اجتيازها لا يثبت العد'};
}

/** Audits the most recent six confirmed pivots. `knownAtIndex` is the last bar whose data the answer needed (no look-ahead). Null when fewer than six pivots exist. */
export function latestImpulseCandidate(prices:Price[],k=STRUCTURE_PARAMS.pivotK){
 const pv=pivots(prices,k);if(pv.length<6)return null;
 const six=pv.slice(-6),direction=six[0].type==='low'?'up' as const:'down' as const;
 const a=elliottImpulseAudit(six.map(x=>x.price),direction);if(!a)return null;
 return {...a,pivots:six,knownAtIndex:Math.max(...six.map(x=>x.confirmedAt))};
}

export type StructureEvent={id:string;name:string;index:number;date:string;evidence:Record<string,number|string>};
const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;

/**
 * Wyckoff checks as numeric rules. The range is built from the `rangeBars` bars BEFORE the last `evalBars`, so recent bars cannot define their own range.
 * Events: spring/upthrust (pierce the bound then close back inside within 2 bars), SOS/SOW (close beyond the bound on >= 1.5x volume and hold on the next bar),
 * and effort-vs-result (volume >= 2x average but the move <= 0.5x the average move). Each event lists its evidence; absence of events is a normal answer.
 */
export function wyckoffAudit(prices:Price[],params:P=STRUCTURE_PARAMS){
 const n=params.rangeBars,e=params.evalBars,total=prices.length;
 if(total<n+e+1||prices.slice(-(n+e+1)).some(p=>!okBar(p)))return {status:'insufficient_data' as const};
 const base=prices.slice(total-e-n,total-e),high=Math.max(...base.map(p=>p.high)),low=Math.min(...base.map(p=>p.low)),mid=(high+low)/2,widthPct=100*(high-low)/mid;
 const isRange=widthPct<=params.maxRangeWidthPct;
 const out:{status:'ok';range:{high:number;low:number;widthPct:number;isRange:boolean};events:StructureEvent[];effortResult:StructureEvent|null;params:P;note:string}=
  {status:'ok',range:{high,low,widthPct,isRange},events:[],effortResult:null,params,note:'قواعد رقمية على بيانات مرصودة؛ لا تسمّي مرحلة ولا تنسب نية ولا تعطي هدفًا. بحثي.'};
 const volAvg=(i:number)=>avg(prices.slice(Math.max(0,i-params.volumeLookback),i).map(p=>p.volume));
 if(isRange){
  for(let i=total-e;i<total;i++){
   const p=prices[i],next=prices[i+1],v=volAvg(i),vr=v>0?p.volume/v:NaN;
   const inside=(c:number)=>c>=low&&c<=high;
   if(p.low<low){const back=inside(p.close)||(next&&inside(next.close));if(back)out.events.push({id:'W-013',name:'Spring',index:i,date:p.date,evidence:{rangeLow:low,barLow:p.low,penetrationPct:100*(low-p.low)/low,closeBackInside:inside(p.close)?'same_bar':'next_bar',volumeRatio:vr}});}
   if(p.high>high){const back=inside(p.close)||(next&&inside(next.close));if(back)out.events.push({id:'W-019',name:'Upthrust',index:i,date:p.date,evidence:{rangeHigh:high,barHigh:p.high,penetrationPct:100*(p.high-high)/high,closeBackInside:inside(p.close)?'same_bar':'next_bar',volumeRatio:vr}});}
   if(next&&p.close>high&&vr>=params.sosVolumeMultiple&&next.close>high)out.events.push({id:'W-015',name:'SOS',index:i,date:p.date,evidence:{rangeHigh:high,close:p.close,volumeRatio:vr,heldNextClose:next.close}});
   if(next&&p.close<low&&vr>=params.sosVolumeMultiple&&next.close<low)out.events.push({id:'W-021',name:'SOW',index:i,date:p.date,evidence:{rangeLow:low,close:p.close,volumeRatio:vr,heldNextClose:next.close}});
  }
 }
 const moves=[];for(let i=total-e-n+1;i<total;i++)moves.push(Math.abs(prices[i].close-prices[i-1].close));
 const avgMove=avg(moves.slice(0,-1));
 const last=total-1,vr=volAvg(last)>0?prices[last].volume/volAvg(last):NaN,mv=Math.abs(prices[last].close-prices[last-1].close),mr=avgMove>0?mv/avgMove:NaN;
 if(vr>=params.effortVolumeMultiple&&mr<=params.effortMoveMultiple)out.effortResult={id:'W-025',name:'EffortVsResult',index:last,date:prices[last].date,evidence:{volumeRatio:vr,moveRatio:mr}};
 return out;
}

/** W-045 / W-039: a breakout hypothesis is fixed BEFORE the move with zone, confirmation horizon and invalidation level; it cannot be rewritten afterwards. */
export type Hypothesis={symbol:string;kind:'breakout_up'|'breakout_down';zone:{low:number;high:number};confirmWithinBars:number;invalidationPrice:number;createdAt:string;fingerprint:string};
const fp=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');};
export function registerHypothesis(h:Omit<Hypothesis,'fingerprint'>):Hypothesis|null{
 if(!(h.zone.high>h.zone.low)||!(h.confirmWithinBars>=1)||!fin(h.invalidationPrice))return null;
 const sane=h.kind==='breakout_up'?h.invalidationPrice<h.zone.high:h.invalidationPrice>h.zone.low;if(!sane)return null;
 const body={symbol:h.symbol,kind:h.kind,zone:h.zone,confirmWithinBars:h.confirmWithinBars,invalidationPrice:h.invalidationPrice,createdAt:h.createdAt};
 return {...body,fingerprint:fp(JSON.stringify(body))};
}
/** Judges a registered hypothesis against bars AFTER creation only. confirmed: a close beyond the zone before invalidation; invalidated: a close through the invalidation level first; expired: horizon passed with neither. */
export function resolveHypothesis(h:Hypothesis,after:Price[]):'confirmed'|'invalidated'|'expired'|'open'{
 const up=h.kind==='breakout_up';
 for(let i=0;i<after.length&&i<h.confirmWithinBars;i++){
  const c=after[i].close;
  if(up?c<=h.invalidationPrice:c>=h.invalidationPrice)return 'invalidated';
  if(up?c>h.zone.high:c<h.zone.low)return 'confirmed';
 }
 return after.length>=h.confirmWithinBars?'expired':'open';
}
