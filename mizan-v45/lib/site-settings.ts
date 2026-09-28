import {HOME_SECTIONS,COMPANY_SECTIONS,sectionDefaults,DEFAULT_SOURCE_CONFIG,normalizeSourceConfig,normalizeSections} from './admin-config';
export const PERIODS=[1,5,21,63,126,252] as const;
export const SOURCE_NAMES={yahoo:'مزود أسعار وقوائم Yahoo Finance',tadawul:'تداول السعودية',sec:'هيئة الأوراق المالية الأمريكية SEC'};
export const DEFAULT_SETTINGS={description:'يقوم النظام بفهم السؤال، ثم يبحث ويحلل الشركات المناسبة بدل مطالبتك بإدخال الشركات واحدة واحدة.',market:'sa',horizon:'medium',count:5,minTurnover:0,
 enabledMarkets:['sa','us','global'],askEnabled:true,questions:[] as string[],detail:'simple',tooltips:true,expandedHelp:true,
 indicators:{financial:true,technical:true,liquidity:true},sources:{yahoo:true,tadawul:true,sec:true},
 periods:Object.fromEntries(PERIODS.map(n=>[String(n),{enabled:true,expanded:false}])) as Record<string,{enabled:boolean;expanded:boolean}>,
 weights:{fundamental:100,technical:100,liquidity:100,risk:100},maxSigma:3,minConfidence:'low',
 trading:{minTurnover:0,maxVolatility:150,positiveMomentum:false,excludeHighRisk:false},investing:{minTurnover:0,maxVolatility:100,positiveCashFlow:false,excludeHighRisk:false},
 paperEnabled:true,hiddenMetrics:[] as string[],sourceConfig:structuredClone(DEFAULT_SOURCE_CONFIG),layout:{home:sectionDefaults(HOME_SECTIONS),company:sectionDefaults(COMPANY_SECTIONS)},updatedAt:''};
export type SiteSettings=typeof DEFAULT_SETTINGS;
export function validateSettings(input:any):SiteSettings{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('إعدادات غير صالحة.');
 const v={...DEFAULT_SETTINGS,...input,weights:{...DEFAULT_SETTINGS.weights,...input.weights},periods:{...DEFAULT_SETTINGS.periods,...input.periods},sources:{...DEFAULT_SETTINGS.sources,...input.sources},indicators:{...DEFAULT_SETTINGS.indicators,...input.indicators},trading:{...DEFAULT_SETTINGS.trading,...input.trading},investing:{...DEFAULT_SETTINGS.investing,...input.investing}};
 if(typeof v.description!=='string'||!v.description.trim()||v.description.length>600||!['sa','us'].includes(v.market)||!['short','medium','long'].includes(v.horizon)||!Number.isInteger(v.count)||v.count<1||v.count>20||!Number.isFinite(v.minTurnover)||v.minTurnover<0||v.minTurnover>1e12)throw Error('راجع النص والسوق والأفق وعدد النتائج (1–20) وحد السيولة.');
 if(!Array.isArray(v.enabledMarkets)||!v.enabledMarkets.length||v.enabledMarkets.some((m:string)=>!['sa','us','global'].includes(m))||!v.enabledMarkets.includes(v.market))throw Error('اختر سوقًا مسموحًا واجعل السوق الافتراضي ضمنها.');
 if(!Array.isArray(v.questions)||v.questions.length>20||v.questions.some((q:any)=>typeof q!=='string'||!q.trim()||q.length>500))throw Error('الحد 20 سؤالًا جاهزًا، كل سؤال حتى 500 حرف.');
 for(const key of ['askEnabled','tooltips','expandedHelp','paperEnabled'])if(typeof v[key]!=='boolean')throw Error('راجع مفاتيح تشغيل الوظائف.');
 for(const obj of [v.sources,v.indicators])for(const value of Object.values(obj))if(typeof value!=='boolean')throw Error('إعداد ظهور أو مصدر غير صالح.');
 for(const n of PERIODS)if(typeof v.periods[n]?.enabled!=='boolean'||typeof v.periods[n]?.expanded!=='boolean')throw Error('راجع مدد التوقعات.');
 if(!['simple','detailed'].includes(v.detail)||!['low','medium','high'].includes(v.minConfidence))throw Error('اختر مستوى تفصيل وثقة صالحًا.');
 if(!Number.isFinite(v.maxSigma)||v.maxSigma<1.5||v.maxSigma>5)throw Error('حد فحص النطاق بين 1.5 و5 وحدات تذبذب.');
 if(Object.values(v.weights).some(w=>typeof w!=='number'||!Number.isFinite(w)||w<0||w>300)||Object.values(v.weights).every(w=>w===0))throw Error('أوزان المحاور بين 0 و300 ولا تكون جميعها صفرًا.');
 for(const c of [v.trading,v.investing])if(!Number.isFinite(c.minTurnover)||c.minTurnover<0||c.minTurnover>1e12||!Number.isFinite(c.maxVolatility)||c.maxVolatility<=0||c.maxVolatility>1000||typeof c.excludeHighRisk!=='boolean')throw Error('راجع معايير السيولة والمخاطر.');
 if(typeof v.trading.positiveMomentum!=='boolean'||typeof v.investing.positiveCashFlow!=='boolean')throw Error('راجع شروط الترشيح.');
 v.sourceConfig=normalizeSourceConfig(input.sourceConfig??DEFAULT_SOURCE_CONFIG,v.sources);
 v.layout={home:normalizeSections(input.layout?.home??sectionDefaults(HOME_SECTIONS),HOME_SECTIONS),company:normalizeSections(input.layout?.company??sectionDefaults(COMPANY_SECTIONS),COMPANY_SECTIONS)};
 if(!Array.isArray(v.hiddenMetrics)||v.hiddenMetrics.length>100||v.hiddenMetrics.some((x:any)=>typeof x!=='string'||!x.trim()||x.length>120))throw Error('قائمة المؤشرات المخفية غير صالحة.');
 return structuredClone({...v,description:v.description.trim(),questions:v.questions.map((q:string)=>q.trim()),updatedAt:typeof v.updatedAt==='string'?v.updatedAt:''});
}
export async function readSettings(db:any):Promise<SiteSettings>{const row=await db.prepare('SELECT value FROM site_settings WHERE id=1').first();return row?validateSettings(JSON.parse(row.value)):structuredClone(DEFAULT_SETTINGS);}
export function adjustedWeights(base:Record<string,number>,settings:SiteSettings){const group=(k:string)=>['growth','quality','debt','valuation'].includes(k)?'fundamental':['trend','momentum','levels'].includes(k)?'technical':k==='liquidity'?'liquidity':'risk';const w=Object.fromEntries(Object.entries(base).map(([k,v])=>[k,v*settings.weights[group(k)]]));const sum=Object.values(w).reduce((s,v)=>s+v,0);return Object.fromEntries(Object.entries(w).map(([k,v])=>[k,sum?v/sum*100:0]));}
