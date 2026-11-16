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
 minPierceFrac:0.05,      // a spring/upthrust must pierce the bound by at least this fraction of the range height (a trend poking 0.2% above its own old high is not one)
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
   if(low-p.low>=params.minPierceFrac*(high-low)&&p.low<low){const back=inside(p.close)||(next&&inside(next.close));if(back)out.events.push({id:'W-013',name:'Spring',index:i,date:p.date,evidence:{rangeLow:low,barLow:p.low,penetrationPct:100*(low-p.low)/low,closeBackInside:inside(p.close)?'same_bar':'next_bar',volumeRatio:vr}});}
   if(p.high-high>=params.minPierceFrac*(high-low)&&p.high>high){const back=inside(p.close)||(next&&inside(next.close));if(back)out.events.push({id:'W-019',name:'Upthrust',index:i,date:p.date,evidence:{rangeHigh:high,barHigh:p.high,penetrationPct:100*(p.high-high)/high,closeBackInside:inside(p.close)?'same_bar':'next_bar',volumeRatio:vr}});}
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

/* ------------------------------------------------------------------ batch 2: climaxes, follow-ups, Elliott corrections/extensions/alternation, retest ------------------------------------------------------------------ */
export const CLIMAX_PARAMS=Object.freeze({
 lookback:40,           // climax bar must be the extreme of this many prior bars
 avgBars:20,
 volumeMultiple:2,      // volume >= this multiple of the 20-bar average
 rangeMultiple:2,       // bar range >= this multiple of the 20-bar average range
 reboundBars:5,         // confirmation window
 reboundFrac:0.5,       // reversal of at least this fraction of the climax bar range (measured from its close)
 arBars:10,             // window to find the automatic rally/reaction
 arMultiple:1,          // AR must move at least one climax-bar range beyond the climax close
 stBars:20,             // window after AR for the secondary test
 stVolumeMax:0.7,       // ST volume <= this multiple of climax volume
 psBars:10,psVolume:1.5,psTrend:20, // preliminary support/supply: up to 10 bars before, volume 1.5x, against the 20-bar drift
});
export type ClimaxSequence={side:'sell'|'buy';climax:StructureEvent;confirmedAt:number;ps:StructureEvent|null;ar:StructureEvent|null;st:StructureEvent|null};
/** SC/AR/ST/PS (selling side) and BC/AR/ST/PSY (buying side) as pre-declared numeric rules. Each stage lists its evidence; a missing stage is null and is a normal answer. */
export function wyckoffClimaxes(prices:Price[],p=CLIMAX_PARAMS):ClimaxSequence[]{
 const out:ClimaxSequence[]=[],n=prices.length;
 const win=(i:number)=>prices.slice(Math.max(0,i-p.avgBars),i);
 for(let i=p.lookback;i<n;i++){
  const b=prices[i];if(!okBar(b))continue;
  const prev=win(i);if(prev.length<p.avgBars||prev.some(x=>!okBar(x)))continue;
  const av=avg(prev.map(x=>x.volume)),ar=avg(prev.map(x=>x.high-x.low)),range=b.high-b.low;
  if(!(av>0)||!(ar>0)||b.volume<p.volumeMultiple*av||range<p.rangeMultiple*ar)continue;
  const look=prices.slice(i-p.lookback,i);
  for(const side of ['sell','buy'] as const){
   const sell=side==='sell';
   const extreme=sell?look.every(x=>b.low<=x.low):look.every(x=>b.high>=x.high);if(!extreme)continue;
   let conf=-1;
   for(let j=i+1;j<=i+p.reboundBars&&j<n;j++){const c=prices[j].close;if(sell?c>=b.close+p.reboundFrac*range:c<=b.close-p.reboundFrac*range){conf=j;break;}}
   if(conf<0)continue;
   const mk=(id:string,name:string,index:number,evidence:Record<string,number|string>):StructureEvent=>({id,name,index,date:prices[index].date,evidence});
   const climax=mk(sell?'W-010':'W-018',sell?'SC':'BC',i,{volumeRatio:b.volume/av,rangeRatio:range/ar,extreme:sell?b.low:b.high,confirmedAtIndex:conf});
   let ps:StructureEvent|null=null;
   for(let j=Math.max(p.psTrend,i-p.psBars);j<i;j++){const x=prices[j],a=avg(prices.slice(Math.max(0,j-p.avgBars),j).map(y=>y.volume)),mid=(x.high+x.low)/2;
    if(a>0&&x.volume>=p.psVolume*a&&(sell?x.close>=mid&&x.close<prices[j-p.psTrend].close:x.close<=mid&&x.close>prices[j-p.psTrend].close)){ps=mk(sell?'W-009':'W-017',sell?'PS':'PSY',j,{volumeRatio:x.volume/a});break;}}
   let arEv:StructureEvent|null=null;
   let best=-1;for(let j=i+1;j<=i+p.arBars&&j<n;j++){if(best<0||(sell?prices[j].high>prices[best].high:prices[j].low<prices[best].low))best=j;}
   if(best>=0&&(sell?prices[best].high>=b.close+p.arMultiple*range:prices[best].low<=b.close-p.arMultiple*range))arEv=mk('W-011','AR',best,{level:sell?prices[best].high:prices[best].low,moveInClimaxRanges:Math.abs((sell?prices[best].high-b.close:b.close-prices[best].low))/range});
   let st:StructureEvent|null=null;
   if(arEv)for(let j=arEv.index+1;j<=arEv.index+p.stBars&&j<n;j++){const x=prices[j];
    const inZone=sell?x.low>=b.low-0.25*range&&x.low<=b.low+0.5*range:x.high<=b.high+0.25*range&&x.high>=b.high-0.5*range;
    if(inZone&&x.volume<=p.stVolumeMax*b.volume){st=mk('W-012','ST',j,{volumeVsClimax:x.volume/b.volume,extreme:sell?x.low:x.high});break;}}
   out.push({side,climax,confirmedAt:conf,ps,ar:arEv,st});
  }
 }
 return out;
}

