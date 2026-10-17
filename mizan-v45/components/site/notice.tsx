import type {ReactNode} from 'react';
import {Info,TriangleAlert} from 'lucide-react';
import {Alert,AlertDescription,AlertTitle} from '@/components/ui/alert';
import {cn} from '@/lib/utils';

/**
 * Site notice built on ui/alert. Keeps the established `notice` / `notice error` look and the semantics the pages
 * already used: errors announce with role="alert"; informational notices use role="status" unless `role` is given.
 */
export function Notice({tone='error',title,children,className,role,icon=true}:{tone?:'error'|'warning'|'info';title?:ReactNode;children:ReactNode;className?:string;role?:'alert'|'status';icon?:boolean}){
 const Icon=tone==='info'?Info:TriangleAlert;
 return <Alert variant="default" role={role??(tone==='info'?'status':'alert')} data-tone={tone} className={cn('notice site-notice',tone==='error'&&'error',tone==='warning'&&'demo',className)}>
  {icon&&<Icon size={18} aria-hidden="true"/>}
  <div className="site-notice-body">{title&&<AlertTitle>{title}</AlertTitle>}<AlertDescription>{children}</AlertDescription></div>
 </Alert>;
}
