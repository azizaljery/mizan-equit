import type {MarketRegimeType} from './regime-engine';

export interface BaseExpertSignal {
  expertId:'trend_momentum'|'mean_reversion'|'structural_flow'|'fundamental_drift';
  prediction:number; confidence:number; varianceEstimate:number;
}
export interface GatingResult {
  combinedSignal:number; posteriorConfidence:number; activeWeights:Record<string,number>;
  shouldAbstain:boolean; abstainReason?:string; calibrated:false;
}
/** Deterministic precision weighting, not calibrated Bayesian probabilities. */
export class DynamicGatingEngine {
  private static readonly REGIME_PRIORS:Record<MarketRegimeType,Record<BaseExpertSignal['expertId'],number>>={
    BULL_TREND:{trend_momentum:.5,fundamental_drift:.3,structural_flow:.15,mean_reversion:.05},
    MEAN_REVERTING:{mean_reversion:.55,structural_flow:.25,trend_momentum:.1,fundamental_drift:.1},
    VOLATILITY_SHOCK:{structural_flow:.45,fundamental_drift:.35,mean_reversion:.15,trend_momentum:.05},
  };
  static fuse(experts:BaseExpertSignal[],regime:MarketRegimeType|null,structuralBreak:boolean,regimeStabilityScore:number|null):GatingResult {
    const abstain=(abstainReason:string):GatingResult=>({combinedSignal:0,posteriorConfidence:0,activeWeights:{},shouldAbstain:true,abstainReason,calibrated:false});
    if(!regime||!Object.hasOwn(this.REGIME_PRIORS,regime)||typeof structuralBreak!=='boolean'||typeof regimeStabilityScore!=='number'||!Number.isFinite(regimeStabilityScore)||regimeStabilityScore<0||regimeStabilityScore>100)return abstain('حالة السوق أو درجة الاستقرار غير متاحة.');
    if(structuralBreak||regime==='VOLATILITY_SHOCK')return abstain('رُصدت صدمة تقلب أو كسر محتمل؛ يلزم التحقق قبل اعتماد الإشارة.');
    if(regimeStabilityScore<40)return abstain('درجة استقرار الحالة أقل من 40/100.');
    const priors=this.REGIME_PRIORS[regime];
    if(!Array.isArray(experts)||!experts.length||experts.some(e=>!e||!Object.hasOwn(priors,e.expertId)||!Number.isFinite(e.prediction)||Math.abs(e.prediction)>1||!Number.isFinite(e.confidence)||e.confidence<0||e.confidence>1||!Number.isFinite(e.varianceEstimate)||e.varianceEstimate<0)||new Set(experts.map(e=>e.expertId)).size!==experts.length)return abstain('إشارات الخبراء ناقصة أو غير صالحة أو مكررة.');
    const raw=experts.map(e=>priors[e.expertId]*e.confidence/Math.max(1e-4,e.varianceEstimate));
    const total=raw.reduce((s,v)=>s+v,0);
    if(!(total>0))return abstain('لا توجد أوزان موثوقة قابلة للدمج.');
    const activeWeights:Record<string,number>={};let combinedSignal=0,confidence=0;
    experts.forEach((e,i)=>{const w=raw[i]/total;activeWeights[e.expertId]=w;combinedSignal+=w*e.prediction;confidence+=w*e.confidence;});
    if(experts.filter((e,i)=>raw[i]>0&&Math.sign(e.prediction)!==Math.sign(combinedSignal)&&Math.abs(e.prediction)>.2).length>=2)confidence*=.6;
    const shouldAbstain=confidence<.55||Math.abs(combinedSignal)<.15;
    return {combinedSignal,posteriorConfidence:confidence,activeWeights,shouldAbstain,calibrated:false,abstainReason:shouldAbstain?'الإشارة أو درجة الثقة الوصفية دون الحد المحدد.':undefined};
  }
}
