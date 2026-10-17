import {CompanyPicks} from '@/components/company-picks';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | توصيات الشركات'};
export default function PicksPage(){return <><SiteHeader current="/picks"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>توصيات الشركات</h1><p>الشركات التي يرجّح ميزان صعودها يوميًا أو أسبوعيًا أو شهريًا، من التوقعات المسجلة فعلًا وبنفس شروط الفرز. لكل ترشيح سعره المرجعي ونطاقه ودرجة ثقته وسجل دقة ميزان لنفس المدة.</p></section><CompanyPicks/><p className="muted">للمسح الأوسع (حتى 200 سهم) استخدم <a href="/screener">فرز التوقعات</a>. لا تعني الترشيحات ضمانًا؛ راجع النطاق والمخاطر قبل أي قرار.</p></main></>;}
