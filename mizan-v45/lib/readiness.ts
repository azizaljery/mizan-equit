import {type Financials,type Meta,type Price,type Events,type Checks,finite,validDate,ageDays,technical,fmt} from './analysis';
export type YearRow={year:string;revenue:number|null;cfo:number|null;grossProfit:number|null;operatingIncome:number|null;netIncome:number|null;averageAssets:number|null;averageEquity:number|null;source:string};
export type Requirements={activity:string;activityType:string;shariaQuarter:string;shariaMethod:string;purification:number|null;purificationBasis:string;shariaDisagreement:string;bid:number|null;ask:number|null;quoteDate:string;quoteSource:string;eventDate:string;eventNote:string;auditor:string;auditorSource:string;entry:number|null;stop:number|null;target:number|null;capital:number|null;capitalCurrency:string;availableCash:number|null;costPerShare:number|null;thesis:string;invalidator:string;exitPrice:number|null;exitType:string;deadline:string;catalyst:string;horizon:string;shares:number|null;peLow:number|null;peHigh:number|null;valuationSource:string;normalization:string;historyReviewed:boolean;planReviewed:boolean;invalidated:boolean;invalidationEvidence:string};
export type CheckItem={title:string;state:'pass'|'problem'|'missing';detail:string;group:'shared'|'investor'|'trader'};
export const blankRequirements=():Requirements=>({activity:'',activityType:'unknown',shariaQuarter:'',shariaMethod:'',purification:null,purificationBasis:'',shariaDisagreement:'',bid:null,ask:null,quoteDate:'',quoteSource:'',eventDate:'',eventNote:'',auditor:'unknown',auditorSource:'',entry:null,stop:null,target:null,capital:null,capitalCurrency:'SAR',availableCash:null,costPerShare:0,thesis:'',invalidator:'',exitPrice:null,exitType:'price',deadline:'',catalyst:'',horizon:'',shares:null,peLow:null,peHigh:null,valuationSource:'',normalization:'',historyReviewed:false,planReviewed:false,invalidated:false,invalidationEvidence:''});
export const blankHistory=():YearRow[]=>[0,1,2].map(()=>({year:'',revenue:null,cfo:null,grossProfit:null,operatingIncome:null,netIncome:null,averageAssets:null,averageEquity:null,source:''}));
export function latestQuarter(asOf:string){if(!validDate(asOf))return '';const d=new Date(asOf);let y=d.getUTCFullYear(),q=Math.floor(d.getUTCMonth()/3);if(q===0){q=4;y--}return `${y}-Q${q}`}
export function quoteSessionGap(from:string,to:string,market:string){if(!validDate(from)||!validDate(to))return Infinity;let count=0;const d=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');if(d>end)return Infinity;while(d<end&&count<10){d.setUTCDate(d.getUTCDate()+1);const w=d.getUTCDay();if(market==='sa'?(w!==5&&w!==6):(w!==0&&w!==6))count++}return count}
export function positionSize(r:Requirements){
 const errors:string[]=[];let risk:number|null=null,shares:number|null=null,rr:number|null=null,cashLimit:number|null=null,rawShares:number|null=null;
 if(!finite(r.capital)||r.capital<=0)errors.push('رأس المال يجب أن يكون موجبًا.');
 if(!finite(r.entry)||!finite(r.stop)||!finite(r.target)||r.stop<=0||r.entry<=r.stop||r.target<=r.entry)errors.push('يلزم: الهدف > الدخول > الوقف > صفر.');
 if(!finite(r.availableCash)||r.availableCash<0)errors.push('حدّد النقد المتاح بقيمة غير سالبة.');
 if(!finite(r.costPerShare)||r.costPerShare<0)errors.push('تكلفة السهم التقديرية يجب أن تكون غير سالبة.');
 if(!errors.length){risk=r.capital!*.01;const loss=r.entry!-r.stop!+r.costPerShare!;rawShares=Math.floor(risk/loss);cashLimit=Math.floor(Math.min(r.availableCash!,r.capital!)/(r.entry!+r.costPerShare!));shares=Math.max(0,Math.min(rawShares,cashLimit));rr=(r.target!-r.entry!-r.costPerShare!)/loss;}
 return {errors,risk,shares,rawShares,cashLimit,rr,value:shares!==null?shares*r.entry!:null,plannedLoss:shares!==null?shares*(r.entry!-r.stop!+r.costPerShare!):null};
}
export function requirementAnalysis(r:Requirements,h:YearRow[],f:Financials,p:Price[],m:Meta,c:Checks,ev:Events){
 const t=technical(p),plan=positionSize(r),items:CheckItem[]=[];
 const add=(title:string,group:CheckItem['group'],available:boolean,ok:boolean,detail:string)=>items.push({title,group,state:!available?'missing':ok?'pass':'problem',detail});
 const q=latestQuarter(m.asOf);const shariaComplete=!!(m.shariaSource.trim()&&r.shariaMethod.trim()&&validDate(m.shariaDate)&&m.shariaStatus!=='unknown'&&r.shariaQuarter&&finite(r.purification)&&r.purification>=0&&r.purificationBasis.trim());
 const shariaOk=shariaComplete&&m.shariaStatus==='compliant'&&r.shariaQuarter===q&&ageDays(m.asOf,m.shariaDate)>=0&&ageDays(m.shariaDate,m.periodEnd)>=0;
 add('التصنيف الشرعي والتطهير','shared',shariaComplete,!!shariaOk,shariaComplete?`المرجع ${r.shariaQuarter}؛ آخر ربع مكتمل ${q}؛ التطهير ${fmt(r.purification)} ${m.currency} للسهم (${r.purificationBasis}).`:'يلزم الجهة والمنهج والتاريخ وآخر ربع ومقدار التطهير وأساسه، ولو كان صفرًا.');
 const spread=finite(r.bid)&&finite(r.ask)&&r.bid>0&&r.ask>=r.bid?(r.ask-r.bid)/((r.ask+r.bid)/2)*100:null;
 const liquidAvail=finite(spread)&&finite(t.turnover)&&!!r.quoteSource.trim()&&validDate(r.quoteDate);
 add('السيولة والفارق السعري','shared',liquidAvail,!!(liquidAvail&&ageDays(m.asOf,r.quoteDate)>=0&&quoteSessionGap(r.quoteDate,m.asOf,m.market)<=1&&spread!<=1),liquidAvail?`متوسط قيمة التداول لـ20 جلسة ≈ ${fmt(t.turnover,0)} ${m.currency}؛ الفارق ${fmt(spread)}%.${quoteSessionGap(r.quoteDate,m.asOf,m.market)>1?' لقطة العرض والطلب أقدم من جلسة عمل تقريبية؛ راجع تقويم السوق.':''}`:'يلزم أعلى طلب وأقل عرض وتاريخ اللقطة ومصدرها، مع أسعار وحجم 20 جلسة.');
 add('نشاط الشركة مفهوم','shared',!!r.activity.trim()&&r.activityType!=='unknown',r.activityType!=='prohibited',r.activity||'اكتب النشاط في جملة وصنّف طبيعته؛ النشاط المختلط يتبع منهجًا شرعيًا واحدًا معلنًا.');
 const nearEvent=validDate(r.eventDate)&&ageDays(r.eventDate,m.asOf)>=0&&ageDays(r.eventDate,m.asOf)<=14;
 add('الأحداث الجوهرية القريبة','shared',c.events&&!!r.eventNote.trim(),!ev.upcoming&&!nearEvent,nearEvent?`حدث مسجل بتاريخ ${r.eventDate} خلال 14 يومًا.`:ev.upcoming?'تم تسجيل حدث قريب.':r.eventNote||'سجّل ما تمت مراجعته من نتائج وجمعيات وأولوية، مع المصدر والتاريخ.');
 add('الدخول والوقف والهدف','shared',finite(r.entry)&&finite(r.stop)&&finite(r.target)&&r.planReviewed,!!(r.entry!>r.stop!&&r.stop!>0&&r.target!>r.entry!),`مستويات يدخلها المستخدم؛ الدخول ${fmt(r.entry)}، الوقف ${fmt(r.stop)}، الهدف ${fmt(r.target)}.`);
 add('حجم المركز عند مخاطرة 1%','shared',!plan.errors.length,r.capitalCurrency===m.priceCurrency&&plan.shares!>0,plan.errors.length?plan.errors.join(' '):r.capitalCurrency!==m.priceCurrency?'عملة رأس المال تختلف عن السعر؛ حوّلها أولًا.':`ميزانية المخاطرة ${fmt(plan.risk)}؛ ${fmt(plan.shares,0)} سهم بعد حد النقد والتكاليف.`);
 add('العائد إلى المخاطرة ≥ 2','shared',finite(plan.rr),plan.rr!==null&&plan.rr>=2,finite(plan.rr)?`${fmt(plan.rr)} مرة بعد التكلفة التقديرية.`:'تعذر حسابه قبل استكمال المستويات.');
 const yearsValid=h.length===3&&h.every(x=>/^\d{4}$/.test(x.year))&&h.every((x,i)=>!i||Number(x.year)===Number(h[i-1].year)+1)&&h.every(x=>Number(x.year)<=new Date(m.periodEnd||m.asOf).getUTCFullYear());
 const histAvail=yearsValid&&r.historyReviewed&&h.every(x=>finite(x.revenue)&&x.revenue!>0&&finite(x.cfo)&&x.source.trim());
 const cagr=(k:'revenue'|'cfo')=>histAvail&&h[0][k]!>0&&h[2][k]!>0?(Math.sqrt(h[2][k]!/h[0][k]!)-1)*100:null;
 const revenuesGrowing=histAvail&&h[1].revenue!>h[0].revenue!&&h[2].revenue!>h[1].revenue!;const cfGrowing=histAvail&&h[1].cfo!>h[0].cfo!&&h[2].cfo!>h[1].cfo!;
 add('الإيرادات والنقد التشغيلي لثلاث سنوات','investor',histAvail,!!(revenuesGrowing&&cfGrowing),histAvail?`النمو السنوي المركب للإيراد ${fmt(cagr('revenue'))}% وللنقد ${fmt(cagr('cfo'))}%. ثلاث نقاط سنوية = فترتا نمو؛ لا يحسب المركب من أساس غير موجب.`:'يلزم 3 سنوات مالية متتالية ومصادرها؛ راجع توحيد المدة والوحدة.');
 const conversion=finite(f.operatingCashFlow)&&finite(f.netIncome)&&f.netIncome>0?f.operatingCashFlow/f.netIncome:null;
 add('جودة الأرباح: تحويل النقد > 1','investor',finite(f.operatingCashFlow)&&finite(f.netIncome),conversion!==null&&conversion>1,conversion===null?'المعدل غير ذي معنى مع ربح غير موجب.':`التدفق التشغيلي ÷ صافي الربح = ${fmt(conversion)}.`);
 const margins=h.map(x=>({year:x.year,gross:finite(x.grossProfit)&&finite(x.revenue)&&x.revenue>0?x.grossProfit/x.revenue*100:null,operating:finite(x.operatingIncome)&&finite(x.revenue)&&x.revenue>0?x.operatingIncome/x.revenue*100:null}));
 const marginAvail=histAvail&&margins.every(x=>finite(x.gross)&&finite(x.operating));const stable=marginAvail&&Math.max(...margins.map(x=>x.gross!))-Math.min(...margins.map(x=>x.gross!))<=5&&Math.max(...margins.map(x=>x.operating!))-Math.min(...margins.map(x=>x.operating!))<=5;
 add('الهوامش وثباتها','investor',marginAvail,!!stable,marginAvail?'ثبات استرشادي: الفرق بين أعلى وأدنى هامش خلال 3 سنوات لا يتجاوز 5 نقاط مئوية لكل من المجمل والتشغيلي.':'أضف مجمل الربح والربح التشغيلي للسنوات الثلاث.');
 const interest=finite(f.operatingIncome)&&finite(f.interestExpense)&&f.interestExpense>0?f.operatingIncome/f.interestExpense:null;const leverage=finite(f.debt)&&finite(f.cash)&&finite(f.ebitda)&&f.ebitda>0?(f.debt-f.cash)/f.ebitda:null;
 add('تغطية التمويل وصافي الدين','investor',(finite(interest)||f.interestExpense===0)&&finite(leverage),(f.interestExpense===0||interest!==null&&interest>=3)&&leverage!==null&&leverage<=3,`التغطية ${f.interestExpense===0?'لا تكلفة تمويل':fmt(interest)+'×'}؛ صافي الدين / EBITDA = ${fmt(leverage)}×. حد متابعة مخصص: تغطية ≥3 وصافي دين ≤3.`);
 const y=h[2];const dupontAvailable=histAvail&&!!y&&finite(y.netIncome)&&finite(y.averageAssets)&&y.averageAssets>0&&finite(y.averageEquity)&&y.averageEquity>0;
 const dupont=dupontAvailable?{margin:y.netIncome!/y.revenue!,turnover:y.revenue!/y.averageAssets!,multiplier:y.averageAssets!/y.averageEquity!,roe:y.netIncome!/y.averageEquity!*100}:null;
 add('مصدر العائد على حقوق الملكية','investor',!!dupont,!!dupont&&dupont.multiplier<=3,dupont?`هامش ${fmt(dupont.margin*100)}% × دوران ${fmt(dupont.turnover)} × رافعة ${fmt(dupont.multiplier)} = عائد ${fmt(dupont.roe)}%. الرافعة >3 تبرز مساهمة المديونية؛ ليست حكمًا منفردًا.`:'يلزم صافي الربح ومتوسط الأصول ومتوسط حقوق المساهمين لأحدث سنة، وليس رصيد النهاية وحده.');
 add('مضاعفات القطاع','investor',finite(f.peerPE)&&f.peerPE>0&&!!m.peerSource.trim(),true,m.peerSource||'أدخل وسيط مكرر نظراء مماثلين بالقطاع مع مصدر وتاريخ ونطاق المقارنة.');
 const scale=m.unit==='million'?1e6:m.unit==='thousand'?1e3:1;
 const eps=finite(f.netIncome)&&f.netIncome>0&&finite(r.shares)&&r.shares>0?f.netIncome*scale/r.shares:null;
 const valuation=finite(eps)&&finite(r.peLow)&&r.peLow>0&&finite(r.peHigh)&&r.peHigh>=r.peLow&&m.period!=='interim'?{low:eps*r.peLow,high:eps*r.peHigh,eps}:null;
 const mos=valuation&&finite(r.entry)?(1-r.entry/valuation.low)*100:null;
 add('نطاق القيمة وهامش الأمان','investor',!!valuation&&!!r.valuationSource.trim()&&!!r.normalization.trim(),finite(mos)&&mos>0,valuation?`نطاق تقديري بمضاعفات ربحية: ${fmt(valuation.low)}–${fmt(valuation.high)} ${m.currency}؛ الهامش إلى الحد الأدنى ${fmt(mos)}%. حساس لاستدامة الربح واختيار النظراء.`:'يلزم عدد الأسهم المخفف الفعلي ومكرر منخفض/مرتفع موثق، ومراجعة الأرباح غير المتكررة.');
 add('تقرير المراجع','investor',r.auditor!=='unknown'&&!!r.auditorSource.trim(),r.auditor==='clean',r.auditor==='clean'?'رأي غير معدل بحسب التقرير المدخل؛ راجع أيضًا فقرات الاستمرارية.':r.auditorSource||'حدّد الرأي ومصدره وتاريخ التقرير.');
 const sma200=t.sma200.length?t.sma200[t.sma200.length-1]:null;
 add('الموقع من متوسط 200','trader',finite(sma200),!!t.last&&sma200!==null&&t.last.close>sma200,finite(sma200)?`الإغلاق ${fmt(t.last?.close)} ومتوسط 200 = ${fmt(sma200)}.`:'يلزم 200 جلسة يومية لهذا الشرط.');
 add('أقرب دعم ومقاومة','trader',finite(t.support)&&finite(t.resistance),true,finite(t.support)?`نطاق مرجعي: دعم ${fmt(t.support)} ومقاومة ${fmt(t.resistance)}. أقرب قاع وقمة محليين حول الإغلاق، مؤكَدين بجلستين على كل جانب خلال 122 جلسة؛ راجع صلاحية المستوى.`:'يلزم تاريخ سعري كافٍ.');
 const volumeConfirm=t.relativeVolume!==null&&t.relativeVolume>1&&p.length>1&&p[p.length-1].close>p[p.length-2].close;
 add('الحجم وتأكيد الحركة','trader',t.relativeVolume!==null,volumeConfirm,`حجم آخر جلسة / متوسط 20 = ${fmt(t.relativeVolume)}×. فحص مبسط: إغلاق صاعد وحجم أعلى من المتوسط.`);
 add('المحفز المتوقع','trader',!!r.catalyst.trim(),true,r.catalyst||'اكتب المحفز ومصدره، وافصل الحقيقة عن التوقع.');
 const deadlineValid=validDate(r.deadline)&&ageDays(r.deadline,m.asOf)>0;
 add('الأفق والمهلة الزمنية','trader',!!r.horizon.trim()&&validDate(r.deadline),deadlineValid,`${r.horizon||'أفق غير مسجل'}؛ موعد مراجعة عدم تحقق الحركة: ${r.deadline||'غير مسجل'}.`);
 const inv=!!r.thesis.trim()&&!!r.invalidator.trim();
 add('سبب الدخول وما يبطله — للمضارب','trader',inv&&finite(r.exitPrice)&&r.exitPrice>0&&(r.exitType==='price'||r.exitType==='both'),true,inv?`${r.thesis} ← يبطل عند ${r.invalidator}؛ مستوى ${fmt(r.exitPrice)}.`:'اكتب سبب الدخول وشرطًا واحدًا واضحًا يبطله ومستوى السعر؛ حدّد الإغلاق أو اللمس في الوصف.');
 add('سبب الدخول وما يبطله — للمساهم','investor',inv&&(r.exitType==='event'||r.exitType==='both'),true,inv?`${r.thesis} ← يبطل عند ${r.invalidator}.`:'اربط الفرضية بحدث مالي قابل للتحقق، ويمكن إضافة حد سعري منفصل.');
 const shared=items.filter(x=>x.group==='shared');
 const missing=(mode:'trader'|'investor')=>items.filter(x=>(x.group==='shared'||x.group===mode)&&x.state==='missing').map(x=>x.title);
 const gated=r.activityType==='prohibited'||r.capitalCurrency!==m.priceCurrency||plan.errors.length>0||(liquidAvail&&(ageDays(m.asOf,r.quoteDate)<0||quoteSessionGap(r.quoteDate,m.asOf,m.market)>1));
 const planFloor=finite(plan.rr)&&plan.rr<2||spread!==null&&spread>1||nearEvent||ev.upcoming?65:0;
 return {items,shared,missingTrader:missing('trader'),missingInvestor:missing('investor'),spread,plan,cagrRevenue:cagr('revenue'),cagrCfo:cagr('cfo'),margins,dupont,valuation,mos,gated,planFloor,expectedQuarter:q};
}
export const THESIS_EXAMPLES=[
 ['sector','رخيص مقارنة بقطاعه','تبيّن أن الخصم مبرر بأرباح غير متكررة أو مشكلة حوكمة','event'],
 ['margins','هوامش قوية ونمو ثابت','انهيار الهامش المجمل أو ركود الإيراد ربعين','event'],
 ['debt','مديونية مريحة','قفزة في القروض أو تغطية التمويل دون 3','event'],
 ['dividends','توزيعات مستقرة','خفض التوزيع أو نسبة توزيع تتجاوز 100%','event'],
 ['breakout','اختراق مقاومة بحجم','عودة الإغلاق أسفل مستوى الاختراق المكتوب','price'],
 ['support','ارتداد من دعم','إغلاق دون الدعم المكتوب','price'],
];
