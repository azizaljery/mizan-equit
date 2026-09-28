import type {Company} from './market-data';
import type {LiveQuote} from './live-quote';
export function paperStockCurrency(company:Company|null){
 if(!company)return '';
 if(company.symbol.endsWith('.SR'))return 'SAR';
 return /NASDAQ|NYSE|AMEX|ARCA|BATS|Cboe|OTC|أمريك/i.test(company.exchange)?'USD':'';
}
export function matchingPaperPrice(symbol:string|undefined,quote:LiveQuote|null,fallback:number|null=null){
 return quote&&quote.symbol===symbol&&Number.isFinite(quote.price)&&quote.price>0?quote.price:fallback;
}
