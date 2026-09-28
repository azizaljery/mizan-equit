import {hashPin,validPin,verifyPin} from './pin-lock';
import {tokenDigest} from './admin-access';

export type PaperPortfolio={id:string;name:string;currency:string;createdAt:string;updatedAt:string;needsPin?:boolean};
export type CashEntry={id:string;portfolioId:string;cashType:'deposit';amount:number;currency:string;createdAt:string;source:string;note?:string};
export type PaperTrade={id:string;portfolioId?:string;sequence?:number;symbol:string;side:'buy'|'sell';quantity:number;price:number;currency:string;createdAt:string;reason:string;forecastId:string|null;confidence:string|null;source:string;quoteTime:string};
const supportedCurrency=(value:unknown)=>typeof value==='string'&&/^[A-Z]{3,5}$/.test(value);
const positive=(value:unknown,max=1e12)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
const iso=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now()+120000;
const rawToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const cleanName=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,80):'';
const portfolioId=(trade:PaperTrade)=>trade.portfolioId||'legacy';

export function validPortfolioName(value:unknown){const name=cleanName(value);return name.length>=2&&name.length<=80;}
export function validManualDate(value:unknown){return iso(value);}
export function normalizePortfolio(row:any):PaperPortfolio{
 const data=typeof row?.data==='string'?JSON.parse(row.data):row?.data||row;
 return {id:String(row?.id||data.id||''),name:String(data.name||row?.name||''),currency:String(data.currency||row?.currency||''),createdAt:String(data.createdAt||row?.created_at||''),updatedAt:String(data.updatedAt||row?.updated_at||data.createdAt||row?.created_at||''),needsPin:!/^([a-f0-9]{32}):([a-f0-9]{64})$/.test(String(row?.pin_hash||data.pinHash||''))};
}
export function normalizeCash(row:any):CashEntry{const data=typeof row?.data==='string'?JSON.parse(row.data):row?.data||row;return {...data,amount:Number(data.amount)};}
export function normalizeTrade(row:any):PaperTrade{const data=typeof row?.data==='string'?JSON.parse(row.data):row?.data||row;return {...data,sequence:row?.ledger_sequence??data.sequence,portfolioId:data.portfolioId||row?.portfolio_id||'legacy',quantity:Number(data.quantity),price:Number(data.price)};}

