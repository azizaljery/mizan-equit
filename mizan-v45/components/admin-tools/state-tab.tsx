'use client';
import {useState} from 'react';
import {Activity, Archive, Database, ShieldCheck} from 'lucide-react';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {adminRequest, fmtDateTime, fmtDuration, fmtNumber} from '@/lib/admin-tools-client';
import {ErrorNotice, Facts, JobStatus, LoadingBlock, RawJson, RefreshButton, Ltr, toAdminError, useAdminResource} from './shared';
import type {AdminToolsError} from '@/lib/admin-tools-client';

const CHECK_NAMES: Record<string, string> = {
  cron: 'التشغيل المجدول (Cron)', manual: 'آخر تشغيل يدوي', heartbeat: 'نبضة المهمة', forecasts: 'التوقعات المحفوظة', idempotency: 'عدم التكرار',
};

function VerifyCard() {
  const r = useAdminResource<any>('/api/admin/verify', true);
  const checks = r.data?.checks ? Object.entries(r.data.checks as Record<string, any>) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle><ShieldCheck aria-hidden className="admin-tools-icon" />التحقق من حالة الإنتاج</CardTitle>
        <CardDescription>قراءة فقط؛ لا تشغّل مهامًا. المصدر: <Ltr>/api/admin/verify</Ltr></CardDescription>
        <CardAction><RefreshButton onClick={() => void r.load()} loading={r.loading} /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={r.error} />
        {r.loading && !r.data && <LoadingBlock lines={5} />}
        {r.data && <>
          <Facts items={[
            ['الحكم العام', <JobStatus key="o" status={r.data.overall === 'fail' ? 'failed' : 'partial'} />],
            ['وقت القراءة', fmtDateTime(r.data.timestamp)],
          ]} />
          <Table>
            <TableHeader><TableRow><TableHead>الفحص</TableHead><TableHead>الحالة</TableHead><TableHead>التفاصيل</TableHead></TableRow></TableHeader>
            <TableBody>
              {checks.map(([key, c]) => (
                <TableRow key={key}>
                  <TableCell className="font-medium">{CHECK_NAMES[key] ?? key}</TableCell>
                  <TableCell><JobStatus status={c.status ?? (c.ok ? 'ok' : 'partial')} ok={c.ok} /></TableCell>
                  <TableCell className="admin-tools-wrap">
                    <div>{c.label}</div>
                    <small className="admin-tools-muted">{c.details}{typeof c.ageMinutes === 'number' ? ` · قبل ${fmtNumber(c.ageMinutes)} دقيقة` : ''}</small>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="admin-tools-muted">{r.data.scope}</p>
          <RawJson value={r.data} />
        </>}
      </CardContent>
    </Card>
  );
}

function HeartbeatRow({name, read}: {name: string; read: any}) {
  const rec = read?.record, ev = rec?.evaluation;
  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell><JobStatus status={read?.status === 'ok' ? (ev?.state ?? 'ok') : read?.status} /></TableCell>
      <TableCell>{fmtDateTime(read?.updatedAt ?? rec?.at)}</TableCell>
      <TableCell className="admin-tools-wrap">
        {ev ? `فُحص ${fmtNumber(ev.symbolsScanned)} · قُيّم ${fmtNumber(ev.symbolsResolved)} · حُفظ ${fmtNumber(ev.evaluationsSaved)} · فشل ${fmtNumber(ev.symbolsFailed)} · ${fmtDuration(ev.durationMs)}`
          : rec?.error ? rec.error : rec ? (rec.enabled ? 'المهام مفعلة' : 'المهام متوقفة من الإعدادات') : '—'}
      </TableCell>
    </TableRow>
  );
}

function HeartbeatCard() {
  const r = useAdminResource<any>('/api/admin/heartbeat', true);
  return (
    <Card>
      <CardHeader>
        <CardTitle><Activity aria-hidden className="admin-tools-icon" />نبضات المهام المجدولة</CardTitle>
        <CardDescription>آخر وصول للمهمة وآخر تقييم وآخر فشل حفظ. المصدر: <Ltr>/api/admin/heartbeat</Ltr></CardDescription>
        <CardAction><RefreshButton onClick={() => void r.load()} loading={r.loading} /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={r.error} />
        {r.loading && !r.data && <LoadingBlock />}
        {r.data && <>
          <Table>
            <TableHeader><TableRow><TableHead>النبضة</TableHead><TableHead>الحالة</TableHead><TableHead>الوقت</TableHead><TableHead>الملخص</TableHead></TableRow></TableHeader>
            <TableBody>
              <HeartbeatRow name="وصول المهمة" read={r.data.arrival} />
              <HeartbeatRow name="التقييم" read={r.data.evaluation} />
              <HeartbeatRow name="فشل الحفظ" read={r.data.saveFailure} />
            </TableBody>
          </Table>
          <RawJson value={r.data} />
        </>}
      </CardContent>
    </Card>
  );
}

function RetentionCard() {
  const [days, setDays] = useState('90'), [keep, setKeep] = useState('50');
  const [data, setData] = useState<any>(null), [error, setError] = useState<AdminToolsError | null>(null), [loading, setLoading] = useState(false);
  const daysN = Number(days), keepN = Number(keep);
  const valid = Number.isInteger(daysN) && daysN >= 7 && daysN <= 3650 && Number.isInteger(keepN) && keepN >= 10 && keepN <= 10000;
  async function load() {
    if (!valid) return;
    setLoading(true); setError(null);
    try { setData((await adminRequest(`/api/admin/retention?days=${daysN}&keep=${keepN}`)).data); }
    catch (e) { setError(toAdminError(e)); } finally { setLoading(false); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle><Archive aria-hidden className="admin-tools-icon" />معاينة الاحتفاظ بالسجلات</CardTitle>
        <CardDescription>معاينة فقط — لا يُحذف أي سجل. المصدر: <Ltr>/api/admin/retention</Ltr></CardDescription>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <form className="admin-tools-form-row" onSubmit={e => { e.preventDefault(); void load(); }}>
          <div className="admin-tools-field">
            <Label htmlFor="ret-days">أيام الاحتفاظ بالنتائج (7–3650)</Label>
            <Input id="ret-days" type="number" inputMode="numeric" min={7} max={3650} value={days} onChange={e => setDays(e.target.value)} aria-invalid={!valid} />
          </div>
          <div className="admin-tools-field">
            <Label htmlFor="ret-keep">عدد تقارير الاختبار المحفوظة (10–10000)</Label>
            <Input id="ret-keep" type="number" inputMode="numeric" min={10} max={10000} value={keep} onChange={e => setKeep(e.target.value)} aria-invalid={!valid} />
          </div>
          <Button type="submit" variant="outline" disabled={!valid || loading}>{loading ? 'جارٍ المعاينة…' : 'معاينة'}</Button>
        </form>
        {!valid && <p className="admin-tools-muted" role="status">القيم خارج الحدود المسموحة.</p>}
        <ErrorNotice error={error} />
        {data && <>
          <Facts items={[['تاريخ القطع', <Ltr key="c">{data.cutoffDate}</Ltr>], ['أيام الاحتفاظ', fmtNumber(data.retentionDays)], ['تقارير تبقى', fmtNumber(data.keepRuns)], ['وقت المعاينة', fmtDateTime(data.generatedAt)]]} />
          <Table>
            <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الإجمالي</TableHead><TableHead>مرشحة للحذف</TableHead><TableHead>JSON تالف</TableHead><TableHead>الأقدم</TableHead><TableHead>الأحدث</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>نتائج التقييم القديمة</TableCell><TableCell>—</TableCell><TableCell>{fmtNumber(data.outcomes?.totalCandidates)}</TableCell><TableCell>{fmtNumber(data.outcomes?.invalidJson)}</TableCell><TableCell>{fmtDateTime(data.outcomes?.oldest)}</TableCell><TableCell>{fmtDateTime(data.outcomes?.newest)}</TableCell></TableRow>
              <TableRow><TableCell>تقارير الاختبار التاريخي</TableCell><TableCell>{fmtNumber(data.backtests?.totalRuns)}</TableCell><TableCell>{fmtNumber(data.backtests?.totalCandidates)}</TableCell><TableCell>{fmtNumber(data.backtests?.invalidJson)}</TableCell><TableCell>{fmtDateTime(data.backtests?.oldest)}</TableCell><TableCell>{fmtDateTime(data.backtests?.newest)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <RawJson value={data} />
        </>}
      </CardContent>
    </Card>
  );
}

function StateCard() {
  const LIMIT = 20;
  const [offset, setOffset] = useState(0);
  const r = useAdminResource<any>(`/api/admin/state?mode=list&offset=${offset}&limit=${LIMIT}`, true);
  const [slice, setSlice] = useState<any>(null), [sliceError, setSliceError] = useState<AdminToolsError | null>(null), [sliceBusy, setSliceBusy] = useState('');
  async function open(id: string) {
    setSliceBusy(id); setSliceError(null);
    try { setSlice((await adminRequest(`/api/admin/state?mode=slices&id=${encodeURIComponent(id)}&offset=0&length=4000`)).data); }
    catch (e) { setSliceError(toAdminError(e)); } finally { setSliceBusy(''); }
  }
  let pretty = '';
  if (slice) { try { pretty = slice.hasMore ? slice.slice : JSON.stringify(JSON.parse(slice.slice), null, 2); } catch { pretty = slice.slice; } }
  return (
    <Card>
      <CardHeader>
        <CardTitle><Database aria-hidden className="admin-tools-icon" />حالة المهام (research_state)</CardTitle>
        <CardDescription>أحدث السجلات أولًا، مع الحجم. المصدر: <Ltr>/api/admin/state</Ltr></CardDescription>
        <CardAction><RefreshButton onClick={() => void r.load()} loading={r.loading} /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={r.error} />
        {r.loading && !r.data && <LoadingBlock lines={6} />}
        {r.data && <>
          <p className="admin-tools-muted">إجمالي السجلات: {fmtNumber(r.data.total)} · المعروض {fmtNumber(offset + 1)}–{fmtNumber(offset + (r.data.rows?.length ?? 0))}</p>
          <div className="admin-tools-scroll">
            <Table>
              <TableHeader><TableRow><TableHead>المعرف</TableHead><TableHead>آخر تحديث</TableHead><TableHead>الحجم (بايت)</TableHead><TableHead><span className="sr-only">عرض</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {(r.data.rows ?? []).map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell><Ltr>{row.id}</Ltr></TableCell>
                    <TableCell>{fmtDateTime(row.updated_at)}</TableCell>
                    <TableCell>{fmtNumber(row.size)}</TableCell>
                    <TableCell><Button size="xs" variant="ghost" disabled={!!sliceBusy} onClick={() => void open(row.id)} aria-label={`عرض محتوى ${row.id}`}>{sliceBusy === row.id ? '…' : 'عرض'}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="admin-tools-actions">
            <Button variant="outline" size="sm" disabled={offset === 0 || r.loading} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>السابق</Button>
            <Button variant="outline" size="sm" disabled={!r.data.hasMore || r.loading} onClick={() => setOffset(offset + LIMIT)}>التالي</Button>
          </div>
        </>}
        <ErrorNotice error={sliceError} />
        {slice && (
          <div className="admin-tools-stack">
            <p className="admin-tools-muted">السجل <Ltr>{slice.id}</Ltr> · {fmtNumber(slice.size)} بايت{slice.hasMore ? ' · يُعرض أول 4000 حرف فقط' : ''}</p>
            <pre dir="ltr" className="admin-tools-pre">{pretty}</pre>
            <Button variant="ghost" size="sm" onClick={() => setSlice(null)}>إغلاق المعاينة</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StateTab() {
  return (
    <div className="admin-tools-grid">
      <VerifyCard />
      <HeartbeatCard />
      <StateCard />
      <RetentionCard />
    </div>
  );
}
