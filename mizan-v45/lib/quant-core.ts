/** Quantitative utilities. Indices always reference the original input. */
export interface TimeIndexRecord {id:string|number;timestamp:number;labelHorizonEndTimestamp:number;}
export interface SplitWindow {windowIndex:number;trainIndices:number[];testIndices:number[];purgedCount:number;embargoedCount:number;trainStart:number;trainEnd:number;testStart:number;testEnd:number;}
export interface OOSMetrics {annualizedSharpe:number|null;maxDrawdown:number|null;calmarRatio:number|null;brierScore:number|null;deflatedSharpeProbability:number|null;isAccepted:boolean;rejectionReasons:string[];}
export class PurgedWalkForwardValidator {
  constructor(private minTrain=504,private testLen=63,private embargoPct=0.02){
    if(!Number.isSafeInteger(minTrain)||minTrain<1||!Number.isSafeInteger(testLen)||testLen<1||!Number.isFinite(embargoPct)||embargoPct<0||embargoPct>=1)throw new RangeError('إعدادات النوافذ غير صالحة.');
  }
  public generateSplits(records:TimeIndexRecord[]):SplitWindow[]{
    if(records.some(r=>!Number.isFinite(r.timestamp)||!Number.isFinite(r.labelHorizonEndTimestamp)||r.labelHorizonEndTimestamp<r.timestamp))throw new RangeError('تواريخ العينة غير صالحة.');
    const sorted=records.map((r,index)=>({...r,index})).sort((a,b)=>a.timestamp-b.timestamp);
    // Sessions are unique timestamps; all symbols at one timestamp stay together.
    const times=[...new Set(sorted.map(r=>r.timestamp))];
    const embargo=Math.ceil(times.length*this.embargoPct), blocked=new Set<number>();
    const splits:SplitWindow[]=[];
    for(let start=this.minTrain;start+this.testLen<=times.length;start+=this.testLen+embargo){
      const testStart=times[start],testEnd=times[start+this.testLen-1];
      const train:typeof sorted=[];let purgedCount=0,embargoedCount=0;
      for(const r of sorted){
        if(r.timestamp>=testStart)break;
        if(blocked.has(r.timestamp)){embargoedCount++;continue;}
        if(r.labelHorizonEndTimestamp>=testStart){purgedCount++;continue;}
        train.push(r);
      }
      // Minimum training history applies after exclusions, not before.
      if(new Set(train.map(r=>r.timestamp)).size<this.minTrain)continue;
      splits.push({windowIndex:splits.length,trainIndices:train.map(r=>r.index),testIndices:sorted.filter(r=>r.timestamp>=testStart&&r.timestamp<=testEnd).map(r=>r.index),purgedCount,embargoedCount,trainStart:train[0].timestamp,trainEnd:train.at(-1)!.timestamp,testStart,testEnd});
      for(const time of times.slice(start+this.testLen,start+this.testLen+embargo))blocked.add(time);
    }
    return splits;
  }
  /** Returns must be ordered, non-overlapping, net portfolio period returns.
   * Annualization requires an explicit frequency; arbitrary trade returns are not daily.
   * DSR cannot be estimated honestly from trial count alone (trial Sharpe dispersion missing).
   */
  public evaluateChampionship(returns:number[],probabilities:number[],outcomes:number[],numberOfTrials=10,periodsPerYear?:number):OOSMetrics{
    const result:OOSMetrics={annualizedSharpe:null,maxDrawdown:null,calmarRatio:null,brierScore:null,deflatedSharpeProbability:null,isAccepted:false,rejectionReasons:[]};
    const reasons=result.rejectionReasons;
    if(returns.length<2||returns.some(v=>!Number.isFinite(v)||v< -1)){reasons.push('عوائد غير صالحة أو عينة أقل من مشاهدتين.');return result;}
    if(!Number.isSafeInteger(numberOfTrials)||numberOfTrials<1){reasons.push('عدد التجارب غير صالح.');return result;}
    const mean=returns.reduce((s,v)=>s+v/returns.length,0);
    const std=Math.sqrt(returns.reduce((s,v)=>s+(v-mean)**2,0)/(returns.length-1));
    let equity=1,peak=1,maxDD=0;
    for(const ret of returns){equity*=1+ret;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak);}
    if(!Number.isFinite(equity)||!Number.isFinite(std)){reasons.push('تجاوز حسابي؛ لا يعتمد التقييم.');return result;}
    result.maxDrawdown=maxDD;
    if(typeof periodsPerYear==='number'&&Number.isFinite(periodsPerYear)&&periodsPerYear>0){
      const sharpe=std>0?mean/std*Math.sqrt(periodsPerYear!):null;
      const annualReturn=equity**(periodsPerYear!/returns.length)-1;
      result.annualizedSharpe=sharpe!==null&&Number.isFinite(sharpe)?sharpe:null;
      result.calmarRatio=maxDD>0&&Number.isFinite(annualReturn/maxDD)?annualReturn/maxDD:null;
    }else reasons.push('يلزم تحديد عدد فترات العائد السنوية؛ لا تفترض 252 صفقة.');
    if(probabilities.length!==outcomes.length||probabilities.length===0||probabilities.some(p=>!Number.isFinite(p)||p<0||p>1)||outcomes.some(v=>v!==0&&v!==1))reasons.push('الاحتمالات والنتائج غير متطابقة أو غير صالحة.');
    else result.brierScore=probabilities.reduce((s,p,i)=>s+(p-outcomes[i])**2,0)/probabilities.length;
    if(result.annualizedSharpe===null||result.annualizedSharpe<1.2)reasons.push('شارب غير متاح أو أقل من 1.20.');
    if(maxDD>0.12)reasons.push('أقصى تراجع تجاوز 12%.');
    if(result.calmarRatio===null||result.calmarRatio<2)reasons.push('كالفار غير متاح أو أقل من 2.0.');
    if(result.brierScore===null||result.brierScore>0.18)reasons.push('Brier غير متاح أو تجاوز 0.18.');
    reasons.push('DSR غير متاح: يلزم توزيع شارب للتجارب وإعداد تحقق مستقل؛ لا يثبت عدد التجارب وحده التفوق.');
    return result;
  }
}
export class FractionalDifferentiator {
  public static getWeights(d:number,size:number,threshold=1e-4):number[]{
    if(!Number.isFinite(d)||d<0||d>1||!Number.isSafeInteger(size)||size<0||!Number.isFinite(threshold)||threshold<=0||threshold>=1)throw new RangeError('إعدادات التفاضل غير صالحة.');
    if(size===0)return [];
    const weights=[1];
    for(let k=1;k<size;k++){const w=-weights[k-1]*(d-k+1)/k;if(Math.abs(w)<threshold)break;weights.push(w);}
    return weights;
  }
  public static transform(series:number[],d=0.38,threshold=1e-4):(number|null)[]{
    const weights=this.getWeights(d,series.length,threshold),result:(number|null)[]=new Array(series.length).fill(null);
    for(let i=Math.max(0,weights.length-1);i<series.length;i++){
      let sum=0;
      for(let j=0;j<weights.length;j++)sum+=weights[j]*series[i-j];
      result[i]=Number.isFinite(sum)?sum:null;
    }
    return result;
  }
}
