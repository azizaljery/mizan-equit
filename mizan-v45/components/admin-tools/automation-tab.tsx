'use client';
import {useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import {CalendarClock, Footprints, Rocket, ScanSearch, ServerCog} from 'lucide-react';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {HORIZONS} from '@/lib/forecast-horizons';
import {AdminToolsError, adminRequest, fmtDateTime, fmtNumber, newRequestKey} from '@/lib/admin-tools-client';
import {ConfirmAction, ErrorNotice, Facts, JobStatus, LoadingBlock, RawJson, RefreshButton, Ltr, toAdminError} from './shared';

const ENDPOINT = '/api/admin/tools/automation';
const horizonName = (h: number) => HORIZONS.find(x => x.sessions === h)?.name ?? `${h} جلسة`;
const MARKET: Record<string, string> = {sa: 'السعودي', us: 'الأمريكي'};

/** One automation action: POST {action,...} with loading/error/data state. */
function useAction<T = any>(action: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<AdminToolsError | null>(null), [loading, setLoading] = useState(false);
  async function run(extra: Record<string, unknown> = {}, notify?: string) {
    setLoading(true); setError(null);
    try {
      const {data: d} = await adminRequest<T>(ENDPOINT, {method: 'POST', json: {action, ...extra}});
      setData(d); if (notify) toast.success(notify); return d;
    } catch (e) {
      const err = toAdminError(e);
      if (err.kind === 'session' && err.status === 401) err.message = 'غير مصرح: سجّل الدخول إلى إدارة ميزان بحساب المالك (جلسة سارية) ثم أعد المحاولة.';
      if (err.status === 503 && /متوقفة/.test(err.message)) err.message = 'المهام الخلفية متوقفة من إعدادات النشر (MIZAN_BACKGROUND_CRON_ENABLED ليست true)؛ إجراءات التشغيل غير متاحة.';
      setError(err); if (notify) toast.error(err.message); return null;
    } finally { setLoading(false); }
  }
  return {data, error, loading, run};
}

function MarketsTable({markets}: {markets: Record<string, any> | null | undefined}) {
  if (!markets) return null;
  return (
    <div className="admin-tools-scroll">
      <Table>
        <TableHeader><TableRow><TableHead>السوق</TableHead><TableHead>الحالة</TableHead><TableHead>المخطط</TableHead><TableHead>المفحوص</TableHead><TableHead>المحلَّل</TableHead><TableHead>الفاشل</TableHead><TableHead>الدفعة التالية</TableHead></TableRow></TableHeader>
        <TableBody>{Object.entries(markets).map(([m, s]) => (
          <TableRow key={m}>
            <TableCell className="font-medium">{MARKET[m] ?? m}</TableCell><TableCell><JobStatus status={s?.state} /></TableCell>
            <TableCell>{fmtNumber(s?.planned)}</TableCell><TableCell>{fmtNumber(s?.scanned)}</TableCell><TableCell>{fmtNumber(s?.analyzed)}</TableCell>
            <TableCell>{fmtNumber(s?.failed)}</TableCell><TableCell>{fmtNumber(s?.nextBatch)}</TableCell>
          </TableRow>))}
        </TableBody>
      </Table>
    </div>
  );
}

function RuntimeCard() {
  const a = useAction<any>('runtime-ready');
  return (
    <Card>
      <CardHeader>
        <CardTitle><ServerCog aria-hidden className="admin-tools-icon" />جاهزية التشغيل الخلفي</CardTitle>
        <CardDescription>هل المهام الخلفية مفعّلة، وأي إصدار منشور.</CardDescription>
        <CardAction><RefreshButton onClick={() => void a.run()} loading={a.loading} label="فحص" /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={a.error} />
        {a.data && <Facts items={[['الحالة', <JobStatus key="s" status={a.data.status} />], ['العامل', <Ltr key="w">{a.data.worker ?? '—'}</Ltr>], ['الإصدار (commit)', <Ltr key="c">{a.data.commit ? String(a.data.commit).slice(0, 12) : 'غير مختوم'}</Ltr>], ['نسخة المتابعة', <Ltr key="f">{a.data.followupVersion}</Ltr>]]} />}
        {!a.data && !a.error && !a.loading && <p className="admin-tools-muted">اضغط «فحص».</p>}
      </CardContent>
    </Card>
  );
}

function summarizeArchive(d: any): string {
  if (!d || typeof d !== 'object') return '—';
  if (typeof d.symbolsAttempted === 'number') return `محاولات ${fmtNumber(d.symbolsAttempted)} · تحليلات ${fmtNumber(d.analysesRecorded)} · صفوف توقع ${fmtNumber(d.forecastRowsSaved)} · متاحة ${fmtNumber(d.availableForecastRows)}`;
  const parts: string[] = [];
  if (d.market) parts.push(`السوق ${MARKET[d.market] ?? d.market}`);
  if (d.date) parts.push(`اليوم ${d.date}`);
  if (Array.isArray(d.symbols)) parts.push(`${fmtNumber(d.symbols.length)} رمز`);
  return parts.join(' · ') || '—';
}

function DailyArchiveCard() {
  const a = useAction<any>('daily-archive-status');
  return (
    <Card>
      <CardHeader>
        <CardTitle><CalendarClock aria-hidden className="admin-tools-icon" />أرشيف التوقعات اليومي</CardTitle>
        <CardDescription>آخر سجلات الأرشيف اليومي (قراءة فقط).</CardDescription>
        <CardAction><RefreshButton onClick={() => void a.run()} loading={a.loading} label="قراءة" /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={a.error} />
        {a.loading && !a.data && <LoadingBlock />}
        {a.data && <>
          <Facts items={[['الإصدار', <Ltr key="v">{a.data.version}</Ltr>], ['الجدولة', <Ltr key="c">{a.data.cron}</Ltr>], ['المستهدف لكل سوق', fmtNumber(a.data.targetPerMarket)], ['الآفاق المطلوبة', (a.data.requiredHorizons ?? []).map(horizonName).join('، ')]]} />
          {a.data.recent?.length ? (
            <div className="admin-tools-scroll">
              <Table>
                <TableHeader><TableRow><TableHead>السجل</TableHead><TableHead>الحالة</TableHead><TableHead>آخر تحديث</TableHead><TableHead>الملخص</TableHead></TableRow></TableHeader>
                <TableBody>{a.data.recent.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell><Ltr>{r.id}</Ltr></TableCell><TableCell><JobStatus status={r.data?.status ?? r.data?.state} /></TableCell>
                    <TableCell>{fmtDateTime(r.updated_at)}</TableCell><TableCell className="admin-tools-wrap">{summarizeArchive(r.data)}</TableCell>
                  </TableRow>))}
                </TableBody>
              </Table>
            </div>
          ) : <p className="admin-tools-muted">لا توجد سجلات أرشيف بعد.</p>}
          <RawJson value={a.data} />
        </>}
        {!a.data && !a.error && !a.loading && <p className="admin-tools-muted">اضغط «قراءة».</p>}
      </CardContent>
    </Card>
  );
}

