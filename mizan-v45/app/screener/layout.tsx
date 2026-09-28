import type {ReactNode} from 'react';
/** Navigation for the existing screener section; data and controls remain owner-gated. */
export default function ScreenerLayout({children}:{children:ReactNode}){
 return <><nav className="panel" dir="rtl" aria-label="أقسام فرز ميزان"><a className="source-link" href="/screener">فرز الأسهم</a><span aria-hidden="true"> · </span><a className="source-link" href="/screener/operations">متابعة الترشيحات وأعمال الوكلاء</a></nav>{children}</>;
}
