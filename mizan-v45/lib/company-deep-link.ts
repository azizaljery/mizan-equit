/** Parse a link only. Identity, availability and analysis still belong to the server. */
export type CompanyDeepLink={symbol:string;market:'sa'|'us'|'global'};
export function readCompanyDeepLink(search:string):CompanyDeepLink|null{
 const params=new URLSearchParams(search);
 if(!params.has('symbol'))return null;
 if(params.getAll('symbol').length!==1)throw new Error('رابط التحليل يحتوي أكثر من رمز؛ اختر شركة واحدة.');
 const raw=(params.get('symbol')||'').normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).trim().toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(raw))throw new Error('رمز التداول في رابط التحليل غير صالح.');
 if(/^\d{4,5}(\.SR)?$/.test(raw))return {symbol:raw.replace(/\.SR$/,'')+'.SR',market:'sa'};
 if(raw.endsWith('.SR'))throw new Error('الرمز السعودي في رابط التحليل غير صالح.');
 return {symbol:raw,market:/^[A-Z][A-Z0-9-]{0,18}(?:\.[AB])?$/.test(raw)?'us':'global'};
}
