/** Macro series catalogue. Descriptive only: no series here feeds a score, forecast or decision (book Part I; see audit register). */
export type MacroSeries={id:string;name:string;unit:string;frequency:'daily'|'monthly'|'annual';provider:'fred'|'worldbank'|'yahoo'|'nyfed';market:'us'|'sa'|'global';note:string};
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
 {id:'NYFED:EFFR',name:'سعر الفائدة الفعلي للفيدرالي (يومي، بنك نيويورك الفيدرالي)',unit:'%',frequency:'daily',provider:'nyfed',market:'us',note:'مصدر رسمي بلا مفتاح؛ يغني عن FEDFUNDS الشهري.'},
 {id:'YH:^TNX',name:'عائد سندات الخزانة 10 سنوات (ياهو)',unit:'%',frequency:'daily',provider:'yahoo',market:'us',note:'ياهو؛ يغني عن DGS10 عند تعذره.'},
 {id:'YH:^IRX',name:'عائد أذون الخزانة 13 أسبوعًا (ياهو)',unit:'%',frequency:'daily',provider:'yahoo',market:'us',note:'ياهو؛ أقصر طرف في منحنى العائد.'},
];
export const FRED_URL=(id:string)=>`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=2024-01-01`;
export const WB_URL=(id:string)=>{const [c,i]=id.replace(/^[A-Z]{3}:/,m=>m).split(':');return `https://api.worldbank.org/v2/country/${c}/indicator/${i}?format=json&per_page=30`;};
/** Yahoo chart: series id is `YH:<symbol>`; two years of daily bars, filtered by `sinceDate` in the parser. */
export const YAHOO_URL=(id:string)=>`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(id.replace(/^YH:/,''))}?interval=1d&range=2y`;
/** FRED's official API (needs a free key, stored as a Worker secret and never written to the database). Used instead of the keyless graph CSV when a key exists. */
export const FRED_API_URL=(id:string,key:string,since:string)=>`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${encodeURIComponent(since)}`;
/** NY Fed reference rates: last N business days of the effective fed funds rate (no key). */
export const NYFED_URL=(_id:string)=>'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/800.json';
