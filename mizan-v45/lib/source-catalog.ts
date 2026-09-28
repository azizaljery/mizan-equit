// Candidate registry, not a subscription list or proof of connectivity.
export type SourceMetadata={
 market:'sa'|'us'|'global'; dataTypes:string[]; docsUrl:string; access:'public-api'|'licensed-api'|'document'|'reference';
 setup:string; licenseRequired:boolean; keyRequired:boolean; coverage:string; delayMinutes:number|null;
 symbolMapping:string; fieldMapping:string; lineage:string;
};
export type SourceCandidate=SourceMetadata&{id:string;name:string;url:string;authority:'official'|'secondary';kind:'prices'|'financials'|'news'|'general'};
type Row=[string,string,string,SourceCandidate['kind'],SourceMetadata['access'],boolean,string];
const sa:Row[]=[
 ['tadawul','تداول السعودية','https://www.saudiexchange.sa/wps/portal/saudiexchange/trading/market-services/market-information-services/market-data','prices','licensed-api',true,'اختيار تغذية أسعار مرخصة؛ قارئ صفحة الشركة الحالي مستقل عن اشتراك الأسعار.'],
 ['cma','هيئة السوق المالية','https://cma.gov.sa/MediaCenter/NEWS/Pages/default.aspx','news','document',true,'قارئ إعلانات تنظيمية؛ ليست تغذية أسعار.'],
 ['sama','البنك المركزي السعودي','https://www.sama.gov.sa/ar-sa/Statistics/Indices/Pages/default.aspx','general','document',true,'تحديد السلاسل النقدية والمصرفية المناسبة للفترة.'],
 ['gastat','الهيئة العامة للإحصاء','https://www.stats.gov.sa/','general','document',true,'اختبار الوصول وتحديد مجموعة البيانات الاقتصادية.'],
 ['mof','وزارة المالية','https://www.mof.gov.sa/financialreport/Pages/default.aspx','general','document',true,'قراءة تقارير الميزانية بتاريخ نشرها.'],
 ['datasaudi','DataSaudi','https://datasaudi.sa/ar','general','reference',true,'تحديد مجموعة البيانات وطريقة الوصول المتاحة.'],
 ['ndmc','المركز الوطني لإدارة الدين','https://ndmc.gov.sa/ar/reports-and-statistics','general','document',true,'تقارير التمويل والإصدارات الحكومية؛ ليست أسعار أسهم.'],
 ['argaam','أرقام','https://www.argaam.com/ar','financials','reference',false,'تحديد خدمة الربط والإذن باستخدام البيانات.'],
 ['mubasher','مباشر','https://www.mubasher.info/countries/sa','news','reference',false,'مرجع مقارنة؛ لا يفترض وجود API عام.'],
 ['investing-reference','Investing.com — السعودية','https://sa.investing.com/equities/saudi-arabia','prices','reference',false,'مرجع مقارنة؛ لا يعتمد كتغذية وحيدة.'],
 ['directfn','DirectFN','https://directfn.com/ar/','prices','licensed-api',false,'اتفاقية تغذية وحق عرض البيانات داخل ميزان.'],
 ['tickerchart','تكرتشارت','https://www.tickerchart.com/','prices','licensed-api',false,'التحقق من حق الربط وإعادة الاستخدام، لا اشتراك العرض وحده.'],
 ['lseg','LSEG Data & Analytics','https://www.lseg.com/en/data-analytics','prices','licensed-api',false,'التحقق من المنتج والتغطية السعودية وحق العرض.'],
 ['six','SIX Financial Information','https://www.six-group.com/en/products-services/financial-information.html','prices','licensed-api',false,'خدمة مرخصة للأسعار والبيانات المرجعية وإجراءات الشركات.'],
 ['factset','FactSet','https://developer.factset.com/','financials','licensed-api',false,'تحديد المنتج والحقول والصلاحيات في الاتفاقية.'],
 ['spa','وكالة الأنباء السعودية','https://www.spa.gov.sa/','news','document',true,'قراءة الخبر الأصلي؛ لا يُستنتج الأثر من عنوان فقط.'],
 ['aramco-ir','أرامكو — علاقات المستثمرين','https://www.aramco.com/en/investors','financials','document',true,'تقارير الشركة 2222 فقط، مع التحقق من الفترة والنشر.'],
 ['stc-ir','stc — علاقات المستثمرين','https://www.stc.com/en/investors.html','financials','document',true,'تقارير الشركة 7010 فقط، مع التحقق من الفترة والنشر.'],
 ['jarir-ir','جرير — التقارير','https://www.jarir.com/about-jarir/reports','financials','document',true,'تقارير الشركة 4190 فقط، مع التحقق من الفترة والنشر.'],
 ['idealratings','IdealRatings','https://www.idealratings.com/islamic-finance-solutions/','financials','licensed-api',false,'ترخيص وتغطية وفحص توافق المنهج الشرعي مع معايير المشروع.']
];
const us:Row[]=[
 ['sec','SEC — EDGAR','https://www.sec.gov/search-filings/edgar-application-programming-interfaces','financials','public-api',true,'قارئ خادم submissions/companyfacts والمستند الأصلي؛ لا يتطلب مفتاحًا، ويلتزم بسياسة الوصول.'],
 ['nasdaq-data-link','Nasdaq Data Link','https://docs.data.nasdaq.com/','prices','licensed-api',true,'اختيار مجموعة البيانات والمفتاح والتغطية وحقوق العرض.'],
 ['nyse','NYSE','https://www.nyse.com/data-products','prices','licensed-api',true,'اختيار منتج البيانات وترخيصه.'],
 ['cboe','Cboe','https://www.cboe.com/data/market-data-services/us/equities','prices','licensed-api',true,'تحديد تغطية أسواق Cboe؛ ليست تغذية مجمعة مفترضة.'],
 ['finra','FINRA Data','https://www.finra.org/finra-data','general','public-api',true,'تحديد مجموعة بيانات الشفافية؛ ليست تغذية أسعار شاملة.'],
 ['alpaca','Alpaca — بيانات فقط','https://docs.alpaca.markets/us/docs/about-market-data-api','prices','licensed-api',false,'قارئ GET جاهز للإعداد. على الخادم: ALPACA_API_KEY وALPACA_API_SECRET وALPACA_DATA_FEED=iex أو sip وALPACA_DELAY_MINUTES=0 أو 15 وALPACA_DISPLAY_AUTHORIZED=true بعد التحقق من حقوق العرض؛ لا أوامر تداول.'],
 ['massive','Massive','https://massive.com/docs','prices','licensed-api',false,'تحديد المنتج والمفتاح والتأخير والترخيص.'],
 ['alpha-vantage','Alpha Vantage','https://www.alphavantage.co/documentation/','prices','licensed-api',false,'مفتاح وخطة وتحقق من حقوق البيانات وتأخيرها.'],
 ['tiingo','Tiingo','https://www.tiingo.com/documentation/general/overview','prices','licensed-api',false,'مفتاح ومراجعة مستقلة لحقوق إعادة العرض داخل منصة.'],
 ['databento','Databento','https://databento.com/docs','prices','licensed-api',false,'تحديد مجموعة البيانات والترخيص والمفتاح.'],
 ['intrinio','Intrinio','https://intrinio.com/docs','prices','licensed-api',false,'تحديد تغذية الأسعار والتأخير والصلاحيات.'],
 ['finnhub','Finnhub','https://finnhub.io/docs/api','financials','licensed-api',false,'مفتاح وخطة واختبار تغطية الحقول المطلوبة.'],
 ['fred','FRED / ALFRED','https://fred.stlouisfed.org/docs/api/fred/','general','public-api',true,'تحديد السلاسل والإصدارات التاريخية ومفتاح API؛ ليس سعر السهم.'],
 ['federal-reserve','Federal Reserve','https://www.federalreserve.gov/data.htm','general','document',true,'قراءة إصدارات الفائدة والنقد والائتمان بتاريخ النشر.'],
 ['bls','BLS','https://www.bls.gov/developers/','general','public-api',true,'تحديد سلاسل الأسعار والعمل وحدود الطلبات.'],
 ['bea','BEA','https://www.bea.gov/','general','public-api',true,'بوابة المطورين: https://www.bea.gov/resources/for-developers ؛ تحديد المجموعة والمفتاح.'],
 ['census','US Census Bureau','https://www.census.gov/data/developers.html','general','public-api',true,'اختيار مجموعة اقتصادية أو قطاعية وتحديد متطلبات المفتاح.'],
 ['eia','EIA','https://www.eia.gov/opendata/','general','public-api',true,'اختيار سلاسل الطاقة ومفتاح البيانات المفتوحة.'],
 ['apple-ir','Apple — علاقات المستثمرين','https://investor.apple.com/investor-relations/default.aspx','financials','document',true,'تقارير Apple فقط؛ اكتشاف إفصاح الشركة الأصلي من SEC.'],
 ['microsoft-ir','Microsoft — علاقات المستثمرين','https://www.microsoft.com/en-us/investor/default','financials','document',true,'تقارير Microsoft فقط؛ اكتشاف إفصاح الشركة الأصلي من SEC.']
];
export const SOURCE_CANDIDATES:SourceCandidate[]=[...sa.map(r=>({r,market:'sa' as const})),...us.map(r=>({r,market:'us' as const}))].map(({r:[id,name,url,kind,access,official,setup],market})=>({
 id,name,url,kind,access,market,setup,authority:official?'official':'secondary',dataTypes:id==='idealratings'?['sharia','purification']:id==='tadawul'?['prices','financials','disclosures']:id==='sec'?['financials','disclosures']:id==='cma'?['regulation','disclosures']:[kind],docsUrl:id==='bea'?'https://www.bea.gov/resources/for-developers':url,
 licenseRequired:access==='licensed-api',keyRequired:access==='licensed-api'||['fred','eia','bea'].includes(id),coverage:'لم تُختبر التغطية التشغيلية بعد',delayMinutes:null,
 symbolMapping:id==='sec'?'رمز التداول ← CIK من دليل SEC الرسمي':'يحدد عند تهيئة القارئ؛ رابط الصفحة لا يربط الرموز',
 fieldMapping:id==='sec'?'us-gaap → بنود مالية، مع الفترة والعملة وتاريخ الإيداع':'يحدد ويختبر قبل اعتماد البيانات',lineage:id
}));
export function candidateMetadata(id:string):SourceMetadata|undefined{const c=SOURCE_CANDIDATES.find(s=>s.id===id);if(!c)return;const {name,url,authority,kind,id:_,...metadata}=c;return metadata;}

