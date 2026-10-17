import type {ReactNode} from 'react';
import {Globe2} from 'lucide-react';
import {SiteHeader} from '@/components/site/site-header';
import {SectionSubnav} from '@/components/site/section-subnav';
/** Shared header and navigation for the existing screener section; data and controls remain owner-gated. */
export default function ScreenerLayout({children}:{children:ReactNode}){
 return <><SiteHeader current="/screener" meta={<><Globe2 size={16} aria-hidden="true"/> السعودية · أمريكا</>}/><SectionSubnav label="أقسام فرز ميزان" links={[{href:'/screener',label:'فرز الأسهم'},{href:'/screener/operations',label:'متابعة الترشيحات وأعمال الوكلاء'}]}/>{children}</>;
}
