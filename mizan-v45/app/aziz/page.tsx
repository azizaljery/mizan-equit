import {SiteHeader} from '@/components/site/site-header';
import RequestPanel from './request-panel';
import ImportPanel from './import-panel';
import MonitorPanel from './monitor-panel';

export const metadata={title:'خوارزمية عزيز | ميزان'};

export default function AzizPage(){
 return <><SiteHeader current="/aziz"/><main className="workspace" dir="rtl">
  <h1>خوارزمية عزيز</h1>
  <ImportPanel/>
  <RequestPanel/>
  <MonitorPanel/>
  <p>مسار بحثي مستقل لتصحيح التوقع ومقارنته بتوقع ميزان الأصلي. الأصل محفوظ ولا تتغير التوصيات أو المحافظ بسبب هذا المسار.</p>
  <section className="panel" aria-label="حالة البحث"><h2>حالة التوقع والقياس</h2><p role="status">الوضع الحالي OFF. نموذج الاتجاه المسجل (DIR-0001) مرفوض بقرار موثق، ولا يوجد أثر نموذج آخر مدرّب ومجمد. البيانات التاريخية تحفظ منفصلة عن ميزان بوقت الجلب فقط، فتصلح للاستكشاف لا للدليل الزمني الحاسم. لا تُنشر توقعات أو نسب دقة لعزيز حتى يكتمل تدريب زمني موثق واختبار خارج العينة واعتماد المالك.</p></section>
 </main></>;
}
