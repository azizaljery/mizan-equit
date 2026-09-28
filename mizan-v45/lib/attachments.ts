import {FIELDS,parseCSV,parseNumber,validDate,type Price,parsePrices} from './analysis';
import {extractEvidence,readPDF,type Evidence} from './documents';
import {latestFact,normalizeQuery,type MarketReport,type Fact} from './market-data';
export type UploadedValue={key:string;value:number;date:string;currency:string;unit:number|null;symbol:string;period:Fact['period']|'';location:string};
export type Attachment={name:string;kind:string;message:string;values:UploadedValue[];evidence:Evidence[];prices:Price[];size?:number;mime?:string;preview?:{name:string;rows:string[][]}[];imageUrl?:string;pages?:{page:number;text:string;previewImage?:string}[]};
const aliases:Record<string,string>={totalrevenue:'revenue',revenues:'revenue',sales:'revenue',الايرادات:'revenue',اجماليالايرادات:'revenue',صافيالربح:'netIncome',netprofit:'netIncome',totalassets:'assets',totalequity:'equity',operatingcashflow:'operatingCashFlow',grossprofit:'grossProfit',totaldebt:'debt',shares:'shares'};
const norm=(s:string)=>normalizeQuery(s).replace(/[\s_()/-]/g,'');
function keyOf(s:string){return FIELDS.find(f=>norm(f.key)===norm(s)||norm(f.label)===norm(s))?.key||aliases[norm(s)]||''}
function scaleOf(s:string){const n=norm(s);return /million|مليون/.test(n)?1e6:/thousand|الف/.test(n)?1000:/^(1|unit|units|وحده|وحدات)$/.test(n)?1:null}
export function parseTables(sheets:{name:string;rows:string[][]}[]):UploadedValue[]{
 const values:UploadedValue[]=[];
 for(const {name,rows} of sheets){const metadata:Record<string,string>={};for(const r of rows.slice(0,30)){const k=norm(r[0]||'');if(['symbol','رمز','رمزالشركه','currency','العمله','unit','الوحده','period','الفتره','date','periodend','التاريخ'].includes(k))metadata[k]=r[1]||''}
  const common={symbol:metadata.symbol||metadata['رمز']||metadata['رمزالشركه']||'',currency:(metadata.currency||metadata['العمله']||'').toUpperCase(),unit:scaleOf(metadata.unit||metadata['الوحده']||''),date:metadata.periodend||metadata.date||metadata['التاريخ']||'',period:metadata.period||metadata['الفتره']||''};
  const hi=rows.findIndex(r=>r.some(c=>['metric','البند'].includes(norm(c)))&&r.some(c=>['value','القيمه'].includes(norm(c))));
  if(hi>=0){const h=rows[hi].map(norm),col=(r:string[],...names:string[])=>{const i=h.findIndex(x=>names.includes(x));return i>=0?r[i]||'':''};
   rows.slice(hi+1).forEach((r,i)=>{const key=keyOf(col(r,'metric','البند')),value=parseNumber(col(r,'value','القيمه'));if(!key||value===null)return;const period=col(r,'period','الفتره')||common.period;
    values.push({key,value,date:col(r,'date','periodend','التاريخ')||common.date,currency:(col(r,'currency','العمله')||common.currency).toUpperCase(),symbol:col(r,'symbol','رمز','رمزالشركه')||common.symbol,unit:scaleOf(col(r,'unit','الوحده'))??common.unit,period:['annual','سنوي','سنويا'].includes(period)?'annual':['quarterly','ربع','ربعي'].includes(period)?'quarterly':['trailing','TTM'].includes(period)?'trailing':'',location:`${name} · الصف ${hi+i+2}`});
   });
  }else{const di=rows.findIndex(r=>r.some(validDate));if(di<0)continue;const dates=rows[di];rows.slice(di+1).forEach((r,i)=>{const key=keyOf(r[0]||'');if(!key)return;r.forEach((v,j)=>{const value=parseNumber(v);if(value!==null&&validDate(dates[j]||''))values.push({...common,key,value,date:dates[j],period:common.period==='annual'?'annual':common.period==='quarterly'?'quarterly':'',location:`${name} · الصف ${di+i+2} · العمود ${j+1}`})})})}
 }return values.slice(0,1000);
}
export function compareUpload(values:UploadedValue[],report:MarketReport){return values.map(v=>{const sameCompany=normalizeQuery(v.symbol).replace(/\.sr$/,'')===normalizeQuery(report.company.symbol).replace(/\.sr$/,'');
 if(!sameCompany)return {...v,status:'غير قابل للمقارنة',auto:null,detail:v.symbol?'رمز الشركة في الملف يختلف عن الشركة المحللة.':'لم يحدد الملف رمز الشركة.'};
 if(!validDate(v.date)||!v.period||!v.currency||v.unit===null)return {...v,status:'غير قابل للمقارنة',auto:null,detail:'يلزم أن يتضمن الملف تاريخ الفتره ونوعها والعمله والوحده؛ لم تُفترض تلقائيًا.'};
 const fact=latestFact(report.facts,v.key,v.period,v.date);if(!fact||fact.currency!==v.currency)return {...v,status:'غير قابل للمقارنة',auto:null,detail:'لا يوجد بند تلقائي مطابق للفترة والعمله.'};
 const scaled=v.value*v.unit,diff=scaled-fact.value,matches=Math.abs(diff)<=Math.max(1,Math.abs(fact.value)*.005);return {...v,status:matches?'متوافق ضمن 0.5٪':'اختلاف يحتاج مراجعة',auto:fact.value,detail:`الفرق بعد توحيد الوحده: ${diff.toLocaleString('en-US')}. لا يستبدل الملف المصدر تلقائيًا.`};
 })}
