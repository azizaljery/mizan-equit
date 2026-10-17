import {AccuracySample} from '@/components/accuracy-sample';
import {SiteHeader} from '@/components/site/site-header';
export default function SamplePage(){return <><SiteHeader current="/accuracy-sample"/><main className="workspace"><nav className="ask-actions" aria-label="صفحات مرتبطة"><a className="source-link" href="/accuracy">دقة التوقعات المسجلة</a></nav><AccuracySample/></main></>;}
