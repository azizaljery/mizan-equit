/** Diagnostic arithmetic for the existing scenario model. No trained probabilities or new gating policy. */
export type ForecastBlock={code:string;message:string};
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export function sampleDeviation(xs:number[]):number|null{
 if(xs.length<2||!xs.every(finite))return null;
 const mean=xs.reduce((a,b)=>a+b,0)/xs.length;
 return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(xs.length-1));
}
export function scenarioCenter(input:{bias:number;sessions:number;dailySigma:number;expectedScale:number;positiveTiltMultiplier:number}){
 const {bias,sessions,dailySigma,expectedScale,positiveTiltMultiplier}=input;
 if(![bias,sessions,dailySigma,expectedScale,positiveTiltMultiplier].every(finite)||sessions<=0||dailySigma<0||expectedScale<0)throw new RangeError('Invalid scenario arithmetic');
 const requestedLogReturn=sessions===1?bias*dailySigma*.25:bias*.15*sessions/252;
 const maxAbsLogReturn=expectedScale*.5;
 const clippedLogReturn=Math.max(-maxAbsLogReturn,Math.min(maxAbsLogReturn,requestedLogReturn));
 const centerLogReturn=clippedLogReturn>0?clippedLogReturn*positiveTiltMultiplier:clippedLogReturn;
 return {requestedLogReturn,maxAbsLogReturn,clippedLogReturn,centerLogReturn,clipped:Math.abs(requestedLogReturn)>maxAbsLogReturn,annualLogTilt: sessions===1?null:bias*.15};
}
export function inspectScenarioRange(input:{low:number;high:number;reference:number;sigma:number;expectedScale:number;maxSigma:number;longJump:boolean}):ForecastBlock[]{
 const {low,high,reference,sigma,expectedScale,maxSigma,longJump}=input,blocks:ForecastBlock[]=[];
 if(![low,high,reference].every(finite)||low<=0||high<=low||reference<=0)blocks.push({code:'range_invalid',message:'حدود النطاق غير صالحة أو غير مرتبة.'});
 if(!finite(sigma)||sigma<=0||!finite(expectedScale)||expectedScale<=0)blocks.push({code:'volatility_unavailable',message:'لا يتوفر تقدير تذبذب موجب صالح لبناء النطاق.'});
 if(low>0&&high>low&&reference>0&&finite(expectedScale)&&expectedScale>0&&Math.max(Math.abs(Math.log(high/reference)),Math.abs(Math.log(low/reference)))>maxSigma*expectedScale)blocks.push({code:'range_too_wide',message:'اتساع النطاق تجاوز سياسة فحص التذبذب؛ يلزم مراجعة الحالة.'});
 if(longJump)blocks.push({code:'corporate_action_or_jump_unresolved',message:'رُصدت قفزة كبيرة؛ يلزم التحقق من الحدث أو تعديل رأس المال.'});
 return blocks;
}
export function shockEvidence(closes:number[]){
 if(closes.length<25||closes.some(x=>!finite(x)||x<=0))return {available:false,lastLogReturn:null,sigma20IncludingLatest:null,sigma20Prior:null,ratio5to20:null,lastOverSigma20:null,threshold:2.8,windowIncludesLatest:true};
 const rs=closes.slice(1).map((p,i)=>Math.log(p)-Math.log(closes[i])),s20=sampleDeviation(rs.slice(-20)),prior=sampleDeviation(rs.slice(-21,-1)),s5=sampleDeviation(rs.slice(-5)),last=rs.at(-1)!;
 return {available:true,lastLogReturn:last,sigma20IncludingLatest:s20,sigma20Prior:prior,ratio5to20:s20!==null&&s20>1e-12?s5!/s20:1,lastOverSigma20:s20!==null&&s20>1e-12?Math.abs(last)/s20:null,threshold:2.8,windowIncludesLatest:true};
}
export function forecastDiagnostic(input:{sessions:number;blocks:ForecastBlock[];closes:number[];sourceAsOf:string;pointAvailable:boolean;rangeAvailable:boolean;center?:ReturnType<typeof scenarioCenter>;range?:{low:number;high:number;reference:number;expectedScale:number;maxSigma:number};neutralThresholdPct?:number}){
 const {sessions,blocks,closes,sourceAsOf,pointAvailable,rangeAvailable,center,range,neutralThresholdPct}=input;
 return {schemaVersion:1,engine:'mizan-scenarios',sessions,sourceAsOf,priceCount:closes.length,
  state:blocks.length?'forecast_abstained':'scenario_available',blockers:blocks.map(x=>({...x})),
  outputs:{point:{available:pointAvailable},range:{available:rangeAvailable,calibrated:false},probability:{available:false,reason:'not_calibrated'}},
  shock:shockEvidence(closes),center:center??null,neutralThresholdPct:neutralThresholdPct??null,
  range:range?{...range,maxAbsLogDistance:Math.max(Math.abs(Math.log(range.high/range.reference)),Math.abs(Math.log(range.low/range.reference))),permittedLogDistance:range.maxSigma*range.expectedScale}:null};
}
