import {fmt} from '@/lib/analysis';
import type {ConformalResult,RangeComparison} from '@/lib/forecast-conformal';

export function ForecastRangeOutcome({value}:{value?:RangeComparison|null}) {
  if(!value)return null;
  return <div aria-label="نتيجة مقارنة النطاقين">
    <h4>مقارنة النطاقين على سعر النهاية نفسه</h4>
    <p>التجريبي: {value.candidateHit?'داخل النطاق':'خارج النطاق'} · الحالي: {value.baselineHit?'داخل النطاق':'خارج النطاق'}.</p>
    <p>العرض عند الإصدار: التجريبي {fmt(value.candidateWidthPct)}% · الحالي {fmt(value.baselineWidthPct)}%.</p>
    <p>درجة الاتساع وتجاوز الحدود — الأقل أفضل: التجريبي {fmt(value.candidateIntervalScorePct)} · الحالي {fmt(value.baselineIntervalScorePct)}.</p>
    <p>هذه نتيجة توقع واحد، ولا تمثل نسبة نجاح عامة.</p>
  </div>;
}

export function ForecastRangeCalibration({value,currency}:{value?:ConformalResult;currency:string}) {
  if(!value)return <p>معايرة النطاق: لم تُحفظ في هذا التوقع. التحليل الجديد يبدأ من السجل المتاح.</p>;
  if(!value.observed)return <p>معايرة النطاق: {value.reason}</p>;
  const o=value.observed;
  return <div aria-label="معايرة نطاق السعر">
    <h4>معايرة نطاق السعر</h4>
    <p>{value.reason}</p>
    <p>التغطية المستهدفة {fmt(value.targetCoverage*100,0)}% · عينة المعايرة {value.sample} من {value.minimumSample} كحد أدنى.</p>
    {value.status==='shadow'&&value.range&&<>
      <p>النطاق التجريبي لنهاية المدة: <bdi>{fmt(value.range[0])} – {fmt(value.range[1])} {currency}</bdi> · عرضه {fmt(value.widthPct)}% من سعر الإصدار.</p>
      <p>يُقاس بجوار النطاق الحالي قبل اعتماد تغييره؛ لا يؤكد اتجاهًا أو قرار شراء.</p>
    </>}
    <p>المعايرة للسهم والعملة ونسخة النموذج والمدة نفسها، من نتائج عُرفت قبل إصدار التوقع، مع استبعاد النوافذ المتداخلة.</p>
    {value.historyTruncated&&<p>المقارنة مبنية على جزء محدود من أحدث السجلات؛ قد توجد نتائج أقدم خارج العينة.</p>}
    {o.sample>0?<>
      <p>نتائج نطاقات تجريبية سابقة حُفظت قبل ظهور أسعار نهايتها: {o.sample}.</p>
      <p>وقوع السعر داخل النطاق: التجريبي {fmt(o.candidateCoveragePct)}% · الحالي {fmt(o.baselineCoveragePct)}%.</p>
      <p>متوسط العرض على الحالات نفسها: التجريبي {fmt(o.candidateMeanWidthPct)}% · الحالي {fmt(o.baselineMeanWidthPct)}%.</p>
      <p>درجة اتساع النطاق وتجاوز حدوده — الأقل أفضل: التجريبي {fmt(o.candidateMeanIntervalScorePct)} · الحالي {fmt(o.baselineMeanIntervalScorePct)}.</p>
      {o.sample<value.minimumSample&&<p>عينة المقارنة صغيرة؛ النسب وصف للنتائج المتاحة ولا تثبت التفوق.</p>}
    </>:<p>التغطية المحققة للنطاق التجريبي: لم تتوفر نتائج سابقة مكتملة لقياسها.</p>}
    <p>التغطية تختلف عن صحة الاتجاه والثقة. تغير السوق قد يخفضها؛ لا يوجد ضمان لكل توقع منفرد.</p>
  </div>;
}