function OperationsCard() {
  const a = useAction<any>('screener-operations');
  const cfg = a.data?.settings?.config, last = a.data?.lastFollowup;
  return (
    <Card>
      <CardHeader>
        <CardTitle><ScanSearch aria-hidden className="admin-tools-icon" />عمليات متابعة الفرز</CardTitle>
        <CardDescription>آخر الدفعات المختومة وآخر متابعة. لتعديل الإعداد الدوري استخدم <a href="/screener/operations">صفحة عمليات الفرز</a>.</CardDescription>
        <CardAction><RefreshButton onClick={() => void a.run()} loading={a.loading} label="قراءة" /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={a.error} />
        {a.loading && !a.data && <LoadingBlock />}
        {a.data && <>
          {cfg && <Facts items={[['التشغيل الدوري', cfg.enabled ? 'مفعّل' : 'متوقف'], ['كل', `${fmtNumber(cfg.intervalHours)} ساعة`], ['رموز لكل سوق', fmtNumber(cfg.scanPerMarket)], ['عدد النتائج', fmtNumber(cfg.resultCount)], ['الأفق', horizonName(cfg.horizonSessions)], ['آخر حفظ للإعداد', fmtDateTime(a.data.settings?.updatedAt)]]} />}
          {!!a.data.cohortCounts?.length && <p className="admin-tools-muted">الدفعات حسب الحالة: {a.data.cohortCounts.map((c: any) => `${c.status}: ${fmtNumber(c.n)}`).join(' · ')}</p>}
          {last && <p>آخر متابعة: <JobStatus status={last.summary?.status} /> · {fmtDateTime(last.updatedAt)}</p>}
          {!!a.data.recent?.length && (
            <div className="admin-tools-scroll">
              <Table>
                <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>السوق</TableHead><TableHead>الحالة</TableHead><TableHead>المخطط</TableHead><TableHead>المحلَّل</TableHead><TableHead>المختار</TableHead><TableHead>الفاشل</TableHead></TableRow></TableHeader>
                <TableBody>{a.data.recent.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDateTime(r.createdAt)}</TableCell><TableCell>{MARKET[r.market] ?? r.market}</TableCell><TableCell><JobStatus status={r.status} /></TableCell>
                    <TableCell>{fmtNumber(r.planned)}</TableCell><TableCell>{fmtNumber(r.analyzed)}</TableCell><TableCell>{fmtNumber(r.selected)}</TableCell><TableCell>{fmtNumber(r.failed)}</TableCell>
                  </TableRow>))}
                </TableBody>
              </Table>
            </div>
          )}
          {a.data.note && <p className="admin-tools-muted">{a.data.note}</p>}
          <RawJson value={a.data} />
        </>}
        {!a.data && !a.error && !a.loading && <p className="admin-tools-muted">اضغط «قراءة».</p>}
      </CardContent>
    </Card>
  );
}

