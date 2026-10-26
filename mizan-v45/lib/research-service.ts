import {env} from 'cloudflare:workers';
import {applyUploadSupplement,type UploadSupplement} from './upload-analysis';
import {readSettings} from './site-settings';
import {configuredReader,recordSourceUse} from './source-status';
import {fetchCompany} from './market-data';
import {forecasts} from './research-model';
import {supplementResearch} from './research-discovery';
import {recordAnalysis} from './forecast-journal';
import {assertCurrentInstrument} from './listing-lifecycle';
export async function analyzedCompany(symbol:string,db:any,upload?:UploadSupplement,allowPartial=false,accountKey:string|null=null){assertCurrentInstrument(symbol);const settings=await readSettings(db);const market=symbol.endsWith('.SR')?'sa':/^[A-Z][A-Z0-9.-]*$/.test(symbol)?'us':'global';if(!settings.enabledMarkets.includes(market))throw Error('هذا السوق متوقف من إعدادات الإدارة.');const read=await configuredReader(db,settings);let report=await fetchCompany(symbol,read,allowPartial);try{report=await supplementResearch(report,db,fetch,{read,siteSettings:settings,apiKey:(env as any).TAVILY_API_KEY})}catch{report.warnings.push('تعذر البحث المساعد؛ استمر التحليل بالمصادر المباشرة المقبولة.')}if(upload)report=applyUploadSupplement(report,upload);try{report.forecast=(await recordAnalysis(db,report,settings,accountKey)) as typeof report.forecast}catch{report.warnings.push('تعذر حفظ التوقع في السجل الدائم؛ لم يُعتمد كتوقع قابل لتتبع الأداء.');report.forecast={...forecasts(report,report.liveQuote||null,Date.now(),settings),recorded:false} as typeof report.forecast;}try{await recordSourceUse(db,report)}catch{report.warnings.push('لم يتأكد حفظ دليل استخدام المصدر؛ التحليل مستمر.')}return report;}
