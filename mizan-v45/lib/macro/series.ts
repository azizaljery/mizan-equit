/** Macro series catalogue. Descriptive only: no series here feeds a score, forecast or decision (book Part I; see audit register). */
export type MacroSeries={id:string;name:string;unit:string;frequency:'daily'|'monthly'|'annual';provider:'fred'|'worldbank'|'yahoo';market:'us'|'sa'|'global';note:string};
export const MACRO_SERIES:MacroSeries[]=[
 {id:'FEDFUNDS',name:'سعر الفائدة الفعلي للفيدرالي',unit:'%',frequency:'monthly',provider:'fred',market:'us',note:'مرجع تكلفة المال في أمريكا؛ ويرتبط به الريال عبر ربط العملة.'},
 {id:'CPIAUCSL',name:'مؤشر أسعار المستهلك الأمريكي',unit:'نقطة',frequency:'monthly',provider:'fred',market:'us',note:'مستوى المؤشر؛ التضخم السنوي يُحسب منه بعد 12 شهرًا.'},
 {id:'T10Y2Y',name:'فرق عائد 10 سنوات و2 سنة',unit:'نقطة مئوية',frequency:'daily',provider:'fred',market:'us',note:'شكل منحنى العائد؛ القيمة السالبة تعني انعكاس المنحنى.'},
 {id:'DGS10',name:'عائد سندات الخزانة 10 سنوات',unit:'%',frequency:'daily',provider:'fred',market:'us',note:'معدل الخصم المرجعي للتقييم.'},
 {id:'DTWEXBGS',name:'مؤشر الدولار الواسع',unit:'نقطة',frequency:'daily',provider:'fred',market:'global',note:'قوة الدولار أمام سلة عملات الشركاء التجاريين.'},
 {id:'DCOILBRENTEU',name:'نفط برنت',unit:'دولار/برميل',frequency:'daily',provider:'fred',market:'sa',note:'محرك رئيسي لإيرادات المالية السعودية.'},
 {id:'UNRATE',name:'معدل البطالة الأمريكي',unit:'%',frequency:'monthly',provider:'fred',market:'us',note:'حالة سوق العمل.'},
 {id:'SAU:FP.CPI.TOTL.ZG',name:'التضخم السنوي في السعودية',unit:'%',frequency:'annual',provider:'worldbank',market:'sa',note:'البنك الدولي؛ سنوي ويتأخر النشر.'},
 {id:'SAU:NY.GDP.MKTP.KD.ZG',name:'نمو الناتج المحلي في السعودية',unit:'%',frequency:'annual',provider:'worldbank',market:'sa',note:'البنك الدولي؛ سنوي ويتأخر النشر.'},
 {id:'YH:BZ=F',name:'نفط برنت (عقد آجل، يومي)',unit:'دولار/برميل',frequency:'daily',provider:'yahoo',market:'sa',note:'ياهو؛ إغلاق العقد الأقرب. يُنقل الاستحقاق دوريًا فقد تظهر قفزات عند التدوير.'},
 {id:'YH:DX-Y.NYB',name:'مؤشر الدولار ICE (DXY)',unit:'نقطة',frequency:'daily',provider:'yahoo',market:'global',note:'ياهو؛ قوة الدولار أمام ست عملات رئيسية.'},
 {id:'YH:^VIX',name:'مؤشر التذبذب VIX',unit:'نقطة',frequency:'daily',provider:'yahoo',market:'us',note:'ياهو؛ تذبذب متوقع لأسهم S&P 500 خلال 30 يومًا.'},
 {id:'YH:^TASI.SR',name:'المؤشر العام لتداول (تاسي)',unit:'نقطة',frequency:'daily',provider:'yahoo',market:'sa',note:'ياهو؛ إغلاق المؤشر.'},
];
export const FRED_URL=(id:string)=>`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=2024-01-01`;
export const WB_URL=(id:string)=>{const [c,i]=id.replace(/^[A-Z]{3}:/,m=>m).split(':');return `https://api.worldbank.org/v2/country/${c}/indicator/${i}?format=json&per_page=30`;};
/** Yahoo chart: series id is `YH:<symbol>`; two years of daily bars, filtered by `sinceDate` in the parser. */
export const YAHOO_URL=(id:string)=>`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(id.replace(/^YH:/,''))}?interval=1d&range=2y`;
