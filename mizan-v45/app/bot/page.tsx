import {BotDashboard} from '@/components/bot-dashboard';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | سارا — البوت الورقي'};
export default function BotPage(){return <><SiteHeader current="/bot" caption="سارا — البوت الورقي"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>سارا — البوت الورقي</h1><p>تجربة تداول افتراضية بأموال غير حقيقية وبلا ربط بأي وسيط. كل قرار قابل للتتبع من التوقع الأصلي إلى التنفيذ الافتراضي ونتيجته. أداء المحفظة ودقة التوقعات مقياسان منفصلان؛ ولا تعد الأرقام بعائد.</p></section><BotDashboard/></main></>;}
