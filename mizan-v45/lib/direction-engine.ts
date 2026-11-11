/**
 * Mizan direction call v1 (experimental, measured live): always issues صاعد or هابط, never «محايد».
 * Equal-weight vote of four signs, fixed in advance (research/fcst0007): the published multi-factor tilt (the existing engine),
 * 12-1 month momentum, 6-month momentum (skipping the last 5 sessions) and the 50/200-session trend. A tied vote follows the
 * long-run base rate (صاعد). On the exposed development window this vote was right about 51-55% of the time (about 55-59% for
 * strong votes at three months) and did not beat «always up»; it is published to be measured, not as a proven edge.
 * The target is the stock's own typical move for the horizon in the called direction: «if the direction is right», not an expected value.
 */
export const DIRECTION_POLICY='mizan-direction-v1';
export type DirectionCall={policy:string;direction:'صاعد'|'هابط';strength:'ضعيفة'|'متوسطة'|'قوية';votes:number;components:{key:string;name:string;sign:-1|0|1}[];
  typicalMovePct:number|null;targetPrice:number|null;targetChangePct:number|null;experimental:true};
const sign=(v:number|null):-1|0|1=>v===null||!Number.isFinite(v)||v===0?0:v>0?1:-1;
const sma=(c:readonly number[],t:number,n:number)=>{let s=0;for(let i=t-n+1;i<=t;i++)s+=c[i];return s/n;};
export function directionCall(input:{closes:readonly number[];bias:number;price:number;horizonReturns:readonly number[]}):DirectionCall {
  const c=input.closes,t=c.length-1,ok=(i:number)=>i>=0&&Number.isFinite(c[i])&&c[i]>0;
  const mom12=t>=252&&ok(t-21)&&ok(t-252)?Math.log(c[t-21]/c[t-252]):null;
  const mom6=t>=126&&ok(t-5)&&ok(t-126)?Math.log(c[t-5]/c[t-126]):null;
  const trend=t>=199&&c.slice(t-199).every(v=>Number.isFinite(v)&&v>0)?sma(c,t,50)/sma(c,t,200)-1:null;
  const components=[{key:'engine',name:'محرك ميزان متعدد العوامل',sign:sign(input.bias)},{key:'mom12_1',name:'زخم 12 شهرًا دون الشهر الأخير',sign:sign(mom12)},
    {key:'mom6',name:'زخم 6 أشهر',sign:sign(mom6)},{key:'trend',name:'اتجاه المتوسطين 50 و200',sign:sign(trend)}];
  const votes=components.reduce((s,x)=>s+x.sign,0),direction=votes<0?'هابط':'صاعد',a=Math.abs(votes);
  const abs=input.horizonReturns.filter(Number.isFinite).map(Math.abs).sort((x,y)=>x-y);
  const typical=abs.length>=20?abs[Math.floor((abs.length-1)/2)]:null,valid=typical!==null&&typical>0&&Number.isFinite(input.price)&&input.price>0;
  const targetPrice=valid?input.price*Math.exp((direction==='صاعد'?1:-1)*typical!):null;
  return {policy:DIRECTION_POLICY,direction,strength:a>=4?'قوية':a>=2?'متوسطة':'ضعيفة',votes,components,typicalMovePct:valid?100*(Math.exp(typical!)-1):null,
    targetPrice,targetChangePct:targetPrice===null?null:100*(targetPrice/input.price-1),experimental:true};
}
/** Scores the saved call only: right when the end close moved in the called direction; an unchanged close is not scored. */
export function evaluateDirectionCall(forecast:any,actual:number):{policy:string;direction:string;strength:string;correct:boolean|null;targetErrorPct:number|null}|null {
  const call=forecast?.call;
  if(call?.policy!==DIRECTION_POLICY||!['صاعد','هابط'].includes(call.direction)||!(forecast.price>0)||!(actual>0))return null;
  const move=actual-forecast.price;
  return {policy:DIRECTION_POLICY,direction:call.direction,strength:call.strength,correct:move===0?null:(move>0)===(call.direction==='صاعد'),
    targetErrorPct:call.targetPrice>0?100*Math.abs(actual-call.targetPrice)/actual:null};
}
