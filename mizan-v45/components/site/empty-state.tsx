import type {ReactNode} from 'react';
import {Inbox} from 'lucide-react';
import {Empty,EmptyContent,EmptyDescription,EmptyHeader,EmptyMedia,EmptyTitle} from '@/components/ui/empty';
import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';

/** Empty state on ui/empty, styled to match the site's dashed `.empty` box. */
export function EmptyState({title,children,icon,action,className}:{title:ReactNode;children?:ReactNode;icon?:ReactNode;action?:ReactNode;className?:string}){
 return <Empty className={cn('site-empty',className)} dir="rtl">
  <EmptyHeader><EmptyMedia variant="icon">{icon??<Inbox aria-hidden="true"/>}</EmptyMedia><EmptyTitle>{title}</EmptyTitle>{children&&<EmptyDescription>{children}</EmptyDescription>}</EmptyHeader>
  {action&&<EmptyContent>{action}</EmptyContent>}
 </Empty>;
}

/** Placeholder rows while a list or table loads. Decorative; pair it with a visible role="status" text. */
export function ListSkeleton({rows=4,className}:{rows?:number;className?:string}){
 return <div className={cn('grid gap-2 py-2',className)} aria-hidden="true">{Array.from({length:rows},(_,i)=><Skeleton key={i} className="h-10" style={{width:`${100-(i%3)*8}%`}}/>)}</div>;
}

/** Placeholder for a chart area while candles load. Decorative. */
export function ChartSkeleton({className}:{className?:string}){
 return <div className={cn('grid gap-3 py-2',className)} aria-hidden="true"><Skeleton className="h-4 w-1/3"/><Skeleton className="h-56 w-full"/><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({length:4},(_,i)=><Skeleton key={i} className="h-10"/>)}</div></div>;
}