export function sourceOperationalState(source:{enabled:boolean;deleted:boolean;adapter:string;metadata?:SourceMetadata},observation?:{status?:string;detail?:string},probe?:{state?:string;detail?:string}){
 let evidence:any=null;try{evidence=JSON.parse(observation?.detail||'null')}catch{}
 const state=probe?.state||observation?.status;
 if(source.deleted)return {label:'متوقف',detail:'حذف قابل للاستعادة؛ السجل التاريخي محفوظ.'};
 if(state==='failed')return {label:'متعطل',detail:probe?.detail||evidence?.reason||observation?.detail||'فشل آخر طلب.'};
 if(evidence?.stage==='analysis-used'&&source.enabled)return {label:'يعمل',detail:`استُخدمت بيانات متحقق منها في تحليل ${evidence.symbol} بتاريخ ${evidence.usedAt}.`};
 if(state==='partial'||state==='ok'||state==='delayed')return {label:'جزئي',detail:probe?.detail||'وصل رد من المصدر؛ لم يُثبت بعد استخدام بياناته في تحليل صالح.'};
 if(source.metadata?.licenseRequired)return {label:'ينتظر ترخيصًا',detail:source.metadata.setup};
 if(source.adapter==='reference')return {label:'مسجل فقط',detail:source.metadata?.setup||'مرجع دون قارئ آلي مفعل.'};
 return {label:'يحتاج إعدادًا',detail:source.enabled?'يلزم اختبار قراءة بيانات صحيحة واستخدامها في التحليل.':'الاتصال متوقف من الإدارة.'};
}
