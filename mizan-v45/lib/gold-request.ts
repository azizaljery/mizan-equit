export type GoldFailureCode='timeout'|'network'|'dns'|'tls'|'runtime'|'redirect'|'http'|'invalid_key'|'quota'|'account'|'parameters'|'response';
export class GoldRequestError extends Error{
 constructor(public code:GoldFailureCode,message:string,public retryable=false,public httpStatus?:number){super(message);this.name='GoldRequestError';}
}
function transportError(error:unknown,timedOut:boolean){
 const e=error as {name?:string;message?:string;cause?:{code?:string}}|null;
 if(timedOut||e?.name==='TimeoutError'||e?.name==='AbortError')return new GoldRequestError('timeout','انتهت مهلة انتظار مصدر الذهب قبل اكتمال الرد.',true);
 const detail=String(e?.message||'')+' '+String(e?.cause?.code||'');
 if(/ENOTFOUND|EAI_AGAIN|DNS|name resolution/i.test(detail))return new GoldRequestError('dns','تعذر الوصول إلى عنوان خادم مصدر الذهب.',true);
 if(/CERT_|certificate|TLS|SSL/i.test(detail))return new GoldRequestError('tls','تعذر إنشاء اتصال آمن مع مصدر الذهب.');
 if(/Cannot perform I\/O|not implemented|not a function|disallowed|not allowed|blocked by/i.test(detail))return new GoldRequestError('runtime','تعذر تنفيذ الاتصال الخارجي من خادم ميزان؛ يلزم فحص إعداد الاتصال.');
 return new GoldRequestError('network','تعذر إنشاء اتصال شبكي مع مصدر الذهب. لم يصل رد يثبت صحة المفتاح أو رفضه.',true);
}
function providerFailure(data:any,status:number){
 const code=Number(data?.error_code);
 if(code===1101)return new GoldRequestError('invalid_key','مفتاح Metals.dev غير صحيح بحسب رد المصدر.',false,status);
 if(code===1203)return new GoldRequestError('quota','استهلكت حصة Metals.dev المتاحة لهذه الفترة.',false,status);
 if(code===1201||code===1202)return new GoldRequestError('account','حساب Metals.dev أو اشتراكه غير فعال بحسب رد المصدر.',false,status);
 if([2101,2102,2103,2104,2105].includes(code))return new GoldRequestError('parameters','رفض Metals.dev إعدادات طلب البيانات؛ يلزم إصلاح الربط.',false,status);
 return null;
}

// Fixed provider URLs are built by the server. Never log their query strings,
// response bodies, headers or the original exception: they may contain a key.
export async function requestGoldJson(url:string,headers:Record<string,string>={},fetcher:typeof fetch=fetch,timeoutMs=10000){
 const controller=new AbortController(),started=Date.now();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 let httpStatus:number|undefined;
 try{
  const response=await fetcher(url,{headers:{Accept:'application/json',...headers},signal:controller.signal,redirect:'manual'});httpStatus=response.status;
  if(httpStatus>=300&&httpStatus<400)throw new GoldRequestError('redirect','طلب المصدر تحويل الاتصال إلى عنوان آخر؛ لم يُرسل المفتاح إلى ذلك العنوان.',false,httpStatus);
  if(Number(response.headers.get('content-length')||0)>1500000)throw new GoldRequestError('response','استجابة المصدر أكبر من الحد المسموح.',false,httpStatus);
  const reader=response.body?.getReader();let body='',size=0;
  if(reader){const decoder=new TextDecoder();while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1500000){await reader.cancel();throw new GoldRequestError('response','استجابة المصدر أكبر من الحد المسموح.',false,httpStatus);}body+=decoder.decode(r.value,{stream:true});}body+=decoder.decode();}
  let data:any;try{data=JSON.parse(body);}catch{/* HTTP status still determines safe failure details below. */}
  if(new URL(url).hostname==='api.metals.dev'&&data?.status==='failure'){const failure=providerFailure(data,httpStatus);if(failure)throw failure;}
  if(!response.ok)throw new GoldRequestError(httpStatus===429?'quota':'http',httpStatus===429?'تجاوز حد طلبات المصدر؛ انتظر تجدد الحصة.':httpStatus===401||httpStatus===403?'رفض المصدر صلاحية الوصول. راجع حالة المفتاح والحساب في لوحة المزود.':`تعذر جلب مصدر الذهب: HTTP ${httpStatus}.`,[408,502,503,504].includes(httpStatus),httpStatus);
  if(data===undefined)throw new GoldRequestError('response','وصل رد من المصدر لكن تعذر قراءة بياناته.',false,httpStatus);
  return data;
 }catch(error){
  const failure=error instanceof GoldRequestError?error:transportError(error,controller.signal.aborted);
  console.warn(JSON.stringify({event:'gold-source-request-failed',source:new URL(url).hostname,code:failure.code,httpStatus:failure.httpStatus??httpStatus??null,durationMs:Date.now()-started}));
  throw failure;
 }finally{clearTimeout(timer);}
}
