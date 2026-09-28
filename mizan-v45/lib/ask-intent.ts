import {DEFAULT_SETTINGS,type SiteSettings} from './site-settings';
export function parseAskIntent(input:string,settings:SiteSettings=DEFAULT_SETTINGS){
 const q=input.normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[أإآ]/g,'ا').replace(/[\u064b-\u065fـ]/g,'').trim();
 if(!q||q.length>500)throw Error('اكتب طلبك في حدود 500 حرف.');
 const us=/امريك|\bUS\b|NASDAQ|NYSE/i.test(q),sa=/سعود|تداول|تاسي/.test(q);
 if(us&&sa&&!/قارن|مقارن/.test(q))throw Error('اختر سوقًا واحدًا في طلب المسح الحالي.');
 const market=us?'us':sa?'sa':settings.market;
 if(!settings.askEnabled)throw Error('اسأل ميزان متوقف من الإدارة.');if(!settings.enabledMarkets.includes(market))throw Error('هذا السوق متوقف من الإدارة.');
 const horizon: 'short'|'medium'|'long'=/طويل|سنو|سنة|عام/.test(q)?'long':/مضارب|قصير|اسبوع|يومي/.test(q)?'short':/متوسط|شهر|اشهر/.test(q)?'medium':settings.horizon as 'short'|'medium'|'long';
 const countMatch=q.match(/(?:افضل|رشح(?:\s+لي)?|اقترح(?:\s+لي)?)\s*(\d+)|\b(\d+)\s*(?:شرك|اسهم)/);
 const word=q.match(/(?:خمس|خمسة|عشر|عشرة|ثلاث|ثلاثة)\s*(?:شرك|اسهم)/)?.[0];
 const count=countMatch?Number(countMatch[1]||countMatch[2]):word?/خمس/.test(word)?5:/عشر/.test(word)?10:3:settings.count;
 const compare=/قارن|مقارن/.test(q);
 if(!compare&&!/رشح|افضل|فرص|اقترح|ابحث|اختر|اعرض|ابي|اريد|شركات|اسهم/.test(q))throw Error('لم يتضح الطلب. اكتب هل تريد البحث عن فرص أو مقارنة شركات، وحدد هدفك إن رغبت.');
 const shariaOnly=/متوافق.*شرع|نقي[هة]|حلال|شرعي[هة]/.test(q);
 const maxPrice=Number(q.match(/(?:اقل من|تحت|دون)\s*(\d+(?:\.\d+)?)\s*(?:دولار|ريال)/)?.[1]||0)||null;
 const sectors=[['تقني|تكنولوج','Technology|تقني'],['طاق[هة]|نفط','Energy|طاقة'],['بنوك|مصارف','Financial|Banks|بنوك|مصارف'],['صح[ية]|رعاي[هة]','Healthcare|Health Care|رعاية|صحة'],['عقار','Real Estate|عقار']];
 const sector=sectors.find(([pattern])=>new RegExp(pattern).test(q))?.[1]||null;
 const lowRisk=/اقل مخاط|الاقل مخاط|منخفض[ةه]? المخاطر|استبعد.*(?:مخاطر|المخاطر).*(?:عالي|مرتف)|بدون.*مخاطر.*عالي/.test(q);
 const highLiquidity=/سيول[ةه].*(?:مرتف|عالي)|(?:مرتف|عالي).*سيول[ةه]/.test(q),positiveMomentum=/زخم.*(?:ايجابي|موجب)/.test(q);
 const rules=horizon==='short'?settings.trading:settings.investing;
 return {lowRisk:lowRisk||rules.excludeHighRisk,positiveMomentum:positiveMomentum||(horizon==='short'&&settings.trading.positiveMomentum),minTurnover:Math.max(settings.minTurnover,rules.minTurnover,highLiquidity?(market==='sa'?10000000:20000000):0),maxVolatility:rules.maxVolatility,positiveCashFlow:horizon!=='short'&&settings.investing.positiveCashFlow,shariaOnly,maxPrice,sector,q,market,horizon,mode:horizon==='short'?'trader' as const:'investor' as const,compare,limit:Math.min(20,Math.max(1,count))};
}
