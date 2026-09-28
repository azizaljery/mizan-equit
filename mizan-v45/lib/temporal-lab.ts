import {validDate} from './analysis';
import {validSymbol} from './market-data';
import {publicBaselineEligible} from './decision-room';
import {HORIZONS} from './research-model';

/** Only observations actually recorded before the cutoff qualify. No reconstruction with today's fundamentals. */
export async function archivedAnalysis(db:any,symbol:string,date:string,now=Date.now()){
 if(!validSymbol(symbol)||!validDate(date)||date>new Date(now).toISOString().slice(0,10))throw Error('اختر رمزًا صحيحًا وتاريخًا غير مستقبلي.');
 const cutoff=date+'T23:59:59.999Z';
 const row=await db.prepare("SELECT id,created_at,data FROM analysis_snapshots WHERE symbol=? AND created_at<=? AND json_extract(data,'$.decisionBaseline.version') IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(symbol,cutoff).first();
 if(!row)return {available:false as const,reason:'لا يوجد تحليل موثق محفوظ قبل نهاية هذا التاريخ. لا نستخدم قوائم أو أخبار اليوم لإعادة بناء الماضي.',cutoff};
 const report=JSON.parse(row.data);
 if(!publicBaselineEligible(report)||report.company.symbol!==symbol||row.created_at>cutoff||!Number.isFinite(Date.parse(report.retrievedAt))||report.retrievedAt>row.created_at||report.asOf>date||report.prices.some((p:any)=>p.date>date)||report.facts.some((f:any)=>f.date>date||f.publishedAt&&Date.parse(f.publishedAt)>Date.parse(cutoff)))throw Error('لم يمكن التحقق من صلاحية الأرشيف لهذا التاريخ.');
 const saved=await db.prepare('SELECT * FROM forecast_records WHERE snapshot_id=? ORDER BY horizon').bind(row.id).all();
 if((saved.results||[]).some((r:any)=>r.created_at>row.created_at||JSON.parse(r.data).createdAt>cutoff))throw Error('يتضمن الأرشيف توقعًا مسجلًا بعد الوقت المختار؛ لم نعرضه.');
 const rows=HORIZONS.map(h=>{const r=(saved.results||[]).find((v:any)=>v.horizon===h.sessions);return r?{...JSON.parse(r.data),id:r.id}:{period:h.name,sessions:h.sessions,available:false,direction:'غير متاح',range:null,confidence:'غير محفوظة',reasons:['لم تُحفظ هذه المدة في التحليل الأصلي.']};});
 return {available:true as const,snapshotId:row.id,cutoff,observedAt:row.created_at,company:report.company,
  forecast:{rows,version:rows[0]?.model||report.decisionBaseline.model,createdAt:row.created_at,retrievedAt:report.retrievedAt,price:report.prices.at(-1)?.close??null,priceTime:report.quoteTime,currency:report.currency,recorded:true,dataQuality:'حسب التحليل المحفوظ',dataWarnings:['عرض الأرشيف كما كان عند التسجيل؛ لم نعد حسابه بأوزان اليوم.'],priceSource:report.priceSource},
  note:'آخر تحليل محفوظ قبل نهاية التاريخ المختار بتوقيت UTC، وليس بالضرورة تحليلًا صدر في اليوم نفسه. لا يُملأ فراغ الأرشيف بتوقع رجعي.'};
}
