'use client';
import {useEffect,useRef,useState} from 'react';
export default function VerifyPage(){
 const [data,setData]=useState<Record<string,unknown>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const load=async()=>{
  controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(true);setError('');setData(null);
  try{const r=await fetch('/api/admin/dashboard',{credentials:'same-origin',cache:'no-store',signal:c.signal});if(!r.ok)throw Error('يلزم حساب المالك وجلسة إدارة سارية لقراءة التقرير.');const v=await r.json();if(!c.signal.aborted)setData(v);}
  catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'تعذر تحميل التقرير.');}finally{if(!c.signal.aborted)setBusy(false);}
 };
 useEffect(()=>()=>controller.current?.abort(),[]);
 return <main className="panel" dir="rtl"><h1>التحقق التشغيلي لميزان</h1><p>قراءة للسجلات الحالية؛ لا يشغّل هذا العرض مهامًا ولا يثبت دقة التوصيات.</p><p><a className="secondary-btn" href="/admin/tools">أدوات الإدارة (تشخيص مقروء، اختبار تاريخي، مهام، مجلس، أتمتة)</a></p><button className="mizan-private-btn" onClick={load} disabled={busy}>{busy?'جارٍ التحميل…':'قراءة تقرير التحقق'}</button>{error&&<p role="alert">{error}</p>}{data&&Object.entries(data).map(([key,value])=><details key={key}><summary>{key}</summary><pre dir="ltr" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(value,null,2)}</pre></details>)}</main>;
}
