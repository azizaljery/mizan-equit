import {SimulationPanel} from '@/components/simulation-panel';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | محاكاة تاريخية'};
export default function SimulationPage(){return <><SiteHeader caption="محاكاة تاريخية"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>محاكاة تاريخية</h1><p>اختبار زمني بقواعد وعتبات مسجلة مسبقًا (mizan-sim-1): كل قرار يستخدم بيانات ما قبله فقط، وتُحجز فترة أخيرة لا تدخل في اختيار العتبات. نتائجها ليست توقعات صدرت فعلًا، ولا تغيّر المحرك الحي.</p></section><SimulationPanel/></main></>;}
