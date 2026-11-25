import {PicksAccuracyPanel} from '@/components/picks-accuracy-panel';
import {SiteHeader} from '@/components/site/site-header';
export const metadata={title:'ميزان | دقة ترشيحات الصعود'};
export default function PicksAccuracyPage(){return <><SiteHeader caption="دقة ترشيحات الصعود"/><main className="workspace" dir="rtl"><section className="search-hero"><h1>دقة ترشيحات الصعود</h1><p>كم ترشيحًا صاعدًا تحقق فعلًا من إجمالي الترشيحات المحسومة، مقارنةً بمعدل صعود الأسهم المتاحة للترشيح نفسه، لكل سوق وأفق ومحرك. قراءة للنتائج المخزَّنة فقط؛ لا تغيّر توقعًا ولا قرارًا، وليست توصية شراء أو ضمانًا للصعود.</p></section><PicksAccuracyPanel/></main></>;}
