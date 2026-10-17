'use client';
import {useState} from 'react';
import {toast} from 'sonner';
import {Users} from 'lucide-react';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {AdminToolsError, adminRequest, fmtDateTime, fmtDuration, fmtNumber} from '@/lib/admin-tools-client';
import {ConfirmAction, ErrorNotice, Facts, JobStatus, LoadingBlock, RawJson, RefreshButton, StatusBadge, Ltr, toAdminError, useAdminResource} from './shared';

const ROLE_NAMES: Record<string, string> = {'rd-manager': 'مدير البحث والتطوير', developer: 'المطوّر', 'security-reviewer': 'المراجع الأمني'};
const TASK_MAX = 6000;
const DEFAULT_TASK = 'راجع جاهزية منظومة ميزان وجودة بيانات السوقين وسلامة مسار التوقع والقياس، ثم أعد تقريرًا للمالك دون أي إجراء تلقائي.';

function AgentsTable({agents}: {agents: Record<string, any> | null | undefined}) {
  const rows = agents ? Object.values(agents) : [];
  if (!rows.length) return null;
  return (
    <div className="admin-tools-scroll">
      <Table>
        <TableHeader><TableRow><TableHead>الدور</TableHead><TableHead>النموذج</TableHead><TableHead>النتيجة</TableHead><TableHead>التشخيص</TableHead><TableHead>المدة</TableHead><TableHead>طول التقرير</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((a: any) => (
          <TableRow key={a.role}>
            <TableCell className="font-medium">{ROLE_NAMES[a.role] ?? a.role}</TableCell>
            <TableCell><Ltr>{a.provider}/{a.model}</Ltr></TableCell>
            <TableCell><JobStatus status={a.taskCompleted ? 'completed' : 'failed'} /></TableCell>
            <TableCell><Ltr>{a.diagnostic?.code ?? '—'}</Ltr>{a.diagnostic?.httpStatus ? ` (${a.diagnostic.httpStatus})` : ''}</TableCell>
            <TableCell>{fmtDuration(a.diagnostic?.durationMs)}</TableCell>
            <TableCell>{fmtNumber(a.outputCharacters)} حرف</TableCell>
          </TableRow>))}
        </TableBody>
      </Table>
    </div>
  );
}

