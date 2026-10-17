import type {ReactNode} from 'react';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';

/** Visual groups only; the visible text always carries the meaning (colour is never the sole signal). */
export type StatusTone='ok'|'pending'|'partial'|'failed'|'excluded'|'neutral';
const tones:Record<StatusTone,string>={
 ok:'border-emerald-600/30 bg-emerald-500/15 text-emerald-800',
 pending:'border-sky-700/25 bg-sky-500/10 text-sky-900',
 partial:'border-amber-600/30 bg-amber-500/15 text-amber-800',
 failed:'border-rose-600/30 bg-rose-500/15 text-rose-800',
 excluded:'border-border bg-muted text-muted-foreground',
 neutral:'border-border bg-muted text-foreground',
};
/** Maps the state keys used across Mizan's APIs to a tone. Unknown keys stay neutral. */
export function statusTone(state:string|null|undefined):StatusTone{
 const s=String(state??'');
 if(/^(complete|completed|works|ok|forecasted|success)$/.test(s))return 'ok';
 if(/^(pending|waiting|running|queued|processing)$/.test(s))return 'pending';
 if(/^(partial|needs_setup|incomplete)$/.test(s))return 'partial';
 if(/^(failed|error|invalid)$/.test(s))return 'failed';
 if(/^(excluded|disabled|unavailable|archived)$/.test(s))return 'excluded';
 return 'neutral';
}
export function StatusBadge({state,tone,children,className}:{state?:string|null;tone?:StatusTone;children:ReactNode;className?:string}){
 const t=tone??statusTone(state);
 return <Badge variant="outline" data-tone={t} className={cn('status-badge whitespace-normal text-start',tones[t],className)}>{children}</Badge>;
}
