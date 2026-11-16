import {env} from 'cloudflare:workers';
import {latestMacro} from '@/lib/macro/collect';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | الاقتصاد الكلي'};
export const dynamic='force-dynamic';
const FREQ:Record<string,string>={daily:'يومي',monthly:'شهري',annual:'سنوي'};
const MKT:Record<string,string>={us:'أمريكا',sa:'السعودية',global:'عالمي'};
const num=(v:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v);
export default async function MacroPage(){
 let rows:any[]=[],failed=false;
 try{rows=await latestMacro((env as any).DB);}catch{failed=true;}
 return <><SiteHeader current="/macro" caption="الاقتصاد الكلي"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>الاقتصاد الكلي</h1><p>بيانات وصفية من FRED والبنك الدولي، لا تدخل أي درجة أو قرار. وقت النشر الأصلي غير متاح، فالتوفر يُقاس بوقت الجلب. الخلايا الفارغة تعني أن الجلب لم ينجح بعد.</p></section>
 {failed?<p>تعذر قراءة البيانات.</p>:<div style={{overflowX:'auto'}}><table dir="rtl" style={{width:'100%',borderCollapse:'collapse',textAlign:'right'}}><thead><tr>{['المؤشر','السوق','التكرار','آخر قيمة','تاريخها','القيمة السابقة','الوحدة'].map(h=><th key={h} style={{padding:'8px',borderBottom:'1px solid currentColor'}}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td style={{padding:'8px'}}>{r.name}</td><td>{MKT[r.market]}</td><td>{FREQ[r.frequency]}</td><td>{r.latest?num(r.latest.value):'—'}</td><td>{r.latest?.date??'—'}</td><td>{r.previous?num(r.previous.value):'—'}</td><td>{r.unit}</td></tr>)}</tbody></table></div>}</main></>;
}
