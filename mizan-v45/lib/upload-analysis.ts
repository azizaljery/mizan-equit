import type {MarketReport,Fact} from './market-data';
import {FIELDS,validDate} from './analysis';
export type UploadSupplement={name:string;values:{key:string;value:number;symbol:string;date:string;currency:string;unit:number|null;period:string}[]};
export function applyUploadSupplement(report:MarketReport,input:UploadSupplement){
 if(!input||typeof input.name!=='string'||!Array.isArray(input.values)||input.values.length>1000)throw Error('بيانات الملف غير صالحة.');
 const name=input.name.slice(0,180),facts=[...report.facts],notes:string[]=[];let used=0;
 for(const v of input.values){if(!v||!FIELDS.some(f=>f.key===v.key)||!Number.isFinite(v.value)||!Number.isFinite(v.unit)||v.unit===null||v.unit<=0||!validDate(v.date)||v.date>report.asOf||!['annual','quarterly','trailing'].includes(v.period)||typeof v.symbol!=='string'||v.symbol.toUpperCase().replace(/\.SR$/,'')!==report.company.symbol.replace(/\.SR$/,'')||v.currency!==report.currency){notes.push('استُبعد بند لعدم تطابق الهوية أو العملة أو الفترة أو الوحدة.');continue;}
 const latest=facts.filter(f=>f.key===v.key&&f.period===v.period&&f.currency===v.currency).sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(latest&&latest.date>=v.date){notes.push(latest.date>v.date?'لم تُستبدل بيانات أحدث ببند أقدم من الملف.':'للبند مصدر آلي عن الفترة نفسها؛ بقي المصدر الآلي ولم يُستبدل.');continue;}
 const value=v.value*v.unit;if(!Number.isFinite(value)){notes.push('استُبعد رقم غير صالح بعد تحويل الوحدة.');continue;}
 facts.push({key:v.key,value,date:v.date,period:v.period as Fact['period'],currency:v.currency,source:'ملف المستخدم: '+name});used++;
 }
 return {...report,facts,checks:[...report.checks,{name:'ملف المستخدم: '+name,url:'',state:'partial' as const,detail:`استُخدم ${used} بندًا إضافيًا بعد فحص الهوية والفترة والعملة والوحدة. الملف ليس مصدرًا رسميًا متحققًا مستقلًا. ${[...new Set(notes)].join(' ')}`}],warnings:[...report.warnings,`التحليل يضم ${used} بندًا من ملف المستخدم ${name}؛ صحة المحتوى تحتاج تحققًا مستقلًا. لم تُستبدل المصادر الأحدث.`]};
}
