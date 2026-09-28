import {FIELDS,parseNumber} from './analysis';
export type PageText={page:number;text:string;previewImage?:string};
export type Evidence={id:string;page:number;line:number;text:string;field:string;numbers:string[];file:string};
const rules:Record<string,RegExp>={revenue:/^(?:total\s+)?(?:revenue[s]?|net sales)\b|إجمالي\s+الإيرادات|اجمالي\s+الايرادات|^الإيرادات|^الايرادات/i,netIncome:/net (?:income|profit)|profit (?:for|attributable)|صافي\s+(?:الربح|الأرباح|الارباح|الخسارة)/i,operatingIncome:/operating (?:income|profit)|الربح التشغيلي|(?:ربح|الربح|أرباح)\s+(?:من\s+)?العمليات/i,ebitda:/\bEBITDA\b/i,equity:/total (?:shareholders.?|stockholders.?)?\s*equity|إجمالي حقوق|اجمالي حقوق/i,assets:/^total assets|^إجمالي (?:الأصول|الموجودات)|^اجمالي (?:الاصول|الموجودات)/i,liabilities:/^total liabilities|^إجمالي (?:الالتزامات|المطلوبات)|^اجمالي (?:الالتزامات|المطلوبات)/i,cash:/cash and cash equivalents|النقد وما (?:في|يفي) حكمه/i,currentAssets:/total current assets|^الأصول المتداولة|^الموجودات المتداولة/i,currentLiabilities:/total current liabilities|^الالتزامات المتداولة|^المطلوبات المتداولة/i,operatingCashFlow:/net cash (?:provided by|from|generated from|used in) operating|صافي النقد.*(?:الأنشطة|الانشطة) التشغيلية|التدفق النقدي التشغيلي/i,debt:/total (?:debt|borrowings)|الديون التمويلية|إجمالي القروض/i,interestExpense:/interest expense|finance costs|تكاليف التمويل|تكلفة التمويل/i,capex:/capital expenditure|purchase[s]? of property|الإنفاق الرأسمالي|شراء ممتلكات/i,dividends:/dividends paid|توزيعات أرباح مدفوعة/i};
export function extractEvidence(pages:PageText[],file:string){
 const result:Evidence[]=[];
 for(const page of pages)page.text.split('\n').forEach((s,i)=>{const text=s.trim();if(!text)return;const field=Object.keys(rules).find(k=>rules[k].test(text));if(!field)return;
 const numbers=text.match(/\(?[-+−]?[0-9٠-٩۰-۹]+(?:[,.٬٫][0-9٠-٩۰-۹]+)*\)?/g)||[];
 result.push({id:`${page.page}-${i}`,page:page.page,line:i+1,text,field,numbers:numbers.filter(v=>parseNumber(v)!==null).slice(0,12),file});});return result;
}
export function extractNotices(pages:PageText[]){
 const terms=[{label:'الاستمرارية',re:/going concern|الاستمرارية|الاستمرار كمنشأة/i},{label:'أطراف ذات علاقة',re:/related part(?:y|ies)|أطراف ذات علاقة|الأطراف ذات العلاقة/i},{label:'دعاوى والتزامات',re:/litigation|contingent liabilit|دعاوى|التزامات محتملة/i},{label:'رأي المراجع',re:/qualified opinion|adverse opinion|disclaimer of opinion|رأي متحفظ|رأي سلبي|الامتناع عن إبداء/i},{label:'مخاطر العملة',re:/foreign exchange risk|currency risk|مخاطر العملة|مخاطر العملات/i}];
 return pages.flatMap(p=>p.text.split('\n').flatMap((line,i)=>{const term=terms.find(t=>t.re.test(line));return term?[{label:term.label,page:p.page,line:i+1,text:line.trim()}]:[]})).slice(0,100);
}
let pdfLibrary:Promise<any>|null=null;
function loadPdfLibrary(){
 if((globalThis as any).pdfjsLib)return Promise.resolve((globalThis as any).pdfjsLib);
 return pdfLibrary??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.type='module';script.src='/vendor/pdfjs/pdf.min.mjs';const timer=setTimeout(()=>{script.remove();pdfLibrary=null;reject(Error('تعذر تحميل قارئ PDF؛ أعد المحاولة بعد تحديث الصفحة.'))},20000);script.onload=()=>{clearTimeout(timer);const lib=(globalThis as any).pdfjsLib;if(lib)resolve(lib);else{pdfLibrary=null;reject(Error('تعذر تشغيل قارئ PDF.'))}};script.onerror=()=>{clearTimeout(timer);script.remove();pdfLibrary=null;reject(Error('تعذر تحميل قارئ PDF. تحقق من الاتصال ثم أعد المحاولة.'))};document.head.appendChild(script);});
}
export async function readPDF(file:File,onProgress:(s:string)=>void):Promise<PageText[]>{
 // Keep the document on-device; PDF.js and its worker are served with the app.
 const pdfjs=await loadPdfLibrary();
 pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'});
 let expired=false;const timeout=setTimeout(()=>{expired=true;void task.destroy()},60000);const pages:PageText[]=[];
 try{const doc=await task.promise;if(doc.numPages>350)throw new Error('الملف يتجاوز 350 صفحة. ارفع جزء القوائم والإيضاحات في ملف مستقل.');
 for(let i=1;i<=doc.numPages;i++){onProgress(`قراءة الصفحة ${i} من ${doc.numPages}`);const page=await doc.getPage(i);const content=await page.getTextContent();const groups=new Map<number,any[]>();
 for(const item of content.items){if(!('str' in item)||!item.str.trim())continue;const y=Math.round(item.transform[5]/3)*3;const line=groups.get(y)||[];line.push(item);groups.set(y,line);}
 const text=[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(([,line])=>{const rtl=line.filter(v=>v.dir==='rtl').length>line.filter(v=>v.dir==='ltr').length;return line.sort((a,b)=>rtl?b.transform[4]-a.transform[4]:a.transform[4]-b.transform[4]).map(v=>v.str).join('  ')}).join('\n');let previewImage:string|undefined;if(i<=3){const initial=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1.5,1000/initial.width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d');if(context){await page.render({canvas,canvasContext:context,viewport}).promise;previewImage=canvas.toDataURL('image/jpeg',.85);canvas.width=0;canvas.height=0;}}pages.push({page:i,text,previewImage});page.cleanup();}
 }catch(e){if(expired)throw new Error('انتهت مهلة قراءة PDF. ارفع جزءًا أصغر أو نسخة نصية.');throw e}finally{clearTimeout(timeout);await task.destroy()}
 return pages;
}
export function financialTemplate(){return 'metric,value\n'+FIELDS.map(f=>f.key+',').join('\n')+'\n'}
export function saveDownload(name:string,content:string,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
