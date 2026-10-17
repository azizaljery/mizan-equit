import {ForecastTestsWorkspace} from '@/components/forecast-tests-workspace';
import {SiteHeader} from '@/components/site/site-header';
export default function TestsPage(){return <><SiteHeader current="/tests"/><main className="workspace"><h1>ملفاتي ← اختبارات ميزان</h1><div className="research-workspace"><ForecastTestsWorkspace/></div></main></>;}
