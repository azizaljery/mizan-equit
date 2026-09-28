'use client';
import {useEffect,useState} from 'react';
import {MetalsDiagnosticDetails} from './metals-diagnostic';
type Connection={storageReady:boolean;configured:boolean;updatedAt:string|null;message?:string;test?:{ok:boolean;message:string;quote?:{price:number;quoteTime:string}|null;diagnostic?:{code:string;httpStatus?:number;attempts:number;checkedAt:string}|null}};
export function MetalsConnection(){
 const [status,setStatus]=useState<Connection|null>(null),[apiKey,setApiKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failure,setFailure]=useState(false);
 async function action(action:string){setBusy(true);setMessage('');setFailure(false);try{
   const response=await fetch('/api/admin/metals-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='save'?{action,apiKey}:{action}),cache:'no-store'});
   const data=await response.json();if(!response.ok)throw Error(data.error||'تعذر إكمال الطلب.');setStatus(data);
   if(action==='save'){setApiKey('');setMessage(data.message);}
   if(action==='test'){setFailure(!data.test.ok);setMessage(data.test.ok?'نجح الاتصال وجلب سعر الذهب من Metals.dev.':data.test.message);}
 }catch(e){setFailure(true);setMessage(e instanceof Error?e.message:'تعذر الاتصال. أعد المحاولة.');}finally{setBusy(false);}}
 useEffect(()=>{void action('status');},[]);
 return <section className="admin-section" aria-labelledby="metals-connection-title"><h3 id="metals-connection-title">اتصال أسعار الذهب — Metals.dev</h3>
 <p>{status?.configured?'يوجد مفتاح محفوظ؛ يمكنك اختباره أو استبداله.':'أضف مفتاح API من حسابك في Metals.dev.'}</p>
 <form onSubmit={e=>{e.preventDefault();void action('save');}} autoComplete="off">
  <label htmlFor="metals-api-key">مفتاح Metals.dev<input id="metals-api-key" name="metals-api-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" dir="ltr" maxLength={512} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="الصق المفتاح هنا" disabled={busy||!status?.storageReady}/></label>
  <div className="gold-tabs"><button type="submit" className="secondary-btn" disabled={busy||!status?.storageReady||!apiKey.trim()}>حفظ المفتاح</button><button type="button" className="secondary-btn" disabled={busy||!status?.configured} onClick={()=>void action('test')}>اختبار الاتصال</button><button type="button" className="link-btn" disabled={busy} onClick={()=>void action('status')}>تحديث الحالة</button></div>
 </form>
 {busy&&<p role="status">جارٍ تنفيذ الطلب…</p>}{message&&<p role={failure?'alert':'status'}>{message}</p>}
 {status?.test?.diagnostic&&<MetalsDiagnosticDetails diagnostic={status.test.diagnostic}/>}
 {status&&!status.storageReady&&<p role="alert">لم تكتمل تهيئة الحفظ الآمن على الخادم بعد.</p>}
 {status?.test?.ok&&status.test.quote&&<p>سعر الأونصة: {status.test.quote.price.toLocaleString('ar-SA')} دولار · وقت المصدر: <bdi>{new Date(status.test.quote.quoteTime).toLocaleString('ar-SA')}</bdi> · <a href="/gold">فتح صفحة الذهب</a></p>}
 <details><summary>ⓘ حفظ المفتاح واستهلاك الخدمة</summary><p>يُرسل المفتاح إلى خادم ميزان ويُحفظ مشفّرًا. لا يظهر للزوار أو ضمن سجل الإدارة، ولا يُحفظ في جهازك بواسطة ميزان. حفظه وحده لا يعني نجاح جلب السعر. اختبار الاتصال يستهلك من حصة المزود عند عدم وجود سعر حديث محفوظ؛ تبقى حدود الطلبات سارية.</p><a href="https://metals.dev/policy/terms" target="_blank" rel="noopener noreferrer">شروط استخدام Metals.dev</a></details>
 </section>;
}
