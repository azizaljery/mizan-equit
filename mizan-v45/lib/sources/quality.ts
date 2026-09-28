import type {
  DataQuality,
  QualityGrade,
  Provenance,
  ConflictResult,
  SourceHealth,
  FetchResult,
  DataType,
} from './types';

const GRADE_ORDER: QualityGrade[] = [
  'invalid',
  'weak',
  'medium',
  'good',
  'excellent',
];

const LABELS: Record<QualityGrade,string> = {
  excellent:'ممتازة',
  good:'جيدة',
  medium:'متوسطة',
  weak:'ضعيفة',
  invalid:'غير صالحة',
};

export function labelOf(g:QualityGrade){return LABELS[g];}

export function isGradeSufficient(
  actual:QualityGrade,
  minimum:QualityGrade,
){
  return GRADE_ORDER.indexOf(actual) >= GRADE_ORDER.indexOf(minimum);
}

function scoreToGrade(score:number):QualityGrade{
  if(score>=90)return 'excellent';
  if(score>=75)return 'good';
  if(score>=60)return 'medium';
  if(score>=40)return 'weak';
  return 'invalid';
}

export type GradeOptions={
  conflict?:ConflictResult<unknown>|null;
  health?:SourceHealth|null;
  dataType?:DataType;
};

/**
 * مبدأ مهم:
 * sourceTime لا يعني الشيء نفسه لكل نوع بيانات.
 *
 * - price: وقت السعر، ويصلح لقياس التأخر بالدقائق.
 * - history: وقت آخر شمعة/جلسة، وليس "زمن استجابة المصدر".
 * - financials/filings: تاريخ نشر/إيداع؛ قدمه لا يعني أن المصدر متأخر.
 * - news: وقت نشر الخبر؛ قدم الخبر لا يعني فشل المصدر.
 *
 * لذلك لا نطبّق عقوبة latency الزمنية إلا على price.
 */
export function gradeFromProvenance(
  provenance:Provenance,
  options:GradeOptions={},
):DataQuality{
  let score=100;
  const reasons:string[]=[];

  if(provenance.official){
    score+=20;
    reasons.push('مصدر رسمي.');
  }else{
    score-=15;
    reasons.push('مصدر غير رسمي.');
  }

  if(provenance.derived){
    score-=10;
    reasons.push('القيمة مشتقة، لا مباشرة من المصدر.');
  }

  const dataType=options.dataType;

  if(dataType==='price'){
    let measuredPenalty=0;
    let measuredReason:string|null=null;

    if(!provenance.sourceTime){
      measuredPenalty=10;
      measuredReason='وقت السعر عند المصدر غير معروف.';
    }else{
      const sourceMs=Date.parse(provenance.sourceTime);
      const retrievedMs=Date.parse(provenance.retrievedAt);

      if(!Number.isFinite(sourceMs)||!Number.isFinite(retrievedMs)){
        measuredPenalty=10;
        measuredReason='تعذر التحقق من وقت السعر.';
      }else{
        const gapMinutes=Math.max(0,(retrievedMs-sourceMs)/60000);

        if(gapMinutes<=2){
          reasons.push('وقت السعر حديث بالنسبة لوقت الجلب.');
        }else if(gapMinutes<=15){
          measuredPenalty=5;
          measuredReason=`السعر متأخر بنحو ${Math.round(gapMinutes)} دقيقة.`;
        }else if(gapMinutes<=60){
          measuredPenalty=15;
          measuredReason=`السعر متأخر بنحو ${Math.round(gapMinutes)} دقيقة.`;
        }else{
          measuredPenalty=30;
          measuredReason=`السعر قديم بنحو ${Math.round(gapMinutes)} دقيقة.`;
        }
      }
    }

    // لا نجمع measured delay وknown delay مرتين لنفس الظاهرة.
    let declaredPenalty=0;
    let declaredReason:string|null=null;

    if(
      provenance.delayMinutes!==null &&
      Number.isFinite(provenance.delayMinutes) &&
      provenance.delayMinutes>0
    ){
      if(provenance.delayMinutes<=15)declaredPenalty=5;
      else if(provenance.delayMinutes<=60)declaredPenalty=15;
      else declaredPenalty=30;

      declaredReason=
        `المصدر يعلن/يُصنّف بتأخير يقارب ${provenance.delayMinutes} دقيقة.`;
    }

    if(measuredPenalty>=declaredPenalty){
      score-=measuredPenalty;
      if(measuredReason)reasons.push(measuredReason);
    }else{
      score-=declaredPenalty;
      if(declaredReason)reasons.push(declaredReason);
    }
  }else{
    if(provenance.sourceTime){
      reasons.push(
        dataType==='financials'||dataType==='filings'
          ? 'تاريخ النشر/الإيداع محفوظ؛ لا يُعامل كزمن تأخير لحظي.'
          : 'وقت المصدر محفوظ.',
      );
    }else{
      reasons.push('وقت المصدر غير معروف لهذا النوع؛ لم يُحوّل وحده إلى عقوبة زمنية.');
    }
  }

  if(options.conflict?.hasConflict){
    score-=25;
    reasons.push(
      `يوجد تعارض مع ${Math.max(0,options.conflict.values.length-1)} مصدر آخر.`,
    );
    if(options.conflict.reason)reasons.push(options.conflict.reason);
  }

  if(options.health && options.health.reliability<0.8){
    score-=10;
    reasons.push(
      `موثوقية التشغيل منخفضة (${(options.health.reliability*100).toFixed(0)}%).`,
    );
  }

  const clamped=Math.max(0,Math.min(100,score));

  return {
    grade:scoreToGrade(clamped),
    score:clamped,
    reasons:reasons.length?reasons:['لا توجد ملاحظات جودة إضافية.'],
  };
}

export function gradeFromFetchResult<T>(
  result:FetchResult<T>,
  options:GradeOptions={},
):DataQuality{
  if(result.state==='unavailable'){
    return {
      grade:'invalid',
      score:0,
      reasons:[`غير متاح: ${result.reason}`],
    };
  }

  if(result.state==='failed'){
    const failed=result.attempts
      .filter(a=>a.status==='failed')
      .map(a=>a.source);

    return {
      grade:'invalid',
      score:0,
      reasons:[
        `فشل الجلب من ${failed.length} مصدر: ${failed.join(', ')}.`,
      ],
    };
  }

  return gradeFromProvenance(result.provenance,options);
}


/** Conservative aggregation, not a fabricated legacy quality score. */
export function aggregateQuality(grades:DataQuality[]):DataQuality{
  if(!grades.length)return {grade:'invalid',score:0,reasons:['لا تقييمات.']};
  const score=Math.min(...grades.map(g=>Number.isFinite(g.score)?Math.max(0,Math.min(100,g.score)):0));
  const grade=grades.reduce((worst,g)=>GRADE_ORDER.indexOf(g.grade)<GRADE_ORDER.indexOf(worst)?g.grade:worst,scoreToGrade(score));
  return {grade,score,reasons:[`الأدنى: ${labelOf(grade)} (${score}/100).`,`تقييمات: ${grades.length}.`]};
}
