import {Skeleton} from '@/components/ui/skeleton';

/** Placeholder layout of a company report while sources are being fetched. Decorative only (aria-hidden). */
export function ReportSkeleton() {
  return <div className="mt-4 grid gap-3" aria-hidden="true">
    <Skeleton className="h-8 w-2/5"/>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({length: 4}, (_, i) => <Skeleton key={i} className="h-20"/>)}</div>
    <Skeleton className="h-56 w-full"/>
    <div className="grid gap-2">{Array.from({length: 3}, (_, i) => <Skeleton key={i} className="h-4" style={{width: `${90 - i * 15}%`}}/>)}</div>
  </div>;
}
