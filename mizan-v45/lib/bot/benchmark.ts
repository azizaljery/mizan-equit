/**
 * BOT-0001 benchmark rules (pure). US: the SPY price itself. Saudi: no reliable TASI series is available, so the reference is an
 * equal-weight basket of the same stocks the bot looked at that day, chained from 100. Both are stated, not hidden.
 */
export const US_BENCHMARK_SYMBOL='SPY';
export const US_BENCHMARK_NAME='SPY (مؤشر S&P 500)';
export const SA_BENCHMARK_NAME='سلة متساوية الوزن من الأسهم المفحوصة (لا سلسلة موثوقة لتاسي)';
export const SA_BASKET_MIN=5;
const ok=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
/** Mean daily return of the basket from each quote's price and previous close; null when fewer than SA_BASKET_MIN usable quotes. */
export function basketReturn(quotes:readonly {price:number;previousClose:number|null}[]):number|null{
 const r=quotes.filter(q=>ok(q.price)&&ok(q.previousClose)).map(q=>q.price/q.previousClose!-1);
 return r.length>=SA_BASKET_MIN?r.reduce((a,b)=>a+b,0)/r.length:null;
}
/** Chains the basket index: first snapshot starts at 100; a missing return carries no value (null) rather than a guess. */
export const chainBasket=(previous:number|null,isFirst:boolean,ret:number|null):number|null=>ret===null?null:isFirst?100:ok(previous)?previous*(1+ret):null;
