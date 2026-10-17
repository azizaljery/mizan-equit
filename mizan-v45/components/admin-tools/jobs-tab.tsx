'use client';
import {useState} from 'react';
import {toast} from 'sonner';
import {PlayCircle, Timer} from 'lucide-react';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {
  AdminToolsError, EVALUATE_LIMIT_DEFAULT, EVALUATE_LIMIT_MAX, adminRequest, clampEvaluateLimit,
  fmtDateTime, fmtDuration, fmtNumber,
} from '@/lib/admin-tools-client';
import {ConfirmAction, ErrorNotice, Facts, JobStatus, LoadingBlock, RawJson, RefreshButton, Ltr, toAdminError, useAdminResource} from './shared';

export function RunSummary({summary}: {summary: any}) {
  if (!summary) return <p className="admin-tools-muted">لا يوجد سجل تشغيل محفوظ بعد.</p>;
  const integrity = summary.integrity;
  return (
    <div className="admin-tools-stack">
      <Facts items={[
        ['الحالة', <JobStatus key="s" status={summary.status} />],
        ['المُشغّل', summary.triggeredBy === 'cron' ? 'مجدول' : 'يدوي'],
        ['البداية', fmtDateTime(summary.startedAt)],
        ['المدة', fmtDuration(summary.durationMs)],
        ['الحد', fmtNumber(summary.limit)],
        ['رموز مفحوصة', fmtNumber(summary.symbolsScanned)],
        ['رموز قُيّمت', fmtNumber(summary.symbolsResolved)],
        ['متروكة', fmtNumber(summary.symbolsSkipped)],
        ['فاشلة', fmtNumber(summary.symbolsFailed)],
        ['تقييمات محفوظة', fmtNumber(summary.evaluationsSaved)],
        ['تأكيد الحفظ', summary.stateSaved ? 'محفوظ' : 'غير مؤكد'],
      ]} />
      {summary.lockSkipped && <p className="admin-tools-muted">{summary.lockSkipped}</p>}
      {!!summary.errors?.length && (
        <div className="admin-tools-scroll">
          <Table>
            <TableHeader><TableRow><TableHead>الرمز</TableHead><TableHead>السبب</TableHead></TableRow></TableHeader>
            <TableBody>{summary.errors.map((e: any, i: number) => <TableRow key={i}><TableCell><Ltr>{e.symbol || '—'}</Ltr></TableCell><TableCell className="admin-tools-wrap">{e.error}</TableCell></TableRow>)}</TableBody>
          </Table>
        </div>
      )}
      {integrity && (
        <p className="admin-tools-muted">
          فحص الاتساق: تكرار النتائج {fmtNumber(integrity.outcomesDuplicates)} · تكرار الإصدارات المتتالية {fmtNumber(integrity.consecutiveRevisionDuplicates)} · تكرار أرقام الإصدارات {fmtNumber(integrity.revisionNumberDuplicates)} (القيمة -1 تعني تعذر الفحص، لا الصفر).
        </p>
      )}
    </div>
  );
}

export function JobsTab() {
  const last = useAdminResource<any>('/api/admin/run-background', true);
  const [limitText, setLimitText] = useState(String(EVALUATE_LIMIT_DEFAULT));
  const limit = clampEvaluateLimit(limitText);
  const [busy, setBusy] = useState(false), [error, setError] = useState<AdminToolsError | null>(null), [result, setResult] = useState<any>(null);
  async function run() {
    setBusy(true); setError(null); setResult(null);
    try {
      const {data} = await adminRequest('/api/admin/jobs/evaluate-due', {method: 'POST', json: {limit}});
      setResult(data.summary); toast.success('اكتملت دورة التقييم.'); void last.load();
    } catch (e) {
      const err = toAdminError(e);
      // 409 (locked) and 503 (partial save) still carry a summary worth showing.
      const summary = (err.body as any)?.summary;
      if (summary) { setResult(summary); void last.load(); }
      setError(err); toast.error(err.kind === 'locked' ? 'تشغيل آخر قائم؛ أعد المحاولة لاحقًا.' : err.message);
    } finally { setBusy(false); }
  }
  return (
    <div className="admin-tools-grid">
      <Card>
        <CardHeader>
          <CardTitle><PlayCircle aria-hidden className="admin-tools-icon" />تشغيل تقييم التوقعات المستحقة</CardTitle>
          <CardDescription>يقيّم التوقعات التي حان موعد نتيجتها لعدد محدود من الرموز ثم يتوقف. المصدر: <Ltr>/api/admin/jobs/evaluate-due</Ltr></CardDescription>
        </CardHeader>
        <CardContent className="admin-tools-stack">
          <Alert>
            <Timer aria-hidden />
            <AlertTitle>حد آمن: {fmtNumber(EVALUATE_LIMIT_MAX)} رموز كحد أقصى لكل ضغطة</AlertTitle>
            <AlertDescription>
              يقبل الخادم حتى 100 رمز، لكن كل رمز يجلب تقرير أسعار كاملًا ويحسب التقييم، فالدفعات الكبيرة قد تتجاوز حد زمن المعالجة (30 ثانية) وتنتهي جزئيًا. المهمة المجدولة تكمل البقية كل 6 ساعات. التشغيل مقفل: إن كان تشغيل آخر قائمًا يُرفض الطلب دون أثر.
            </AlertDescription>
          </Alert>
          <form className="admin-tools-form-row" onSubmit={e => e.preventDefault()}>
            <div className="admin-tools-field">
              <Label htmlFor="ev-limit">عدد الرموز (1–{fmtNumber(EVALUATE_LIMIT_MAX)})</Label>
              <Input id="ev-limit" type="number" inputMode="numeric" min={1} max={EVALUATE_LIMIT_MAX} value={limitText} onChange={e => setLimitText(e.target.value)} onBlur={() => setLimitText(String(limit))} />
            </div>
            <ConfirmAction
              trigger={busy ? 'جارٍ التقييم…' : `تشغيل التقييم (${fmtNumber(limit)})`}
              disabled={busy}
              title="تشغيل دورة تقييم يدوية؟"
              description={<><p>سيُقيَّم حتى {fmtNumber(limit)} رمز تستحق توقعاتها، وتُحفظ النتائج في سجل التقييم ويُحدَّث «آخر تشغيل يدوي».</p><p>لا تُعدَّل التوقعات الأصلية. قد يستغرق ذلك حتى نصف دقيقة.</p></>}
              confirmLabel="نعم، شغّل"
              onConfirm={() => void run()}
            />
          </form>
          <ErrorNotice error={error} />
          {busy && <LoadingBlock lines={4} />}
          {result && <><h4 className="admin-tools-subtitle">نتيجة هذا التشغيل</h4><RunSummary summary={result} /><RawJson value={result} /></>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>آخر تشغيل محفوظ</CardTitle>
          <CardDescription>آخر دورة (مجدولة أو يدوية). المصدر: <Ltr>/api/admin/run-background</Ltr></CardDescription>
          <CardAction><RefreshButton onClick={() => void last.load()} loading={last.loading} /></CardAction>
        </CardHeader>
        <CardContent className="admin-tools-stack">
          <ErrorNotice error={last.error} />
          {last.loading && !last.data && <LoadingBlock lines={4} />}
          {last.data && <><RunSummary summary={last.data.lastRun} /><RawJson value={last.data} /></>}
        </CardContent>
      </Card>
    </div>
  );
}
