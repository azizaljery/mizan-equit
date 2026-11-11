// @ts-ignore -- the research package is plain JavaScript without type declarations
import {runAzizHybridReplay} from '../../research/aziz/src/hybrid-replay.mjs';

/**
 * Aziz experimental reading: runs the Aziz hybrid replay (path signatures + HAR + stacked ridge + matured conformal range)
 * on the stock's own recent daily history and returns its latest reading together with how the same procedure scored on
 * that stock's past. Exploratory only: prices carry retrieval time, not publication time, so nothing here is a validated
 * or approved model, and it never feeds Mizan's forecasts, picks or records.
 */
export const AZIZ_READING_POLICY='aziz-experimental-reading-v1';
export const AZIZ_READING_BARS=800;
export type AzizReading={policy:string;exploratory:true;approved:false;symbol:string;market:'sa'|'us';horizon:5|21;status:'available'|'unavailable';reason:string|null;
  asOf:string|null;price:number|null;direction:'صاعد'|'هابط'|null;pointPrice:number|null;changePct:number|null;range:[number,number]|null;rangeTarget:number|null;
  history:{evaluated:number;directionAccuracyPct:number|null;baselineDirectionAccuracyPct:number|null;coveragePct:number|null;maeLogPct:number|null;baselineMaeLogPct:number|null};barsUsed:number;algorithm:string|null};
type Bar={date:string;open:number;high:number;low:number;close:number;volume:number};
const ok=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function azizExperimentalReading(input:{symbol:string;market:'sa'|'us';currency:string;source:string;prices:readonly Bar[];horizon:5|21}):AzizReading {
  const empty={evaluated:0,directionAccuracyPct:null,baselineDirectionAccuracyPct:null,coveragePct:null,maeLogPct:null,baselineMaeLogPct:null};
  const base:AzizReading={policy:AZIZ_READING_POLICY,exploratory:true,approved:false,symbol:input.symbol,market:input.market,horizon:input.horizon,status:'unavailable',reason:null,
    asOf:null,price:null,direction:null,pointPrice:null,changePct:null,range:null,rangeTarget:null,history:empty,barsUsed:0,algorithm:null};
  const clean:Bar[]=[];
  for(const p of input.prices){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!ok(p.close)||p.close<=0||!ok(p.volume)||p.volume<0)continue;
    if(clean.length&&p.date<=clean[clean.length-1].date)continue;
    clean.push(p);
  }
  const used=clean.slice(-AZIZ_READING_BARS);
  if(used.length<300)return {...base,reason:'السلسلة السعرية أقصر من 300 جلسة؛ لا تكفي لتدريب القراءة ومعايرتها.',barsUsed:used.length};
  const market=input.market==='sa'?'SA':'US',priceBasis='provider-adjusted-daily';
  const bars=used.map((p,i)=>({sessionIndex:i,observedAt:p.date+'T16:00:00Z',availableAt:p.date+'T20:00:00Z',market,symbol:input.symbol,priceBasis,open:p.open,high:p.high,low:p.low,close:p.close,volume:p.volume}));
  let r:any;
  try{
    r=runAzizHybridReplay({schemaVersion:1,market,symbol:input.symbol,currency:input.currency,priceBasis,calendarId:'provider-sessions',
      provenance:{source:input.source||'provider',pointInTime:false,basis:'retrieval_time_only',adjustmentPolicy:'provider-adjusted'},bars},
      {horizon:input.horizon,evaluationAsOf:used[used.length-1].date+'T23:59:00Z',exploratory:true});
  }catch(e){return {...base,reason:'تعذر تشغيل قراءة عزيز على هذه السلسلة: '+(e instanceof Error?e.message:'خطأ غير معروف').slice(0,160),barsUsed:used.length};}
  const m=r.metrics||{},pct=(v:unknown)=>ok(v)?100*v:null;
  const history={evaluated:m.count||0,directionAccuracyPct:pct(m.directionAccuracy),baselineDirectionAccuracyPct:pct(m.baselineDirectionAccuracy),coveragePct:pct(m.coverage),maeLogPct:pct(m.mae),baselineMaeLogPct:pct(m.baselineMae)};
  const last=r.issued?.[r.issued.length-1],withHistory={...base,history,barsUsed:used.length,algorithm:r.algorithm||null};
  if(!last||last.index!==bars.length-1)return {...withHistory,reason:'لم تصدر قراءة لآخر جلسة (تدريب أو معايرة غير مكتملة لهذه السلسلة).'};
  const price=last.price as number,point=last.pointPrice as number,iv=last.interval;
  const range:[number,number]|null=iv?.status==='available'&&ok(iv.lowerLogReturn)&&ok(iv.upperLogReturn)?[price*Math.exp(iv.lowerLogReturn),price*Math.exp(iv.upperLogReturn)]:null;
  return {...withHistory,status:'available',asOf:used[used.length-1].date,price,direction:last.meanLogReturn>=0?'صاعد':'هابط',pointPrice:point,changePct:100*(point/price-1),
    range,rangeTarget:range?100*(1-(r.policy?.alpha??0.1)):null};
}
