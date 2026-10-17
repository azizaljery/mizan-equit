import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';

/** Confidence label as a coloured badge. Text is shown as-is (the model's own Arabic wording); colour only groups it. */
export function confidenceTone(value: string | null | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  const v = String(value ?? '').trim();
  if (/^(مرتفع|مرتفعة|عال|عالية)/.test(v)) return 'high';
  if (/^(متوسط|متوسطة)/.test(v)) return 'medium';
  if (/^(منخفض|منخفضة)/.test(v)) return 'low';
  return 'unknown';
}
const tones = {
  high: 'border-emerald-600/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  medium: 'border-amber-600/30 bg-amber-500/15 text-amber-800 dark:text-amber-200',
  low: 'border-rose-600/30 bg-rose-500/15 text-rose-800 dark:text-rose-200',
  unknown: 'border-border bg-muted text-muted-foreground',
} as const;
export function ConfidenceBadge({value, className}: {value: string | null | undefined; className?: string}) {
  const text = String(value ?? '').trim() || 'غير محددة';
  return <Badge variant="outline" data-tone={confidenceTone(text)} className={cn('whitespace-normal text-start', tones[confidenceTone(text)], className)}>{text}</Badge>;
}
