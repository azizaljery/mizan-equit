/** Rule-based market states; weights are not calibrated probabilities. */
export type MarketRegimeType = 'BULL_TREND' | 'MEAN_REVERTING' | 'VOLATILITY_SHOCK';
export interface RegimeState {
  currentRegime: MarketRegimeType | null;
  probabilities: { bull: number; meanReverting: number; shock: number } | null;
  structuralBreakDetected: boolean;
  volatilityRatio: number | null;
  regimeStabilityScore: number | null;
  available: boolean;
  calibrated: false;
  reason: string;
}
export class RegimeEngine {
  public static detect(prices: number[]): RegimeState {
    const missing = (reason: string): RegimeState => ({currentRegime:null,probabilities:null,structuralBreakDetected:false,volatilityRatio:null,regimeStabilityScore:null,available:false,calibrated:false,reason});
    if (prices.some(p => !Number.isFinite(p) || p <= 0)) return missing('أسعار غير صالحة؛ لا يصدر تصنيف.');
    if (prices.length < 25) return missing('يلزم 25 جلسة على الأقل.');
    const returns = prices.slice(1).map((p,i) => Math.log(p)-Math.log(prices[i]));
    const vol5 = this.calcStdDev(returns.slice(-5));
    const vol20 = this.calcStdDev(returns.slice(-20));
    const ratio = vol20 > 1e-12 ? vol5/vol20 : 1;
    const current = prices[prices.length-1];
    const sma20 = prices.slice(-20).reduce((s,p)=>s+p/20,0);
    const z = vol20 > 1e-12 ? (current-sma20)/(vol20*current) : 0;
    const structuralBreak = vol20 > 1e-12 && (Math.abs(returns.at(-1)!) > 2.8*vol20 || ratio > 2.2);
    let bull=0.20, meanReverting=0.65, shock=0.15;
    if(ratio>1.6 || structuralBreak){bull=0.15;meanReverting=0.15;shock=0.70;}
    else if(z>1.2 && ratio<=1.2){bull=0.70;meanReverting=0.20;shock=0.10;}
    else if(z< -1.2 && ratio>1.3){bull=0.10;meanReverting=0.30;shock=0.60;}
    return {available:true,calibrated:false,currentRegime:shock>0.5?'VOLATILITY_SHOCK':bull>0.5?'BULL_TREND':'MEAN_REVERTING',probabilities:{bull,meanReverting,shock},structuralBreakDetected:structuralBreak,volatilityRatio:ratio,regimeStabilityScore:Math.max(0,Math.min(100,Math.round((1-(structuralBreak?0.6:0)-Math.abs(ratio-1)*0.3)*100))),reason:'تصنيف وصفي بالقواعد؛ الأوزان ليست احتمالات مُعايرة ولا إثباتًا لانخفاض المخاطر أو لانكسار هيكلي.'};
  }
  private static calcStdDev(values:number[]):number {
    if(values.length<2)return 0;
    const mean=values.reduce((s,v)=>s+v,0)/values.length;
    return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1));
  }
}
