'use client';
import {useState} from 'react';
import {toast} from 'sonner';
import {Download, FlaskConical, History, Sigma, Zap} from 'lucide-react';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Checkbox} from '@/components/ui/checkbox';
import {NativeSelect, NativeSelectOption} from '@/components/ui/native-select';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {HORIZONS} from '@/lib/forecast-horizons';
import {
  AGGREGATE_LIMIT_MAX, BACKTEST_HORIZONS, BACKTEST_MAX_SYMBOLS, DEFAULT_BACKTEST_HORIZONS, WALK_FORWARD_MAX_WINDOWS,
  adminDownload, adminRequest, fmtDateTime, fmtNumber, fmtPercent, parseSymbols, validAuditSymbol, validDay,
  validateBacktestForm, validateWalkForward, type AdminToolsError, type BacktestForm, type WalkWindow,
} from '@/lib/admin-tools-client';
import {ErrorNotice, Facts, LoadingBlock, Ltr, RawJson, RefreshButton, toAdminError, useAdminResource} from './shared';

const horizonName = (h: number) => HORIZONS.find(x => x.sessions === h)?.name ?? `${h} جلسة`;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);

function HorizonTable({rows}: {rows: any[]}) {
  if (!rows?.length) return <p className="admin-tools-muted">لا توجد آفاق في النتيجة.</p>;
  return (
    <div className="admin-tools-scroll">
      <Table>
        <TableHeader><TableRow>
          <TableHead>الأفق</TableHead><TableHead>الإجمالي</TableHead><TableHead>مكتمل</TableHead><TableHead>مستبعد</TableHead><TableHead>معلّق</TableHead>
          <TableHead>صحة الاتجاه</TableHead><TableHead>داخل النطاق</TableHead><TableHead>متوسط الخطأ النسبي</TableHead><TableHead>متوسط العائد</TableHead><TableHead>Sharpe</TableHead><TableHead>Alpha</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map(h => (
            <TableRow key={h.horizon}>
              <TableCell className="font-medium">{horizonName(h.horizon)}</TableCell>
              <TableCell>{fmtNumber(h.total)}</TableCell><TableCell>{fmtNumber(h.completed)}</TableCell><TableCell>{fmtNumber(h.excluded)}</TableCell><TableCell>{fmtNumber(h.pending)}</TableCell>
              <TableCell>{fmtPercent(h.directionAccuracy)} <small className="admin-tools-muted">(ن={fmtNumber(h.directionCount)})</small></TableCell>
              <TableCell>{fmtPercent(h.rangeHitRate)} <small className="admin-tools-muted">(ن={fmtNumber(h.rangeCount)})</small></TableCell>
              <TableCell>{fmtPercent(h.meanRelativeErrorPct, false)}</TableCell>
              <TableCell>{fmtPercent(h.meanReturn)}</TableCell>
              <TableCell>{fmtNumber(h.sharpe)}</TableCell>
              <TableCell>{fmtPercent(h.alpha)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function download(runId: string, format: 'csv' | 'tsv') {
  try { await adminDownload(`/api/admin/backtest/export?runId=${encodeURIComponent(runId)}&format=${format}`, `mizan-${runId}.${format}`); toast.success('بدأ التنزيل.'); }
  catch (e) { toast.error(toAdminError(e).message); }
}

function AuditResult({data}: {data: any}) {
  const windows: any[] | undefined = data.windows;
  const byHorizon = windows ? data.aggregate?.byHorizon : data.byHorizon;
  return (
    <div className="admin-tools-stack" aria-live="polite">
      <Facts items={[
        ['المعرف', <Ltr key="id">{data.runId}</Ltr>],
        ['الحالة', data.reused ? 'تقرير محفوظ سابقًا بنفس المعرف (لم يُعد التشغيل)' : 'تشغيل جديد محفوظ'],
        ['الاكتمال', fmtDateTime(data.completedAt)],
        ...(windows ? [['النوافذ', fmtNumber(windows.length)] as [string, string]] : [['رموز ناجحة', `${fmtNumber(data.symbolsSucceeded)} من ${fmtNumber(data.config?.symbols?.length)}`] as [string, string]]),
      ]} />
      <HorizonTable rows={byHorizon ?? []} />
      {!!data.symbolsFailed?.length && (
        <Alert variant="destructive"><AlertDescription>
          <ul>{data.symbolsFailed.map((f: any) => <li key={f.symbol}><Ltr>{f.symbol}</Ltr>: {f.reason}</li>)}</ul>
        </AlertDescription></Alert>
      )}
      <div className="admin-tools-actions">
        {windows
          ? windows.map((w: any, i: number) => <Button key={i} size="sm" variant="outline" onClick={() => void download(w.result.runId, 'csv')}><Download aria-hidden />CSV للنافذة {fmtNumber(i + 1)}</Button>)
          : <>
            <Button size="sm" variant="outline" onClick={() => void download(data.runId, 'csv')}><Download aria-hidden />تنزيل CSV</Button>
            <Button size="sm" variant="ghost" onClick={() => void download(data.runId, 'tsv')}>TSV</Button>
          </>}
      </div>
      {data.note && <p className="admin-tools-muted">{data.note}</p>}
      {!!data.limitations?.length && <details className="admin-tools-details"><summary>حدود هذا الاختبار</summary><ul>{data.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></details>}
      <RawJson value={data} />
    </div>
  );
}

function AuditCard({onSaved}: {onSaved: () => void}) {
  const [mode, setMode] = useState<'single' | 'walk-forward'>('single');
  const [form, setForm] = useState<BacktestForm>({
    symbols: 'AAPL', startDate: isoDay(-365), endDate: isoDay(-1), horizons: [...DEFAULT_BACKTEST_HORIZONS],
    commissionBps: 5, slippageBps: 10, doubleSided: true, minSessions: 200, runId: '',
  });
  const [windows, setWindows] = useState<WalkWindow[]>([{trainStart: isoDay(-730), trainEnd: isoDay(-366), testStart: isoDay(-365), testEnd: isoDay(-1)}]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<AdminToolsError | null>(null), [data, setData] = useState<any>(null);
  const check = mode === 'single' ? validateBacktestForm(form) : validateWalkForward(form, windows);
  const set = <K extends keyof BacktestForm>(k: K, v: BacktestForm[K]) => setForm(f => ({...f, [k]: v}));
  const setWindow = (i: number, k: keyof WalkWindow, v: string) => setWindows(ws => ws.map((w, j) => j === i ? {...w, [k]: v} : w));
  async function run() {
    if (!check.ok) return;
    setBusy(true); setError(null);
    try {
      const {data: d} = await adminRequest('/api/admin/backtest', {method: 'POST', json: check.value});
      setData(d); onSaved();
      toast.success(d.reused ? 'أعيد التقرير المحفوظ بنفس المعرف.' : 'اكتمل الاختبار وحُفظ تقريره.');
    } catch (e) { const err = toAdminError(e); setError(err); toast.error(err.message); }
    finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle><FlaskConical aria-hidden className="admin-tools-icon" />تدقيق التوقعات المحفوظة</CardTitle>
        <CardDescription>يقيس التوقعات التي أصدرها ميزان فعلًا داخل فترة سابقة ويحفظ التقرير في <Ltr>backtest_runs</Ltr>. المصدر: <Ltr>/api/admin/backtest</Ltr></CardDescription>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <Alert><AlertDescription>
          حد هذه الواجهة: {fmtNumber(BACKTEST_MAX_SYMBOLS)} رمز للتدقيق العادي، ورمز واحد و{fmtNumber(WALK_FORWARD_MAX_WINDOWS)} نافذتان كحد أقصى للنوافذ المتتابعة — كل رمز ونافذة يجلب تقريرًا كاملًا من المصدر، والحدود تبقي الطلب داخل زمن المعالجة المسموح للخادم.
        </AlertDescription></Alert>
        <form className="admin-tools-stack" onSubmit={e => { e.preventDefault(); void run(); }} noValidate>
          <div className="admin-tools-form-row">
            <div className="admin-tools-field">
              <Label htmlFor="bt-mode">نوع الاختبار</Label>
              <NativeSelect id="bt-mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                <NativeSelectOption value="single">فترة واحدة</NativeSelectOption>
                <NativeSelectOption value="walk-forward">نوافذ متتابعة (walk-forward)</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="admin-tools-field">
              <Label htmlFor="bt-symbols">الرموز (مفصولة بمسافة أو فاصلة)</Label>
              <Input id="bt-symbols" dir="ltr" value={form.symbols} onChange={e => set('symbols', e.target.value)} placeholder="AAPL 2222.SR" aria-describedby="bt-symbols-help" />
              <small id="bt-symbols-help" className="admin-tools-muted">أمريكي مثل AAPL أو سعودي مثل 2222.SR. {parseSymbols(form.symbols).filter(s => !validAuditSymbol(s)).length ? 'يوجد رمز غير صالح.' : ''}</small>
            </div>
            {mode === 'single' && <>
              <div className="admin-tools-field"><Label htmlFor="bt-start">من</Label><Input id="bt-start" type="date" dir="ltr" value={form.startDate} onChange={e => set('startDate', e.target.value)} aria-invalid={!validDay(form.startDate)} /></div>
              <div className="admin-tools-field"><Label htmlFor="bt-end">إلى (قبل اليوم)</Label><Input id="bt-end" type="date" dir="ltr" value={form.endDate} max={isoDay(-1)} onChange={e => set('endDate', e.target.value)} aria-invalid={!validDay(form.endDate)} /></div>
            </>}
          </div>
          {mode === 'walk-forward' && (
            <fieldset className="admin-tools-fieldset">
              <legend>النوافذ (التدريب يسبق الاختبار؛ نوافذ الاختبار مرتبة دون تداخل)</legend>
              {windows.map((w, i) => (
                <div key={i} className="admin-tools-form-row">
                  {(['trainStart', 'trainEnd', 'testStart', 'testEnd'] as const).map(k => (
                    <div key={k} className="admin-tools-field">
                      <Label htmlFor={`wf-${i}-${k}`}>{{trainStart: 'بداية التدريب', trainEnd: 'نهاية التدريب', testStart: 'بداية الاختبار', testEnd: 'نهاية الاختبار'}[k]} {fmtNumber(i + 1)}</Label>
                      <Input id={`wf-${i}-${k}`} type="date" dir="ltr" value={w[k]} onChange={e => setWindow(i, k, e.target.value)} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="admin-tools-actions">
                <Button type="button" size="sm" variant="outline" disabled={windows.length >= WALK_FORWARD_MAX_WINDOWS} onClick={() => setWindows(ws => [...ws, {trainStart: ws[ws.length - 1].trainStart, trainEnd: ws[ws.length - 1].testEnd, testStart: '', testEnd: ''}])}>إضافة نافذة</Button>
                <Button type="button" size="sm" variant="ghost" disabled={windows.length <= 1} onClick={() => setWindows(ws => ws.slice(0, -1))}>حذف آخر نافذة</Button>
              </div>
            </fieldset>
          )}
          <fieldset className="admin-tools-fieldset">
            <legend>الآفاق</legend>
            <div className="admin-tools-checks">
              {BACKTEST_HORIZONS.map(h => (
                <label key={h} className="admin-tools-check">
                  <Checkbox checked={form.horizons.includes(h)} onCheckedChange={v => set('horizons', v === true ? [...form.horizons, h] : form.horizons.filter(x => x !== h))} />
                  <span>{horizonName(h)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="admin-tools-form-row">
            <div className="admin-tools-field"><Label htmlFor="bt-fee">العمولة (نقطة أساس)</Label><Input id="bt-fee" type="number" min={0} max={1000} value={form.commissionBps} onChange={e => set('commissionBps', Number(e.target.value))} /></div>
            <div className="admin-tools-field"><Label htmlFor="bt-slip">الانزلاق (نقطة أساس)</Label><Input id="bt-slip" type="number" min={0} max={1000} value={form.slippageBps} onChange={e => set('slippageBps', Number(e.target.value))} /></div>
            <div className="admin-tools-field"><Label htmlFor="bt-min">أدنى عدد جلسات</Label><Input id="bt-min" type="number" min={2} max={1500} value={form.minSessions} onChange={e => set('minSessions', Number(e.target.value))} /></div>
            <div className="admin-tools-field"><Label htmlFor="bt-run">معرف التقرير (اختياري)</Label><Input id="bt-run" dir="ltr" value={form.runId} onChange={e => set('runId', e.target.value)} placeholder="تلقائي" /></div>
          </div>
          <label className="admin-tools-check"><Checkbox checked={form.doubleSided} onCheckedChange={v => set('doubleSided', v === true)} /><span>احتساب التكاليف عند الدخول والخروج</span></label>
          {!check.ok && <p className="admin-tools-invalid" role="status">{check.error}</p>}
          <div className="admin-tools-actions"><Button type="submit" disabled={busy || !check.ok}>{busy ? 'جارٍ الاختبار… قد يستغرق دقيقة' : 'تشغيل الاختبار'}</Button></div>
        </form>
        <ErrorNotice error={error} />
        {busy && <LoadingBlock lines={4} />}
        {data && <AuditResult data={data} />}
      </CardContent>
    </Card>
  );
}

function QuickReplayCard() {
  const [symbol, setSymbol] = useState('AAPL'), [mode, setMode] = useState<'technical' | 'full'>('technical'), [asOf, setAsOf] = useState('');
  const [fee, setFee] = useState(0), [slip, setSlip] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState<AdminToolsError | null>(null), [data, setData] = useState<any>(null);
  const sym = symbol.trim().toUpperCase();
  const valid = /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(sym) && (!asOf || (validDay(asOf) && asOf < isoDay(0))) && [fee, slip].every(n => Number.isFinite(n) && n >= 0 && n <= 1000);
  async function run() {
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const {data: d} = await adminRequest('/api/backtest', {method: 'POST', json: {symbol: sym, mode, ...(asOf ? {asOf} : {}), feeBps: fee, slippageBps: slip}});
      setData(d); toast.success('اكتمل الاختبار السريع.');
    } catch (e) { const err = toAdminError(e); setError(err); toast.error(err.message); }
    finally { setBusy(false); }
  }
  const dg = data?.diagnostics;
  return (
    <Card>
      <CardHeader>
        <CardTitle><Zap aria-hidden className="admin-tools-icon" />اختبار سريع لرمز واحد</CardTitle>
        <CardDescription>إعادة تشغيل قواعد ميزان على أسعار سابقة لرمز واحد؛ لا يُحفظ في السجل. المصدر: <Ltr>/api/backtest</Ltr> (يكفي حساب المالك)</CardDescription>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <form className="admin-tools-form-row" onSubmit={e => { e.preventDefault(); void run(); }}>
          <div className="admin-tools-field"><Label htmlFor="qr-sym">الرمز</Label><Input id="qr-sym" dir="ltr" value={symbol} onChange={e => setSymbol(e.target.value)} /></div>
          <div className="admin-tools-field"><Label htmlFor="qr-mode">الوضع</Label>
            <NativeSelect id="qr-mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
              <NativeSelectOption value="technical">فني</NativeSelectOption><NativeSelectOption value="full">كامل (مع القوائم)</NativeSelectOption>
            </NativeSelect></div>
          <div className="admin-tools-field"><Label htmlFor="qr-asof">حتى تاريخ (اختياري)</Label><Input id="qr-asof" type="date" dir="ltr" value={asOf} max={isoDay(-1)} onChange={e => setAsOf(e.target.value)} /></div>
          <div className="admin-tools-field"><Label htmlFor="qr-fee">الرسوم (نقطة أساس)</Label><Input id="qr-fee" type="number" min={0} max={1000} value={fee} onChange={e => setFee(Number(e.target.value))} /></div>
          <div className="admin-tools-field"><Label htmlFor="qr-slip">الانزلاق (نقطة أساس)</Label><Input id="qr-slip" type="number" min={0} max={1000} value={slip} onChange={e => setSlip(Number(e.target.value))} /></div>
          <Button type="submit" disabled={busy || !valid}>{busy ? 'جارٍ…' : 'تشغيل'}</Button>
        </form>
        {!valid && <p className="admin-tools-invalid" role="status">تحقق من الرمز والتاريخ (قبل اليوم) والرسوم (0–1000).</p>}
        <ErrorNotice error={error} />
        {busy && <LoadingBlock />}
        {data && <div className="admin-tools-stack" aria-live="polite">
          <Facts items={[['الشركة', `${data.name ?? ''} (${data.symbol})`], ['الوضع', data.mode === 'full' ? 'كامل' : 'فني'], ['حتى', <Ltr key="a">{data.asOf}</Ltr>],
            ['النوافذ', fmtNumber(dg?.windows)], ['شراء', fmtNumber(dg?.buy)], ['انتظار', fmtNumber(dg?.wait)], ['محجوبة', fmtNumber(dg?.blocked)], ['مصدر الأسعار', data.sources?.priceSource ?? '—']]} />
          {dg?.blockedByReason && Object.keys(dg.blockedByReason).length > 0 && (
            <Table><TableHeader><TableRow><TableHead>سبب الحجب</TableHead><TableHead>العدد</TableHead></TableRow></TableHeader>
              <TableBody>{Object.entries(dg.blockedByReason as Record<string, number>).map(([k, v]) => <TableRow key={k}><TableCell className="admin-tools-wrap">{k}</TableCell><TableCell>{fmtNumber(v)}</TableCell></TableRow>)}</TableBody></Table>
          )}
          {data.text && <details className="admin-tools-details" open><summary>التقرير النصي</summary><pre className="admin-tools-pre">{data.text}</pre></details>}
          <RawJson value={data} />
        </div>}
      </CardContent>
    </Card>
  );
}

function AggregateCard() {
  const [limit, setLimit] = useState(10);
  const r = useAdminResource<any>(`/api/admin/backtest/aggregate?limit=${limit}`, false);
  const agg = r.data?.aggregate;
  return (
    <Card>
      <CardHeader>
        <CardTitle><Sigma aria-hidden className="admin-tools-icon" />تجميع آخر التقارير المحفوظة</CardTitle>
        <CardDescription>توزيعات (وسيط/أدنى/أعلى) عبر آخر التقارير؛ ليست محفظة موحدة. المصدر: <Ltr>/api/admin/backtest/aggregate</Ltr></CardDescription>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <div className="admin-tools-form-row">
          <div className="admin-tools-field">
            <Label htmlFor="ag-limit">عدد التقارير (1–{fmtNumber(AGGREGATE_LIMIT_MAX)})</Label>
            <Input id="ag-limit" type="number" min={1} max={AGGREGATE_LIMIT_MAX} value={limit} onChange={e => setLimit(Math.min(AGGREGATE_LIMIT_MAX, Math.max(1, Math.trunc(Number(e.target.value) || 1))))} />
          </div>
          <RefreshButton onClick={() => void r.load()} loading={r.loading} label="تجميع" />
          <Button variant="ghost" size="sm" onClick={() => adminDownload(`/api/admin/backtest/aggregate?limit=${limit}&format=md`, 'mizan-aggregate.md').catch(e => toast.error(toAdminError(e).message))}><Download aria-hidden />Markdown</Button>
        </div>
        <ErrorNotice error={r.error} />
        {r.loading && !r.data && <LoadingBlock />}
        {agg && <>
          <Facts items={[['تقارير مقروءة', fmtNumber(agg.runsScanned)], ['مستخدمة', fmtNumber(agg.runsUsed)], ['مكررة مستبعدة', fmtNumber(agg.duplicatesSkipped)], ['غير مدعومة/تالفة', fmtNumber(r.data.skippedUnsupportedOrInvalid)],
            ['أفضل أفق (وسيط الاتجاه)', agg.bestHorizon ? horizonName(agg.bestHorizon) : '—'], ['أضعف أفق', agg.worstHorizon ? horizonName(agg.worstHorizon) : '—']]} />
          <div className="admin-tools-scroll">
            <Table>
              <TableHeader><TableRow><TableHead>الأفق</TableHead><TableHead>تقارير</TableHead><TableHead>عينات مكتملة</TableHead><TableHead>صحة الاتجاه (وسيط)</TableHead><TableHead>المدى</TableHead><TableHead>داخل النطاق (وسيط)</TableHead><TableHead>Sharpe (وسيط)</TableHead></TableRow></TableHeader>
              <TableBody>{(agg.byHorizon ?? []).map((h: any) => (
                <TableRow key={h.horizon}>
                  <TableCell className="font-medium">{horizonName(h.horizon)}</TableCell><TableCell>{fmtNumber(h.runsContributing)}</TableCell><TableCell>{fmtNumber(h.totalCompleted)}</TableCell>
                  <TableCell>{fmtPercent(h.directionAccuracy?.median)}</TableCell><TableCell>{fmtPercent(h.directionAccuracy?.min)} – {fmtPercent(h.directionAccuracy?.max)}</TableCell>
                  <TableCell>{fmtPercent(h.rangeHitRate?.median)}</TableCell><TableCell>{fmtNumber(h.sharpe?.median)}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </div>
          <ul className="admin-tools-notes">{(agg.notes ?? []).map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
          <RawJson value={r.data} />
        </>}
        {!r.data && !r.loading && !r.error && <p className="admin-tools-muted">اضغط «تجميع» لقراءة التقارير.</p>}
      </CardContent>
    </Card>
  );
}

function RunsCard() {
  const r = useAdminResource<any>('/api/admin/tools/backtest-runs?limit=20', true);
  return (
    <Card>
      <CardHeader>
        <CardTitle><History aria-hidden className="admin-tools-icon" />التقارير المحفوظة والتصدير</CardTitle>
        <CardDescription>آخر 20 تقريرًا في <Ltr>backtest_runs</Ltr>. التصدير متاح لتقارير تدقيق التوقعات (ومنها نوافذ walk-forward المنفردة).</CardDescription>
        <CardAction><RefreshButton onClick={() => void r.load()} loading={r.loading} /></CardAction>
      </CardHeader>
      <CardContent className="admin-tools-stack">
        <ErrorNotice error={r.error} />
        {r.loading && !r.data && <LoadingBlock />}
        {r.data && (r.data.runs?.length ? (
          <div className="admin-tools-scroll">
            <Table>
              <TableHeader><TableRow><TableHead>المعرف</TableHead><TableHead>الرمز</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>تصدير</TableHead></TableRow></TableHeader>
              <TableBody>{r.data.runs.map((run: any) => (
                <TableRow key={run.id}>
                  <TableCell><Ltr>{run.id}</Ltr></TableCell><TableCell><Ltr>{run.symbol === '*' ? 'متعدد' : run.symbol}</Ltr></TableCell><TableCell>{fmtDateTime(run.createdAt)}</TableCell>
                  <TableCell>{run.kind === 'mizan-issued-forecast-audit-v1' ? 'تدقيق' : run.kind === 'mizan-issued-forecast-windows-v1' ? 'نوافذ (ملخص)' : run.kind ?? 'غير معروف'}</TableCell>
                  <TableCell>{run.exportable
                    ? <div className="admin-tools-actions"><Button size="xs" variant="outline" onClick={() => void download(run.id, 'csv')} aria-label={`تنزيل CSV للتقرير ${run.id}`}>CSV</Button><Button size="xs" variant="ghost" onClick={() => void download(run.id, 'tsv')} aria-label={`تنزيل TSV للتقرير ${run.id}`}>TSV</Button></div>
                    : <small className="admin-tools-muted">غير مدعوم</small>}</TableCell>
                </TableRow>))}</TableBody>
            </Table>
          </div>
        ) : <p className="admin-tools-muted">لا توجد تقارير محفوظة بعد.</p>)}
      </CardContent>
    </Card>
  );
}

export function BacktestTab() {
  const [version, setVersion] = useState(0);
  return (
    <div className="admin-tools-grid">
      <AuditCard onSaved={() => setVersion(v => v + 1)} />
      <RunsCard key={version} />
      <AggregateCard />
      <QuickReplayCard />
    </div>
  );
}
