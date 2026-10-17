'use client';
import {Progress} from '@/components/ui/progress';

/** Accessible progress bar with a visible "n of total (p%)" label. */
export function ScanProgress({value, max, label}: {value: number; max: number; label: string}) {
  const total = Math.max(1, max), done = Math.min(Math.max(0, value), total), pct = Math.round((done / total) * 100);
  return <div className="my-2 grid gap-1" dir="rtl">
    <Progress value={pct} aria-label={label} aria-valuetext={`${done} من ${total}`} className="h-2.5 [direction:ltr] [transform:scaleX(-1)]"/>
    <small className="text-muted-foreground">{done} من {total} ({pct}%)</small>
  </div>;
}
