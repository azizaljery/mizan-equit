'use client';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {ChevronDown, LockKeyhole, RefreshCw, TriangleAlert} from 'lucide-react';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Skeleton} from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {AdminToolsError, adminRequest} from '@/lib/admin-tools-client';

export const ADMIN_LOGIN_HREF = '/#mizan-admin';
export const ACCESS_SIGNIN_HREF = '/api/admin/signin?return_to=%2Fadmin%2Ftools';

/** Load an admin endpoint on demand (optionally on mount), keeping the last error. */
export function useAdminResource<T = any>(url: string | null, auto = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminToolsError | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    controller.current?.abort();
    const c = new AbortController(); controller.current = c;
    setLoading(true); setError(null);
    try {
      const {data: value} = await adminRequest<T>(url, {signal: c.signal});
      if (!c.signal.aborted) setData(value);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof AdminToolsError ? e : new AdminToolsError('تعذرت القراءة.', 0, 'network'));
    } finally { if (!c.signal.aborted) setLoading(false); }
  }, [url]);
  useEffect(() => { if (auto) void load(); return () => controller.current?.abort(); }, [auto, load]);
  return {data, error, loading, load, setData};
}

export function toAdminError(e: unknown): AdminToolsError {
  return e instanceof AdminToolsError ? e : new AdminToolsError(e instanceof Error ? e.message : 'تعذرت العملية.', 0, 'network');
}

/** Readable Arabic error; auth failures also show how to sign in. */
export function ErrorNotice({error, className}: {error: AdminToolsError | null; className?: string}) {
  if (!error) return null;
  const auth = error.kind === 'session' || error.kind === 'owner' || error.kind === 'access';
  return (
    <Alert variant="destructive" className={className}>
      {auth ? <LockKeyhole aria-hidden /> : <TriangleAlert aria-hidden />}
      <AlertTitle>{auth ? 'يلزم تسجيل دخول المالك' : error.kind === 'locked' ? 'تشغيل آخر قائم' : 'تعذرت العملية'}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {auth && (
          <p className="admin-tools-auth-links">
            <a href={ACCESS_SIGNIN_HREF}>١) الدخول عبر Cloudflare Access</a>
            <span aria-hidden> · </span>
            <a href={ADMIN_LOGIN_HREF}>٢) دخول إدارة ميزان (اسم المستخدم وكلمة المرور)</a>
            <span> ثم عُد إلى هذه الصفحة.</span>
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function RawJson({value, label = 'البيانات الخام (JSON)'}: {value: unknown; label?: string}) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="admin-tools-raw">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" aria-expanded={open}>
          <ChevronDown aria-hidden className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre dir="ltr" className="admin-tools-pre">{JSON.stringify(value, null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
const TONE_CLASS: Record<Tone, string> = {
  ok: 'admin-tools-badge-ok', warn: 'admin-tools-badge-warn', bad: 'admin-tools-badge-bad', neutral: '',
};
export function StatusBadge({tone, children}: {tone: Tone; children: ReactNode}) {
  return <Badge variant={tone === 'neutral' ? 'outline' : 'secondary'} className={TONE_CLASS[tone]}>{children}</Badge>;
}
/** Maps the job/check vocabularies used by Mizan routes to a tone + Arabic label. */
export function statusTone(status: unknown, ok?: unknown): {tone: Tone; label: string} {
  const s = String(status ?? '');
  const labels: Record<string, [Tone, string]> = {
    completed: ['ok', 'مكتملة'], ok: ['ok', 'سليمة'], ready: ['ok', 'جاهز'], accepted: ['ok', 'مقبولة'], complete: ['ok', 'مكتملة'],
    ready_for_owner_review: ['ok', 'جاهز لمراجعة المالك'], PASS: ['ok', 'PASS'],
    partial: ['warn', 'جزئية'], stale: ['warn', 'متأخرة'], locked: ['warn', 'مقفلة (تشغيل آخر قائم)'], running: ['warn', 'قيد التشغيل'],
    scanning: ['warn', 'قيد المسح'], retryable: ['warn', 'تُعاد'], pending: ['neutral', 'بانتظار'], REVIEW: ['warn', 'REVIEW'],
    not_manual: ['warn', 'ليست يدوية'], skipped: ['warn', 'متروكة'], missing: ['neutral', 'غير موجودة'], disabled: ['neutral', 'متوقفة'],
    none: ['neutral', 'لا يوجد'],
    failed: ['bad', 'فاشلة'], invalid: ['bad', 'غير صالحة'], unavailable: ['bad', 'تعذرت القراءة'], 'read-failed': ['bad', 'تعذرت القراءة'],
    blocked: ['bad', 'محجوبة'], VETO: ['bad', 'VETO'],
  };
  if (labels[s]) return {tone: labels[s][0], label: labels[s][1]};
  if (ok === true) return {tone: 'ok', label: s || 'سليمة'};
  if (ok === false) return {tone: 'warn', label: s || 'تحتاج تحققًا'};
  return {tone: 'neutral', label: s || '—'};
}
export function JobStatus({status, ok}: {status: unknown; ok?: unknown}) {
  const t = statusTone(status, ok);
  return <StatusBadge tone={t.tone}>{t.label}</StatusBadge>;
}

/** Definition list rendered as a responsive grid of label/value pairs. */
export function Facts({items}: {items: Array<[string, ReactNode]>}) {
  return (
    <dl className="admin-tools-facts">
      {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}
    </dl>
  );
}

export function LoadingBlock({lines = 3}: {lines?: number}) {
  return (
    <div className="admin-tools-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل…</span>
      {Array.from({length: lines}, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
  );
}

export function RefreshButton({onClick, loading, label = 'تحديث'}: {onClick: () => void; loading: boolean; label?: string}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <RefreshCw aria-hidden className={loading ? 'animate-spin' : undefined} />
      {loading ? 'جارٍ التحميل…' : label}
    </Button>
  );
}

/** Button that asks for explicit confirmation before a mutating/expensive action. */
export function ConfirmAction({
  trigger, title, description, confirmLabel, onConfirm, disabled, destructive,
}: {
  trigger: ReactNode; title: string; description: ReactNode; confirmLabel: string;
  onConfirm: () => void; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} variant={destructive ? 'destructive' : 'default'}>{trigger}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div className="admin-tools-dialog-text">{description}</div></AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Ltr({children}: {children: ReactNode}) {
  return <bdi dir="ltr" className="admin-tools-ltr">{children}</bdi>;
}