const FOLLOW={maxBars:10,zoneFrac:0.25,volumeMax:1,testVolumeMax:0.7,utadBars:3};
/** W-016 LPS: after an SOS, a limited pullback that stays above the old range high (within 25% of the range height) on lower volume than the SOS bar. */
export function lpsAfterSos(prices:Price[],sosIndex:number,rangeHigh:number,rangeLow:number):StructureEvent|null{
 const h=rangeHigh-rangeLow,s=prices[sosIndex];if(!s||!(h>0))return null;
 for(let j=sosIndex+1;j<=sosIndex+FOLLOW.maxBars&&j<prices.length;j++){const x=prices[j];
  if(x.low>=rangeHigh&&x.low<=rangeHigh+FOLLOW.zoneFrac*h&&x.volume<s.volume*FOLLOW.volumeMax)return {id:'W-016',name:'LPS',index:j,date:x.date,evidence:{low:x.low,rangeHigh,volumeVsSos:x.volume/s.volume}};}
 return null;
}
/** W-022 LPSY: after an SOW, a weak rally that stays below the old range low (within 25% of the range height) on lower volume than the SOW bar. */
export function lpsyAfterSow(prices:Price[],sowIndex:number,rangeHigh:number,rangeLow:number):StructureEvent|null{
 const h=rangeHigh-rangeLow,s=prices[sowIndex];if(!s||!(h>0))return null;
 for(let j=sowIndex+1;j<=sowIndex+FOLLOW.maxBars&&j<prices.length;j++){const x=prices[j];
  if(x.high<=rangeLow&&x.high>=rangeLow-FOLLOW.zoneFrac*h&&x.volume<s.volume*FOLLOW.volumeMax)return {id:'W-022',name:'LPSY',index:j,date:x.date,evidence:{high:x.high,rangeLow,volumeVsSow:x.volume/s.volume}};}
 return null;
}
/** W-014 Test: after a Spring, a later bar that holds above the spring low, inside the lower quarter of the range, on <= 70% of the spring volume. */
export function testAfterSpring(prices:Price[],springIndex:number,rangeLow:number,rangeHigh:number):StructureEvent|null{
 const h=rangeHigh-rangeLow,s=prices[springIndex];if(!s||!(h>0))return null;
 for(let j=springIndex+1;j<=springIndex+FOLLOW.maxBars&&j<prices.length;j++){const x=prices[j];
  if(x.low>s.low&&x.low<=rangeLow+FOLLOW.zoneFrac*h&&x.volume<=s.volume*FOLLOW.testVolumeMax)return {id:'W-014',name:'Test',index:j,date:x.date,evidence:{low:x.low,springLow:s.low,volumeVsSpring:x.volume/s.volume}};}
 return null;
}
/** W-020 UTAD: an upthrust that is followed within 3 bars by a close below the range midpoint (the failure a distribution needs). */
export function utadConfirm(prices:Price[],upthrustIndex:number,rangeLow:number,rangeHigh:number):StructureEvent|null{
 const mid=(rangeLow+rangeHigh)/2;
 for(let j=upthrustIndex+1;j<=upthrustIndex+FOLLOW.utadBars&&j<prices.length;j++)if(prices[j].close<mid)return {id:'W-020',name:'UTAD',index:j,date:prices[j].date,evidence:{rangeMid:mid,close:prices[j].close,barsAfterUpthrust:j-upthrustIndex}};
 return null;
}