export async function listPaperPortfolios(db:any){const rows=await db.prepare('SELECT * FROM paper_portfolios ORDER BY created_at,id').all();return (rows.results||[]).map(normalizePortfolio);}
export async function createPaperPortfolio(db:any,input:{name:unknown;currency:unknown;pin:unknown;capital?:unknown}){
 const name=cleanName(input.name),currency=typeof input.currency==='string'?input.currency.toUpperCase():'';
 if(!validPortfolioName(name))throw Error('اسم المحفظة من حرفين إلى 80 حرفًا.');
 if(!supportedCurrency(currency))throw Error('اختر عملة محفظة صالحة.');
 if(!validPin(input.pin))throw Error('رمز المحفظة من 6 إلى 12 رقمًا.');
 const capital=input.capital===undefined?0:input.capital;if(typeof capital!=='number'||!Number.isFinite(capital)||capital<0||capital>1e12)throw Error('رأس المال غير صالح.');
 const count=await db.prepare("SELECT COUNT(*) AS n FROM paper_portfolios WHERE id<>'legacy'").first();if(Number(count?.n||0)>=100)throw Error('وصلت إلى الحد الأعلى: 100 محفظة محفوظة.');
 const duplicate=await db.prepare('SELECT id FROM paper_portfolios WHERE lower(name)=lower(?)').bind(name).first();if(duplicate)throw Error('اسم المحفظة مستخدم بالفعل. اختر اسمًا مختلفًا.');
 const id=crypto.randomUUID(),createdAt=new Date().toISOString(),portfolio:PaperPortfolio={id,name,currency,createdAt,updatedAt:createdAt};
 const statements=[db.prepare('INSERT INTO paper_portfolios (id,name,currency,pin_hash,attempts,window_started,created_at,updated_at,data) VALUES (?,?,?,?,0,0,?,?,?)').bind(id,name,currency,await hashPin(input.pin),createdAt,createdAt,JSON.stringify(portfolio))];
 if(capital>0){const entry:CashEntry={id:crypto.randomUUID(),portfolioId:id,cashType:'deposit',amount:capital,currency,createdAt,source:'إدخال المستخدم',note:'رأس المال الأصلي'};statements.push(db.prepare('INSERT INTO paper_cash_entries (id,portfolio_id,cash_type,amount,currency,created_at,data) VALUES (?,?,?,?,?,?,?)').bind(entry.id,id,'deposit',String(capital),currency,createdAt,JSON.stringify(entry)));}
 await db.batch(statements);
 const token=await openPaperPortfolio(db,id,String(input.pin));return {portfolio,token};
}
export async function setLegacyPortfolioPin(db:any,id:unknown,pin:unknown){
 if(typeof id!=='string'||!validPin(pin))throw Error('أدخل رمزًا من 6 إلى 12 رقمًا.');
 const row=await db.prepare('SELECT * FROM paper_portfolios WHERE id=?').bind(id).first();if(!row)throw Error('المحفظة غير موجودة.');
 if(/^([a-f0-9]{32}):([a-f0-9]{64})$/.test(row.pin_hash||''))throw Error('رمز المحفظة مهيأ بالفعل.');
 await db.prepare('UPDATE paper_portfolios SET pin_hash=?,updated_at=? WHERE id=?').bind(await hashPin(pin),new Date().toISOString(),id).run();
 return openPaperPortfolio(db,id,String(pin));
}
export async function openPaperPortfolio(db:any,id:unknown,pin:unknown){
 if(typeof id!=='string'||!validPin(pin))throw Error('أدخل رمز المحفظة المكوّن من 6 إلى 12 رقمًا.');
 const now=Date.now();await db.prepare('UPDATE paper_portfolios SET attempts=0,window_started=? WHERE id=? AND window_started<?').bind(now,id,now-900000).run();
 const row=await db.prepare('UPDATE paper_portfolios SET attempts=attempts+1 WHERE id=? AND attempts<5 RETURNING *').bind(id).first();
 if(!row)throw Error('محاولات كثيرة؛ انتظر 15 دقيقة قبل إعادة فتح المحفظة.');
 if(!/^([a-f0-9]{32}):([a-f0-9]{64})$/.test(row.pin_hash||''))throw Error('هذه المحفظة القديمة تحتاج تعيين رمز جديد أولًا.');
 if(!await verifyPin(String(pin),row.pin_hash))throw Error('رمز المحفظة غير صحيح.');
 await db.prepare('UPDATE paper_portfolios SET attempts=0,updated_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
 await db.prepare('DELETE FROM paper_portfolio_sessions WHERE expires_at<?').bind(now).run();
 const token=rawToken(),expiresAt=now+12*60*60*1000;
 await db.prepare('INSERT INTO paper_portfolio_sessions (token_hash,portfolio_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await tokenDigest(token),id,expiresAt,new Date().toISOString()).run();
 return {token,expiresAt,portfolio:normalizePortfolio(row)};
}
export async function requirePaperPortfolio(db:any,id:unknown,token:unknown){
 if(typeof id!=='string'||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('افتح المحفظة برمزها قبل تنفيذ العملية.');
 const row=await db.prepare('SELECT p.* FROM paper_portfolio_sessions s JOIN paper_portfolios p ON p.id=s.portfolio_id WHERE s.portfolio_id=? AND s.token_hash=? AND s.expires_at>?').bind(id,await tokenDigest(token),Date.now()).first();
 if(!row)throw Error('انتهت جلسة المحفظة أو لم تُفتح بالرمز الصحيح.');
 return normalizePortfolio(row);
}
export async function appendPaperCash(db:any,entry:CashEntry){
 if(!positive(entry.amount)||!supportedCurrency(entry.currency)||!iso(entry.createdAt)||entry.cashType!=='deposit')throw Error('بيانات الرصيد الوهمي غير صالحة.');
 const duplicate=await db.prepare('SELECT id FROM paper_cash_entries WHERE id=?').bind(entry.id).first();if(duplicate)return normalizeCash(await db.prepare('SELECT * FROM paper_cash_entries WHERE id=?').bind(entry.id).first());
 await db.prepare('INSERT INTO paper_cash_entries (id,portfolio_id,cash_type,amount,currency,created_at,data) VALUES (?,?,?,?,?,?,?)').bind(entry.id,entry.portfolioId,entry.cashType,String(entry.amount),entry.currency,entry.createdAt,JSON.stringify(entry)).run();
 return entry;
}
export function portfolio(trades:PaperTrade[],quotes:Record<string,{price:number;currency:string;quoteTime:string}>) {
 const map=new Map<string,{symbol:string;currency:string;quantity:number;cost:number;realized:number;invested:number;name:string;exchange:string;firstBoughtAt:string}>();
 for(const t of [...trades].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||(a.sequence!==undefined&&b.sequence!==undefined?a.sequence-b.sequence:0))){const key=t.symbol+'|'+t.currency,p=map.get(key)||{symbol:t.symbol,currency:t.currency,quantity:0,cost:0,realized:0,invested:0,name:(t as any).companyName||t.symbol,exchange:(t as any).exchange||'',firstBoughtAt:t.createdAt};
 if(t.side==='buy'){if(p.quantity===0)p.firstBoughtAt=t.createdAt;p.quantity+=t.quantity;p.cost+=t.quantity*t.price;p.invested+=t.quantity*t.price;}else{if(t.quantity>p.quantity+1e-8)throw Error('توجد كمية بيع تتجاوز الرصيد المسجل.');const avg=p.quantity?p.cost/p.quantity:0;p.realized+=(t.price-avg)*t.quantity;p.cost-=avg*t.quantity;p.quantity=Math.max(0,p.quantity-t.quantity);if(p.quantity<1e-8){p.quantity=0;p.cost=0;}}map.set(key,p);}
 return [...map.values()].map(p=>{const quote=quotes[p.symbol],price=quote?.currency===p.currency&&Number.isFinite(quote.price)&&quote.price>0?quote.price:null;return {...p,averageCost:p.quantity?p.cost/p.quantity:null,price,quoteTime:price===null?null:quote?.quoteTime||null,marketValue:price===null?null:price*p.quantity,unrealized:price===null?null:price*p.quantity-p.cost,returnPct:price===null||!p.invested?null:(p.realized+price*p.quantity-p.cost)/p.invested*100};});
}
export function paperPortfolioSummary(portfolioItem:PaperPortfolio,trades:PaperTrade[],cashEntries:CashEntry[],quotes:Record<string,{price:number;currency:string;quoteTime:string}>){
 const legacyMulti=portfolioItem.currency==='MULTI',ownTrades=trades.filter(t=>portfolioId(t)===portfolioItem.id&&(legacyMulti||t.currency===portfolioItem.currency)),ownCash=cashEntries.filter(c=>c.portfolioId===portfolioItem.id&&(legacyMulti||c.currency===portfolioItem.currency)),positions=portfolio(ownTrades,quotes);
 const deposits=ownCash.filter(c=>c.cashType==='deposit').reduce((s,c)=>s+c.amount,0),purchases=ownTrades.filter(t=>t.side==='buy').reduce((s,t)=>s+t.quantity*t.price,0),sales=ownTrades.filter(t=>t.side==='sell').reduce((s,t)=>s+t.quantity*t.price,0),cash=deposits-purchases+sales,marketValues=positions.filter(p=>p.quantity>0).map(p=>p.marketValue),valueKnown=marketValues.every(v=>v!==null),marketValue=valueKnown?marketValues.reduce((s,v)=>s+(v||0),0):null,realized=positions.reduce((s,p)=>s+p.realized,0),unrealized=valueKnown?positions.reduce((s,p)=>s+(p.unrealized||0),0):null,totalValue=marketValue===null?null:cash+marketValue,totalPnl=unrealized===null?null:realized+unrealized;
 const initialCapital=[...ownCash].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]?.amount??0,totalGains=valueKnown?positions.reduce((s,p)=>s+Math.max(0,p.realized+(p.unrealized||0)),0):null,totalLosses=valueKnown?positions.reduce((s,p)=>s+Math.max(0,-p.realized-(p.unrealized||0)),0):null;
 return {initialCapital:legacyMulti?null:initialCapital,totalGains:legacyMulti?null:totalGains,totalLosses:legacyMulti?null:totalLosses,portfolio:portfolioItem,positions,deposits:legacyMulti?null:deposits,purchases:legacyMulti?null:purchases,sales:legacyMulti?null:sales,cash:legacyMulti?null:cash,marketValue:legacyMulti?null:marketValue,totalValue:legacyMulti?null:totalValue,realized:legacyMulti?null:realized,unrealized:legacyMulti?null:unrealized,totalPnl:legacyMulti?null:totalPnl,returnPct:legacyMulti?null:(totalPnl===null||!deposits?null:totalPnl/deposits*100)};
}
export async function appendPaperTrade(db:any,t:PaperTrade){
 const pid=portfolioId(t);if(!positive(t.quantity,1e9)||!positive(t.price,1e9)||t.quantity*t.price>1e12||Math.abs(t.quantity*1e6-Math.round(t.quantity*1e6))>1e-4||!supportedCurrency(t.currency)||!iso(t.createdAt)||!['buy','sell'].includes(t.side))throw Error('راجع السعر والكمية والتاريخ؛ الحد 6 منازل عشرية للكمية وقيمة تريليون للصفقة الوهمية.');
 t={...t,createdAt:new Date(t.createdAt).toISOString()};
 const existing=await db.prepare('SELECT * FROM paper_trades WHERE id=?').bind(t.id).first();if(existing)return normalizeTrade(existing);
 const sql=t.side==='buy'
 ? "INSERT OR IGNORE INTO paper_trades (id,portfolio_id,symbol,side,quantity,price,currency,created_at,data) SELECT ?,?,?,?,?,?,?,?,? WHERE ?<=COALESCE((SELECT SUM(CASE WHEN cash_type='deposit' THEN CAST(amount AS REAL) ELSE -CAST(amount AS REAL) END) FROM paper_cash_entries WHERE portfolio_id=? AND currency=?),0)+COALESCE((SELECT SUM(CASE WHEN side='sell' THEN CAST(quantity AS REAL)*CAST(price AS REAL) ELSE -CAST(quantity AS REAL)*CAST(price AS REAL) END) FROM paper_trades WHERE portfolio_id=? AND currency=?),0)+0.00000001"
 : "INSERT OR IGNORE INTO paper_trades (id,portfolio_id,symbol,side,quantity,price,currency,created_at,data) SELECT ?,?,?,?,?,?,?,?,? WHERE ?<=COALESCE((SELECT SUM(CASE WHEN side='buy' THEN CAST(quantity AS REAL) ELSE -CAST(quantity AS REAL) END) FROM paper_trades WHERE portfolio_id=? AND symbol=? AND currency=?),0)+0.00000001";
 const values=t.side==='buy'?[t.id,pid,t.symbol,t.side,String(t.quantity),String(t.price),t.currency,t.createdAt,JSON.stringify({...t,portfolioId:pid}),t.quantity*t.price,pid,t.currency,pid,t.currency]:[t.id,pid,t.symbol,t.side,String(t.quantity),String(t.price),t.currency,t.createdAt,JSON.stringify({...t,portfolioId:pid}),t.quantity,pid,t.symbol,t.currency];
 // Keep historical entries chronological; inserting an earlier sale can invalidate later cost basis.
 const chronologicalSql=sql+" AND ?>=COALESCE((SELECT MAX(created_at) FROM paper_trades WHERE portfolio_id=?),'')";
 const inserted=await db.prepare(chronologicalSql).bind(...values,t.createdAt,pid).run();
 if(!Number(inserted?.meta?.changes??inserted?.changes??0)){const again=await db.prepare('SELECT * FROM paper_trades WHERE id=?').bind(t.id).first();if(again)return normalizeTrade(again);const last=await db.prepare('SELECT MAX(created_at) AS last_at FROM paper_trades WHERE portfolio_id=?').bind(pid).first();if(last?.last_at>t.createdAt)throw Error('أدخل العمليات التاريخية بترتيب وقتها. توجد عملية أحدث في المحفظة؛ لم نغيّر تكلفتها أو أرباحها بأثر رجعي.');throw Error(t.side==='buy'?'الرصيد النقدي غير كافٍ لهذه الصفقة الوهمية. أضف رصيدًا أولًا.':'كمية البيع أكبر من رصيد السهم في هذه المحفظة.');}
 return {...t,portfolioId:pid};
}
