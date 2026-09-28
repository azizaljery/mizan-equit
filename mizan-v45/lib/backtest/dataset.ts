import {BacktestInputError,type BacktestDataset} from './types';

/** One symbol, one currency, unique sessions; callers retain their own input order. */
export function normalizeBacktestDataset(input:unknown):BacktestDataset {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BacktestInputError('مجموعة الشموع مطلوبة.');
  const d=input as BacktestDataset;
  if(typeof d.symbol!=='string'||!/^(?:[A-Z][A-Z0-9.-]{0,14}|\d{4}\.SR)$/.test(d.symbol)||!['USD','SAR'].includes(d.currency)||d.currency!==(d.symbol.endsWith('.SR')?'SAR':'USD'))throw new BacktestInputError('هوية الرمز أو العملة غير صالحة.');
  if(!['split-adjusted','total-return-adjusted','raw'].includes(d.adjustment))throw new BacktestInputError('يجب تحديد سياسة تعديل الأسعار.');
  if(!Array.isArray(d.candles)||d.candles.length>1500)throw new BacktestInputError('الحد الأقصى 1500 شمعة لكل تشغيل.');
  const candles=d.candles.map(c=>{
    if(!c||typeof c.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||!Number.isFinite(Date.parse(c.date))||new Date(c.date).toISOString().slice(0,10)!==c.date||![c.open,c.high,c.low,c.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||!Number.isFinite(c.volume)||c.volume<0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||c.high<c.low)throw new BacktestInputError('شمعة غير صالحة: يلزم تاريخ وOHLCV صحيح.');
    return {date:c.date,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(candles.map(c=>c.date)).size!==candles.length)throw new BacktestInputError('جلسات مكررة في مجموعة الرمز.');
  return {symbol:d.symbol,currency:d.currency,adjustment:d.adjustment,candles};
}
