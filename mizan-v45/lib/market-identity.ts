const US_EXCHANGES = new Set(['NMS','NGM','NCM','NYQ','NYS','ASE','PCX','BTS','PNK','OTC','OQB','OQX','NASDAQ','NYSE','NYSEARCA','NYSE AMERICAN','BATS']);
const SA_EXCHANGES = new Set(['SAU','SAUDI','TADAWUL']);

/** Validate the instrument returned by the provider before using any prices. */
export function validateMarketIdentity(meta:any, symbol:string, allowIndex=false) {
 if(!meta||meta.symbol!==symbol)throw Error('رمز المصدر لا يطابق السهم المطلوب؛ لم نستخدم الأسعار.');
 if(!(allowIndex?['EQUITY','ETF','INDEX']:['EQUITY','ETF']).includes(meta.instrumentType))throw Error('نوع الورقة لا يطابق سهمًا أو صندوقًا؛ لم نستخدم بيانات مؤشر بدل الشركة.');
 if(typeof meta.currency!=='string'||!meta.currency.trim())throw Error('عملة السعر غير متحققة.');
 const exchange=String(meta.exchangeName||meta.fullExchangeName||'').trim().toUpperCase();
 if(symbol.endsWith('.SR')){
  if(meta.currency!=='SAR')throw Error('عملة السعر لا تطابق السوق السعودي.');
  if(!SA_EXCHANGES.has(exchange))throw Error('بورصة السعر لا تطابق السوق السعودي أو لم يتم التحقق منها.');
 }else if(/^[A-Z][A-Z0-9-]*$/.test(symbol)){
  if(meta.currency!=='USD')throw Error('عملة السعر لا تطابق السهم الأمريكي المطلوب.');
  if(!US_EXCHANGES.has(exchange))throw Error('بورصة السعر لا تطابق السوق الأمريكي أو لم يتم التحقق منها.');
 }else if(!exchange){throw Error('بورصة السعر غير متحققة.');}
 return {symbol,currency:meta.currency as string,exchange};
}