function CouncilSummary({s}: {s: any}) {
  if (!s) return <p className="admin-tools-muted">لم تُسجّل دورة للمجلس بعد.</p>;
  return (
    <div className="admin-tools-stack">
      <Facts items={[
        ['الحالة', <JobStatus key="s" status={s.status} />],
        ['التنفيذ', <JobStatus key="e" status={s.executionStatus} />],
        ['قرار المراجع الأمني', <JobStatus key="d" status={s.securityDecision ?? s.securityReviewer?.decision?.decision} />],
        ['البداية', fmtDateTime(s.createdAt)],
        ['آخر تحديث', fmtDateTime(s.updatedAt)],
        ['المعرف', s.id ? <Ltr key="i">{String(s.id).slice(0, 24)}…</Ltr> : '—'],
      ]} />
      {!!s.blockers?.length && <Alert><AlertTitle>عوائق</AlertTitle><AlertDescription><ul>{s.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></AlertDescription></Alert>}
      <AgentsTable agents={s.agents} />
      {s.error && <p className="admin-tools-invalid">{s.error}</p>}
    </div>
  );
}

export function CouncilTab() {
  const status = useAdminResource<any>('/api/admin/council', true);
  const [task, setTask] = useState(DEFAULT_TASK);
  const [busy, setBusy] = useState(false), [error, setError] = useState<AdminToolsError | null>(null), [result, setResult] = useState<any>(null);
  const trimmed = task.trim(), valid = trimmed.length > 0 && trimmed.length <= TASK_MAX;
  async function run() {
    if (!valid) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const {data} = await adminRequest('/api/admin/council', {method: 'POST', json: {task: trimmed}});
      setResult(data);
      if (data.status === 'locked') toast.warning('دورة أخرى للمجلس قائمة؛ لم تبدأ دورة جديدة.');
      else toast.success('انتهت دورة المجلس؛ القرار للمالك.');
      void status.load();
    } catch (e) { const err = toAdminError(e); setError(err); toast.error(err.message); }
    finally { setBusy(false); }
  }
  const providers = status.data?.providers as Record<string, boolean> | undefined;
  const active: string[] = status.data?.providerPolicy?.activeProviders ?? [];
  return (
    <div className="admin-tools-grid">
      <Card>
        <CardHeader>
          <CardTitle><Users aria-hidden className="admin-tools-icon" />حالة مجلس الوكلاء</CardTitle>
          <CardDescription>يعمل المجلس دوريًا بالجدولة؛ هنا آخر دورة وإعداد المزودين. المصدر: <Ltr>/api/admin/council</Ltr></CardDescription>
          <CardAction><RefreshButton onClick={() => void status.load()} loading={status.loading} /></CardAction>
        </CardHeader>
        <CardContent className="admin-tools-stack">
          <ErrorNotice error={status.error} />
          {status.loading && !status.data && <LoadingBlock lines={4} />}
          {status.data && <>
            <Facts items={[
              ['الإصدار', <Ltr key="v">{status.data.version}</Ltr>],
              ['الوضع', <Ltr key="m">{status.data.providerPolicy?.mode ?? '—'}</Ltr>],
              ['أقصى استدعاءات لكل دورة', fmtNumber(status.data.providerPolicy?.maximumProviderCallsPerRun)],
            ]} />
            {providers && (
              <div className="admin-tools-actions" aria-label="مفاتيح المزودين">
                {Object.entries(providers).map(([p, ok]) => (
                  <StatusBadge key={p} tone={active.includes(p) ? (ok ? 'ok' : 'bad') : 'neutral'}>
                    <Ltr>{p}</Ltr>: {active.includes(p) ? (ok ? 'المفتاح مضبوط' : 'المفتاح مفقود') : 'غير مستخدم'}
                  </StatusBadge>
                ))}
              </div>
            )}
            {status.data.providerPolicy?.note && <p className="admin-tools-muted">{status.data.providerPolicy.note}</p>}
            <h4 className="admin-tools-subtitle">آخر دورة</h4>
            <CouncilSummary s={status.data.latest} />
            <RawJson value={status.data} />
          </>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>تشغيل دورة يدوية</CardTitle>
          <CardDescription>ثلاثة استدعاءات لنموذج لغوي (بحث، تطوير، مراجعة أمنية). الوكلاء يقترحون فقط؛ لا دمج ولا نشر ولا حذف.</CardDescription>
        </CardHeader>
        <CardContent className="admin-tools-stack">
          <div className="admin-tools-field">
            <Label htmlFor="council-task">المهمة المطلوبة من المجلس</Label>
            <Textarea id="council-task" value={task} maxLength={TASK_MAX} rows={5} onChange={e => setTask(e.target.value)} aria-describedby="council-task-count" aria-invalid={!valid} />
            <small id="council-task-count" className="admin-tools-muted">{fmtNumber(trimmed.length)} / {fmtNumber(TASK_MAX)} حرف</small>
          </div>
          <div className="admin-tools-actions">
            <ConfirmAction
              trigger={busy ? 'جارٍ تشغيل المجلس… قد يستغرق دقائق' : 'تشغيل المجلس'}
              disabled={busy || !valid}
              title="تشغيل دورة لمجلس الوكلاء؟"
              description={<><p>ستُرسل لقطة من بيانات ميزان التشغيلية مع المهمة إلى مزود النموذج في 3 استدعاءات مدفوعة التكلفة.</p><p>تُحفظ الدورة في <Ltr>council_runs</Ltr>. لا يُنفَّذ أي إجراء تلقائي؛ القرار لك. إن كانت دورة أخرى قائمة فلن تبدأ دورة جديدة.</p></>}
              confirmLabel="نعم، شغّل المجلس"
              onConfirm={() => void run()}
            />
          </div>
          <ErrorNotice error={error} />
          {busy && <LoadingBlock lines={4} />}
          {result && <>
            <CouncilSummary s={result} />
            {(result.rdManager?.text || result.developer?.text || result.securityReviewer?.decision?.report) && (
              <details className="admin-tools-details">
                <summary>تقارير الوكلاء</summary>
                {result.rdManager?.text && <><h5>مدير البحث والتطوير</h5><pre className="admin-tools-pre">{result.rdManager.text}</pre></>}
                {result.developer?.text && <><h5>المطوّر</h5><pre className="admin-tools-pre">{result.developer.text}</pre></>}
                {result.securityReviewer?.decision?.report && <><h5>المراجع الأمني</h5><pre className="admin-tools-pre">{result.securityReviewer.decision.report}</pre></>}
              </details>
            )}
            <RawJson value={result} />
          </>}
        </CardContent>
      </Card>
    </div>
  );
}
