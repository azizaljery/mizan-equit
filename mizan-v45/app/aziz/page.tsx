import Link from 'next/link';
import RequestPanel from './request-panel';

export const metadata={title:'خوارزمية عزيز | ميزان'};

export default function AzizPage(){
 return <main className="workspace" dir="rtl">
  <nav aria-label="العودة"><Link className="source-link" href="/">ميزان الأسهم</Link> · <Link className="source-link" href="/accuracy">دقة ميزان</Link></nav>
  <h1>خوارزمية عزيز</h1>
  <RequestPanel/>
  <p>مسار بحثي مستقل لتصحيح التوقع ومقارنته بتوقع ميزان الأصلي. الأصل محفوظ ولا تتغير التوصيات أو المحافظ بسبب هذا المسار.</p>
  <section className="panel" aria-label="حالة البحث">
   <h2>حالة التوقع والقياس</h2>
   <p role="status">لم تُعتمد بعد نماذج مدرّبة على سجلات سعودية وأمريكية موثقة وقت إصدارها؛ لذلك لا توجد توقعات أو نسب دقة منشورة لخوارزمية عزيز.</p>
   <p>الاختبارات الوظيفية للشفرة البحثية لا تقيس دقة السوق. عند توافر نتائج مستقبلية ناضجة، ستُعرض المقارنة هنا منفصلة لكل سوق وأفق، مع حجم العينة وفترة الاختبار والمرجع الأصلي.</p>
  </section>
  <section className="panel"><h2>مكونات المسار</h2>
   <ul className="bullet-list"><li>جسر تصحيح ٥ إلى ٢١ جلسة مع كالمان سببي.</li><li>احتمال الاتجاه ومعايرة منفصلة.</li><li>نطاق السعر، أحداث التقويم وتغيّر حالة السوق.</li><li>مراقبة المعايرة والتعافي، أهلية البيانات والمخاطر.</li></ul>
   <p>التشغيل الظلي فقط. لا يُستخدم الناتج في قرار الشراء أو بيع المحفظة.</p>
  </section>
 </main>;
}