function AcceptanceCard() {
  const status = useAction<any>('followup-acceptance-status');
  const start = useAction<any>('followup-acceptance-start');
  const [cfg, setCfg] = useState({intervalHours: 24, scanPerMarket: 20, resultCount: 10, horizonSessions: 5});
  const acc = start.data?.acceptance ?? status.data?.acceptance;
  const sel = (k: keyof typeof cfg, v: string) => setCfg(c => ({...c, [k]: Number(v)}));
  return (
    <Card>
      <CardHeader>
        <CardTitle><Rocket aria-hidden className="admin-tools-icon" />تجربة قبول المتابعة الكاملة</CardTitle>
        <CardDescription>تُسجَّل تجربة يُكملها المجدول كل 5 دقائق على دفعات قصيرة؛ عند نجاح السوقين بنفس الإعداد يُفعَّل التشغيل الدوري تلقائيًا.</CardDescription>
        <CardAction><RefreshButton onClick={() => void status.run()} loading={status.loading} label="الحالة" /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={status.error} />
        {acc ? <>
          <Facts items={[['الحالة', <JobStatus key="s" status={acc.state} />], ['طُلبت', fmtDateTime(acc.requestedAt)], ['آخر تحديث', fmtDateTime(acc.updatedAt)], ['الإصدار', <Ltr key="r">{String(acc.release ?? '').slice(0, 12) || '—'}</Ltr>],
            ['رموز لكل سوق', fmtNumber(acc.config?.scanPerMarket)], ['الأفق', acc.config ? horizonName(acc.config.horizonSessions) : '—'], ...(acc.error ? [['الخطأ', <Ltr key="e">{acc.error}</Ltr>] as [string, ReactNode]] : [])]} />
          <MarketsTable markets={acc.progress?.markets} />
          {acc.reused && <p className="admin-tools-muted">تجربة مماثلة قائمة بالفعل؛ لم تُنشأ تجربة جديدة.</p>}
          <RawJson value={acc} />
        </> : status.data && <p className="admin-tools-muted">لا توجد تجربة قبول مسجلة.</p>}
        <fieldset className="admin-tools-fieldset">
          <legend>بدء تجربة جديدة (التشغيل الدوري يبقى متوقفًا حتى تنجح)</legend>
          <div className="admin-tools-form-row">
            <div className="admin-tools-field"><Label htmlFor="acc-int">الفاصل</Label>
              <NativeSelect id="acc-int" value={cfg.intervalHours} onChange={e => sel('intervalHours', e.target.value)}>{[6, 24, 168].map(v => <NativeSelectOption key={v} value={v}>{v === 168 ? 'أسبوعي' : `كل ${v} ساعة`}</NativeSelectOption>)}</NativeSelect></div>
            <div className="admin-tools-field"><Label htmlFor="acc-scan">رموز لكل سوق</Label>
              <NativeSelect id="acc-scan" value={cfg.scanPerMarket} onChange={e => sel('scanPerMarket', e.target.value)}>{[20, 40, 100, 200].map(v => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}</NativeSelect></div>
            <div className="admin-tools-field"><Label htmlFor="acc-res">عدد النتائج</Label>
              <NativeSelect id="acc-res" value={cfg.resultCount} onChange={e => sel('resultCount', e.target.value)}>{[5, 6, 7, 8, 9, 10].map(v => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}</NativeSelect></div>
            <div className="admin-tools-field"><Label htmlFor="acc-h">الأفق</Label>
              <NativeSelect id="acc-h" value={cfg.horizonSessions} onChange={e => sel('horizonSessions', e.target.value)}>{HORIZONS.map(h => <NativeSelectOption key={h.sessions} value={h.sessions}>{h.name}</NativeSelectOption>)}</NativeSelect></div>
          </div>
          <div className="admin-tools-actions">
            <ConfirmAction
              trigger={start.loading ? 'جارٍ التسجيل…' : 'بدء تجربة القبول'}
              disabled={start.loading}
              title="بدء تجربة قبول المتابعة؟"
              description={<><p>ستُسجَّل تجربة بـ{fmtNumber(cfg.scanPerMarket)} رمز لكل سوق. لا يُشغَّل شيء الآن؛ المجدول يتقدم بها على دفعات صغيرة كل 5 دقائق.</p><p>إذا نجح السوقان بالإعداد نفسه يُفعَّل التشغيل الدوري بهذا الإعداد. تتطلب نشرًا مختومًا بمعرف إصدار، وتُلغى التجربة إن تجاوزت 72 ساعة.</p></>}
              confirmLabel="نعم، ابدأ"
              onConfirm={() => void start.run({config: cfg}, 'سُجّلت تجربة القبول.')}
            />
          </div>
        </fieldset>
        <ErrorNotice error={start.error} />
      </CardContent>
    </Card>
  );
}

function StepCard() {
  const a = useAction<any>('followup-step');
  const [key, setKey] = useState<string | null>(null);
  async function step(fresh: boolean) {
    const requestKey = fresh || !key ? newRequestKey('owner-ui') : key;
    setKey(requestKey);
    await a.run({requestKey}, 'انتهت الخطوة.');
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle><Footprints aria-hidden className="admin-tools-icon" />تشغيل خطوة متابعة يدوية</CardTitle>
        <CardDescription>خطوة قصيرة (دفعتان كحد أقصى) بالإعداد المحفوظ، قابلة للاستئناف بنفس المعرف. التشغيل الكامل الطويل غير متاح من الواجهة.</CardDescription>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <Alert><AlertTitle>لماذا خطوة وليست تشغيلًا كاملًا؟</AlertTitle><AlertDescription>التشغيل الكامل قد يمتد دقائق ويتجاوز حد المعالجة. الخطوة تحفظ تقدمها، ويمكنك متابعة الدورة نفسها بضغطات متتالية.</AlertDescription></Alert>
        <div className="admin-tools-actions">
          <ConfirmAction
            trigger={a.loading ? 'جارٍ…' : 'بدء دورة يدوية جديدة'}
            disabled={a.loading}
            title="بدء دورة متابعة يدوية؟"
            description={<p>ستُنشأ دفعات فرز جديدة وتُحلَّل أول دفعتين بالإعداد المحفوظ. تُحفظ النتائج كآخر متابعة يدوية.</p>}
            confirmLabel="نعم، ابدأ"
            onConfirm={() => void step(true)}
          />
          <Button variant="outline" disabled={a.loading || !key || a.data?.status === 'completed'} onClick={() => void step(false)}>متابعة نفس الدورة</Button>
        </div>
        {key && <p className="admin-tools-muted">معرف الدورة: <Ltr>{key}</Ltr></p>}
        <ErrorNotice error={a.error} />
        {a.loading && <LoadingBlock />}
        {a.data && <>
          <Facts items={[['الحالة', <JobStatus key="s" status={a.data.status} />], ['بدأت', fmtDateTime(a.data.startedAt)], ['آخر تحديث', fmtDateTime(a.data.updatedAt)], ['انتهت', fmtDateTime(a.data.finishedAt)], ['تأكيد الحفظ', a.data.stateSaved ? 'محفوظ' : 'غير مؤكد'], ['السوق التالي', MARKET[a.data.nextMarket] ?? '—']]} />
          <MarketsTable markets={a.data.markets} />
          <RawJson value={a.data} />
        </>}
      </CardContent>
    </Card>
  );
}

export function AutomationTab() {
  return (
    <div className="admin-tools-grid">
      <RuntimeCard />
      <DailyArchiveCard />
      <OperationsCard />
      <AcceptanceCard />
      <StepCard />
    </div>
  );
}