/** W-035: A-B-C against a trend from four points (start, A end, B end, C end). Labels are rule outputs; "unclassified" is a valid answer and nothing is forced into a pattern. */
export function correctionAudit(points:number[],againstTrend:'down'|'up'){
 if(points.length!==4||points.some(v=>!fin(v)))return null;
 const s=againstTrend==='down'?1:-1,q=points.map(v=>s*v),a=q[0]-q[1];
 const shape=a>0&&q[2]>q[1]&&q[3]<q[2];
 if(!shape)return {valid:false,label:'invalid_shape' as const,bRetracement:NaN,cBeyondAEnd:false};
 const bRet=(q[2]-q[1])/a,beyond=q[3]<q[1],nearA=Math.abs(q[3]-q[1])<=0.1*a;
 const label=bRet<=0.786&&beyond?'zigzag' as const:bRet>=0.9&&bRet<=1&&nearA?'flat' as const:bRet>1&&beyond?'expanded_flat' as const:'unclassified' as const;
 return {valid:true,label,bRetracement:bRet,cBeyondAEnd:beyond};
}
/** W-036: wave-length ratios only. Which of waves 1/3/5 is longest and whether it is at least 1.618x the longer of the other two. No target is produced. */
export function extensionAudit(points:number[]){
 if(points.length!==6||points.some(v=>!fin(v)))return null;
 const w=[Math.abs(points[1]-points[0]),Math.abs(points[3]-points[2]),Math.abs(points[5]-points[4])],longest=w.indexOf(Math.max(...w));
 const others=w.filter((_,i)=>i!==longest),ratio=Math.max(...others)>0?w[longest]/Math.max(...others):NaN;
 return {lengths:w,longestWave:[1,3,5][longest],ratioToNext:ratio,extended:ratio>=1.618,w3OverW1:w[0]>0?w[1]/w[0]:NaN,w5OverW1:w[0]>0?w[2]/w[0]:NaN};
}
/** W-037: compares correction 2 and 4 by depth (fraction of the preceding impulse leg retraced) and duration (bars). Descriptive; exceptions are normal. */
export function alternationAudit(points:number[],indices:number[]){
 if(points.length!==6||indices.length!==6||points.some(v=>!fin(v))||indices.some(v=>!fin(v)))return null;
 const w1=Math.abs(points[1]-points[0]),w3=Math.abs(points[3]-points[2]);if(!(w1>0)||!(w3>0))return null;
 const d2=Math.abs(points[1]-points[2])/w1,d4=Math.abs(points[3]-points[4])/w3,t2=indices[2]-indices[1],t4=indices[4]-indices[3];
 const timeRatio=t4>0?t2/t4:NaN,depthDiffers=Math.abs(d2-d4)>=0.2,timeDiffers=timeRatio>=1.5||timeRatio<=2/3;
 return {depth2:d2,depth4:d4,bars2:t2,bars4:t4,depthDiffers,timeDiffers,alternates:depthDiffers||timeDiffers};
}
/** W-034: an ending-diagonal candidate needs wave 4 to overlap wave 1 while 1,3,5 contract (w3<w1 and w5<w3). Named explicitly, never merged into the standard impulse. */
export function diagonalCandidate(points:number[],direction:'up'|'down'){
 const a=elliottImpulseAudit(points,direction);if(!a)return null;
 const w1=Math.abs(points[1]-points[0]),w3=Math.abs(points[3]-points[2]),w5=Math.abs(points[5]-points[4]);
 const byId=(id:string)=>a.rules.find(r=>r.id===id)!.passed;
 const candidate=byId('W-030')&&byId('W-031')&&!byId('W-033')&&w3<w1&&w5<w3;
 return {candidate,overlap:!byId('W-033'),contracting:w3<w1&&w5<w3,lengths:[w1,w3,w5]};
}
/** W-042: first return to a broken level within `maxBars` bars (1% tolerance); result "held" when it closes back on the breakout side, else "failed". */
export function retestAudit(prices:Price[],breakIndex:number,level:number,direction:'up'|'down',maxBars=10,tolPct=1){
 const b=prices[breakIndex];if(!b||!fin(level)||!(level>0))return null;
 const tol=level*tolPct/100;
 for(let j=breakIndex+1;j<=breakIndex+maxBars&&j<prices.length;j++){const x=prices[j];
  const touched=direction==='up'?x.low<=level+tol:x.high>=level-tol;
  if(touched){const held=direction==='up'?x.close>=level:x.close<=level;return {index:j,date:x.date,result:held?'held' as const:'failed' as const,barsAfterBreak:j-breakIndex,volumeVsBreak:b.volume>0?x.volume/b.volume:NaN};}
 }
 return null;
}
