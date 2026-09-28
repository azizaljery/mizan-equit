/**
 * ثوابت عرض بحتة (أسماء الآفاق الستة وعدد جلساتها) — لا معاملات، لا أوزان،
 * لا منطق حساب. معزولة عمداً عن lib/research-model.ts كي تستطيع مكوّنات
 * العميل ('use client') استيرادها دون سحب دالة forecasts()/RESEARCH_WEIGHTS
 * إلى حزمة المتصفح.
 *
 * research-model.ts يعيد تصديرها من هنا (لا يعرّفها من جديد) كي لا تتغيّر
 * واجهته العامة لبقية الملفات الخادمية التي تستورد HORIZONS منه.
 */
export const HORIZONS = [
  { name: 'يومي', sessions: 1 },
  { name: 'أسبوع', sessions: 5 },
  { name: 'شهر', sessions: 21 },
  { name: '3 أشهر', sessions: 63 },
  { name: '6 أشهر', sessions: 126 },
  { name: 'سنة', sessions: 252 },
] as const;

export type ForecastHorizon = (typeof HORIZONS)[number]['sessions'];
