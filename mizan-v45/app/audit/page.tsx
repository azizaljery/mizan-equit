import {AuditPanel} from '@/components/audit-panel';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | تدقيق السهم'};
export default function AuditPage(){return <><SiteHeader current="/audit" caption="تدقيق السهم"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>تدقيق السهم</h1><p>قواعد رقمية معلنة مسبقًا على الأسعار المرصودة، وكل بند يُعرض بأرقامه وقاعدته. الحالة الناتجة بحثية وبأوزان متساوية غير معايرة، ولا تدخل أي توقع أو درجة أو قرار للبوت، ولا تعد بعائد.</p></section><AuditPanel/></main></>;}