export async function readAttachment(file:File,progress:(s:string)=>void):Promise<Attachment>{
 const ext=file.name.split('.').at(-1)?.toLowerCase();if(!['xlsx','xls','csv','pdf','json','jpg','jpeg','png'].includes(ext||''))throw new Error('صيغة الملف غير مدعومة. استخدم PDF أو Excel أو CSV أو JSON أو JPG أو PNG');
 if(file.size>25*1024*1024)throw new Error('الحد الأعلى للملف 25 ميغابايت.');if(!file.size)throw new Error('الملف فارغ.');
 if(['jpg','jpeg','png'].includes(ext||'')){
  const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer()),isPng=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!(ext==='png'?isPng:isJpeg))throw Error('محتوى الملف لا يطابق نوع الصورة المختار.');
  const imageUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('تعذر قراءة الصورة.'));reader.readAsDataURL(file)});
  await new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>image.naturalWidth*image.naturalHeight>40000000?reject(Error('الصورة كبيرة جدًا؛ استخدم نسخة أصغر.')):resolve();image.onerror=()=>reject(Error('الصورة تالفة أو غير قابلة للقراءة.'));image.src=imageUrl;});
  return {name:file.name,size:file.size,mime:file.type,kind:'صورة',imageUrl,message:'تم رفع الصورة وقراءتها للمعاينة. لا يتوفر استخراج نص موثوق من الصور هنا؛ تُرفق للمراجعة ولا تُستخدم أرقامها تلقائيًا في الدرجة.',values:[],prices:[],evidence:[]};
 }
 if(ext==='json'){
  let data:any;try{data=JSON.parse(await file.text())}catch{throw Error('ملف JSON غير صالح؛ تعذر قراءة بنيته.');}
  const root=data?.report||data,rows=Array.isArray(root)?root:Array.isArray(root?.facts)?root.facts:Array.isArray(root?.values)?root.values:null;
  if(!rows?.length)throw Error('تعذر قراءة بيانات مالية من JSON؛ يلزم جدول بنود يحتوي metric أو key وvalue.');
  if(rows.length>10000)throw Error('ملف JSON يتجاوز 10,000 بند.');
  const table=[['metric','value','symbol','date','period','currency','unit'],...rows.map((v:any)=>[v?.metric||v?.key,v?.value,v?.symbol||root.company?.symbol||root.symbol,v?.date,v?.period,v?.currency,v?.unit??(Array.isArray(root.facts)?1:'')].map(x=>x==null?'':String(x)))];
  const values=parseTables([{name:file.name,rows:table}]);
  return {name:file.name,size:file.size,mime:'application/json',kind:'JSON',message:`تم رفع الملف وقراءته. ${values.length} قيمة قابلة لفحص الهوية والفترة والوحدة قبل استخدامها.`,preview:[{name:file.name,rows:table.slice(0,12)}],values,evidence:[],prices:[]};
 }
 if(ext==='pdf'){const pages=await readPDF(file,progress),text=pages.map(p=>p.text).join('\n');const partialText=(text.match(/[\uE000-\uF8FF]/g)||[]).length>text.length*.05;const bylaws=/النظام\s+ال[أا]ساسي|نظام[\s\S]{0,10}[أا]ساسي|articles of association|bylaws/i.test(normalizeQuery(text));const evidence=bylaws||partialText?[]:extractEvidence(pages,file.name);
  return {name:file.name,size:file.size,mime:file.type||'application/pdf',pages,preview:[],kind:bylaws?'نظام أساسي':'مستند PDF',message:text.trim().length<80?'قُرئت صفحات الملف للمعاينة كصور. لا يوجد نص قابل للاستخراج؛ لم تُستخدم أرقام منها في الحسابات.':partialText?'قُرئت صفحات PDF، لكن بعض النص غير واضح بسبب ترميز الخطوط. المعاينة جزئية؛ لا تُعتمد أرقام من هذا النص دون الرجوع إلى المستند الأصلي.':bylaws?'تمت قراءة الملف. هذا نظام أساسي للشركة؛ لا يحتوي قوائم مناسبة لحساب الربحية أو التقييم.':`تمت قراءة ${pages.length} صفحة. ${evidence.length} مواضع مالية محتملة؛ لم نعتمد أرقامًا دون التحقق من العمود والفتره والعمله.`,values:[],evidence,prices:[]};
 }
 let sheets:{name:string;rows:string[][]}[];
 if(ext==='csv')sheets=[{name:file.name,rows:parseCSV(await file.text())}];
 else{progress('قراءة أوراق Excel…');const buffer=await file.arrayBuffer();sheets=await new Promise((resolve,reject)=>{const worker=new Worker('/vendor/xlsx/reader.worker.js'),timer=setTimeout(()=>{worker.terminate();reject(new Error('انتهت مهلة قراءة الملف. جرّب تصدير الورقة المطلوبة إلى CSV.'))},20000);const cleanup=()=>{clearTimeout(timer);worker.terminate()};worker.onmessage=e=>{cleanup();e.data.error?reject(new Error(e.data.error)):resolve(e.data.sheets)};worker.onerror=()=>{cleanup();reject(new Error('تعذرت قراءة Excel. قد يكون الملف محميًا أو تالفًا.'))};worker.postMessage(buffer,[buffer])})}
 if(!sheets.some(s=>s.rows.some(r=>r.some(v=>v.trim()))))throw Error('الملف فارغ؛ لم نجد خلايا تحتوي بيانات.');
 const values=parseTables(sheets);let prices:Price[]=[];
 for(const sheet of sheets){const h=sheet.rows[0]?.map(x=>x.toLowerCase())||[];if(h.includes('close')&&h.includes('date')){const csv=sheet.rows.map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\n');prices=parsePrices(csv);break}}
 return {name:file.name,size:file.size,mime:file.type||ext||'',preview:sheets.map(s=>({name:s.name,rows:s.rows.slice(0,12).map(r=>r.slice(0,12))})),kind:ext==='csv'?'CSV':'Excel',message:values.length?`تم استخراج ${values.length} قيمة. المقارنة تشترط تطابق الشركة والفتره والعمله والوحده.`:prices.length?`تمت قراءة ${prices.length} جلسة. تبقى سلسلة السوق الأصلية معتمدة حتى تثبت هوية السهم وتعديلات الأسعار في الملف.`:'الملف قُرئ بنجاح، لكن بنية البنود لا تحدد قيمًا قابلة للمقارنة. استخدم عناوين واضحة للبند والقيمه والفتره والوحده والعمله والرمز.',values,evidence:[],prices};
}
