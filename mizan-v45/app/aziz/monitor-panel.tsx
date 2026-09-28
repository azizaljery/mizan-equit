'use client';
import {useEffect,useState} from 'react';

type Record={id:string;symbol:string;horizon:number;basePrice:number;currency:string;status:string;data:{company:string;issuedLabel:string;expectedClose:number;closeRange?:number[];intradayRange?:number[];direction:string;targetSession:string;note:string}};
const price=(value:number,currency:string)=>`${value.toLocaleString('ar-SA',{maximumFractionDigits:2})} ${currency}`;

export default function MonitorPanel(){
 const [records,setRecords]=useState<Record[]>([]),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/aziz/monitor',{cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error);setRecords(body.records);}).catch(e=>setError(e instanceof Error?e.message:'تعذر تحميل سجل عزيز.'));},[]);
 return <section className="panel" aria-label="سجل مراقبة عزيز">
  <h2>سجل مراقبة عزيز المستقل</h2>
  <p>هذا سجل تجريبي منفصل عن ميزان؛ لا يغيّر توقعاته أو قراراته أو بيانات إنتاجه.</p>
  {error&&<p role="alert">{error}</p>}
  {!error&&!records.length&&<p role="status">جارٍ تحميل السجل…</p>}
  {!!records.length&&<div style={{overflowX:'auto'}}><table><thead><tr><th>الشركة</th><th>الأفق</th><th>سعر الأساس</th><th>القراءة</th><th>المتوقع</th><th>النطاق</th><th>جلسة القياس</th></tr></thead><tbody>{records.map(row=><tr key={row.id}><td>{row.data.company} <span dir="ltr">{row.symbol}</span></td><td>{row.horizon} جلسة</td><td>{price(row.basePrice,row.currency)}</td><td>{row.data.direction}</td><td>{price(row.data.expectedClose,row.currency)}</td><td>{row.data.closeRange?.map(v=>price(v,row.currency)).join(' – ')||'قيد التتبع'}</td><td dir="ltr">{row.data.targetSession}</td></tr>)}</tbody></table></div>}
  {!!records.length&&<p>أرامكو: قراءة قبل الافتتاح من إغلاق 24 سبتمبر. الحالة «تجريبي غير مدرّب»؛ تُقارن بالنتيجة عند اكتمال كل أفق ولا تُعرض كدقة سوقية مثبتة.</p>}
 </section>;
}
