'use client';
import {useEffect, useState} from 'react';
import {ArrowRight, ShieldCheck, Wrench} from 'lucide-react';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {StateTab} from '@/components/admin-tools/state-tab';
import {BacktestTab} from '@/components/admin-tools/backtest-tab';
import {JobsTab} from '@/components/admin-tools/jobs-tab';
import {CouncilTab} from '@/components/admin-tools/council-tab';
import {AutomationTab} from '@/components/admin-tools/automation-tab';
import {ACCESS_SIGNIN_HREF, ADMIN_LOGIN_HREF} from '@/components/admin-tools/shared';
import {ADMIN_TOOLS_CSS} from '@/components/admin-tools/styles';

const TABS = [
  {id: 'state', label: 'الحالة والتشخيص'},
  {id: 'backtest', label: 'الاختبار التاريخي'},
  {id: 'jobs', label: 'المهام الخلفية'},
  {id: 'council', label: 'مجلس الوكلاء'},
  {id: 'automation', label: 'الأتمتة'},
] as const;
type TabId = typeof TABS[number]['id'];
const STORAGE_KEY = 'mizan-admin-tools-tab';

export default function AdminToolsPage() {
  const [tab, setTab] = useState<TabId>('state');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && TABS.some(t => t.id === saved)) setTab(saved as TabId);
    } catch { /* storage unavailable */ }
  }, []);
  function change(value: string) {
    if (!TABS.some(t => t.id === value)) return;
    setTab(value as TabId);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable */ }
  }
  return (
    <main className="admin-tools" dir="rtl">
      <style dangerouslySetInnerHTML={{__html: ADMIN_TOOLS_CSS}} />
      <header className="admin-tools-header">
        <div>
          <h1><Wrench aria-hidden className="admin-tools-icon" />أدوات إدارة ميزان</h1>
          <p className="admin-tools-muted">للمالك فقط: تشخيص الحالة، الاختبار التاريخي، تشغيل المهام يدويًا بحدود آمنة، مجلس الوكلاء، والأتمتة. كل إجراء يغيّر البيانات يطلب تأكيدًا.</p>
        </div>
        <nav aria-label="روابط الإدارة" className="admin-tools-nav">
          <a href={ADMIN_LOGIN_HREF}><ArrowRight aria-hidden />لوحة إدارة ميزان</a>
          <a href="/admin/verify"><ShieldCheck aria-hidden />التحقق التشغيلي</a>
        </nav>
      </header>
      <details className="admin-tools-signin">
        <summary>يتطلب الدخول خطوتين</summary>
        <ol>
          <li><a href={ACCESS_SIGNIN_HREF}>الدخول عبر Cloudflare Access</a> بحساب مالك ميزان (يحمي كل مسارات <bdi dir="ltr">/api/admin</bdi>).</li>
          <li><a href={ADMIN_LOGIN_HREF}>دخول إدارة ميزان</a> باسم المستخدم وكلمة المرور؛ الجلسة صالحة 30 دقيقة.</li>
        </ol>
      </details>
      <Tabs value={tab} onValueChange={change} dir="rtl" className="admin-tools-tabs">
        <TabsList className="admin-tools-tablist" aria-label="أقسام أدوات الإدارة">
          {TABS.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="state"><StateTab /></TabsContent>
        <TabsContent value="backtest"><BacktestTab /></TabsContent>
        <TabsContent value="jobs"><JobsTab /></TabsContent>
        <TabsContent value="council"><CouncilTab /></TabsContent>
        <TabsContent value="automation"><AutomationTab /></TabsContent>
      </Tabs>
    </main>
  );
}
