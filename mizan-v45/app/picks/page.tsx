import {CompanyPicks} from '@/components/company-picks';
import {PicksLedger} from '@/components/picks-ledger';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | توصيات الشركات'};
export default function PicksPage(){return <><SiteHeader current="/picks"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>ترشيحات المحرك</h1><p>الشركات ذات أعلى مراكز السيناريو الصاعدة يوميًا أو أسبوعيًا أو شهريًا، من التوقعات المسجلة فعلًا وبنفس شروط الفرز. لكل ترشيح سعره المرجعي ونطاقه وتصنيف المحرك الداخلي وسجل قياس المحرك لنفس المدة. هذا ترتيب غير معتمد تنبؤيًا.</p></section><CompanyPicks/><PicksLedger/><p className="muted">للمسح الأوسع (حتى 200 سهم) استخدم <a href="/screener">فرز التوقعات</a>. لا تعني الترشيحات ضمانًا؛ راجع النطاق والمخاطر قبل أي قرار.</p></main></>;}
