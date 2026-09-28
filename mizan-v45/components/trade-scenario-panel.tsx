import type {TradePlan} from '@/lib/trade-scenario';
import type {CashFlowQualityAssessment} from '@/lib/decision-room';
import {fmt} from '@/lib/analysis';

export function TradeScenarioPanel({plan,quality}:{plan:TradePlan;quality?:CashFlowQualityAssessment}){
 const number=(v:number|null)=>v!==null&&Number.isFinite(v)?fmt(v):'غير متاح';
 const percent=(v:number|null)=>v!==null&&Number.isFinite(v)?`${fmt(v)}%`:'غير متاح';
 return <section className="execution-panel" aria-label="خطة التنفيذ">
  <header className="execution-header"><div><small>خطة التنفيذ المشروطة</small><h4>{plan.action}</h4></div><span className={`quality-badge ${plan.liquidityConfirmation.isConfirmed?'is-good':'is-weak'}`}>RVOL: {number(plan.liquidityConfirmation.rvol)}{plan.liquidityConfirmation.rvol!==null?'x':''}</span></header>
  <p>{plan.liquidityConfirmation.note}</p>
  {plan.status==='standby'&&<p>الخطة قيد الانتظار؛ الأرقام أدناه لا تعني السماح بالشراء الآن.</p>}
  {plan.status==='abstain'||!plan.entryZone||!plan.targets?<p role="status">{plan.stopLoss.reason||'المستويات غير متاحة.'}</p>:<>
   <div className="execution-grid">
    <div><small>نطاق الدخول</small><strong dir="ltr">{number(plan.entryZone.min)} – {number(plan.entryZone.max)} {plan.currency}</strong></div>
    <div><small>وقف الخطر</small><strong>{number(plan.stopLoss.price)} {plan.currency} · {percent(plan.stopLoss.percentage)}</strong></div>
    <div><small>تخصيص المركز — كيلي</small><strong>{plan.positionSizing.portfolioAllocationText}</strong></div>
    <div><small>مخاطرة المحفظة المقدرة</small><strong>{percent(plan.positionSizing.riskCapitalPerTradePercent)}</strong></div>
   </div>
   {[plan.targets.primary,plan.targets.secondary].map((t,i)=><div className="execution-target" key={i}><div><strong>الهدف {i+1}: {number(t.price)} {plan.currency}</strong><p>العائد {percent(t.gainPercentage)} · العائد/الخطر {number(t.rrRatio)}:1</p></div><span>{t.actionText}</span></div>)}
   <p>{plan.stopLoss.reason}</p>
  </>}
  {quality&&<div className="execution-target"><span>جودة الأرباح: {quality.earningsQualityScore}</span><span>عائد التدفق النقدي الحر: {percent(quality.fcfYieldPercent)}</span></div>}
  <ul>{plan.executionNotes.map((n,i)=><li key={i}>{n}</li>)}</ul>
 </section>;
}
