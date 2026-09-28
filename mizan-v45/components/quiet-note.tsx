import type {ReactNode} from 'react';
export function QuietNote({children,label='عرض التفاصيل'}:{children:ReactNode;label?:string}){return <details className="quiet-note"><summary>ⓘ {label}</summary><div>{children}</div></details>}
