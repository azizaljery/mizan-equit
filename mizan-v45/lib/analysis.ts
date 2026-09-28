export type Price = {date:string; open:number; high:number; low:number; close:number; volume:number};
export type Financials = Record<string,number|null>;
export type Meta = {name:string; symbol:string; market:string; currency:string; priceCurrency:string; sector:string; periodEnd:string; publishedAt:string; period:string; unit:string; priceSource:string; financialSource:string; peerSource:string; asOf:string; shariaStatus:string; shariaSource:string; shariaDate:string; accounting:string};
export type Checks = {financial:boolean; prices:boolean; events:boolean};
export type Events = {goingConcern:boolean; suspended:boolean; adverseAudit:boolean; qualifiedAudit:boolean; upcoming:boolean};
export type Factor = {key:string; name:string; category:'financial'|'technical'|'valuation'|'events'; value:number|null; display:string; score:number|null; weight:number; reason:string; rule:string};
export const LEVELS=['منخفض جدا','منخفض','متوسط','مرتفع','مرتفع جدا'];
export const COLORS=['#40916c','#83a454','#d0ac4c','#d88948','#c35653'];
export const FIELDS = [
 {key:'revenue',label:'الإيرادات',group:'الربحية والنمو'},
 {key:'previousRevenue',label:'إيرادات الفترة المقارنة',group:'الربحية والنمو'},
 {key:'netIncome',label:'صافي الربح العائد للمساهمين',group:'الربحية والنمو'},
 {key:'operatingIncome',label:'الربح التشغيلي (EBIT)',group:'الربحية والنمو'},
 {key:'ebitda',label:'EBITDA',group:'الربحية والنمو'},
 {key:'equity',label:'حقوق المساهمين',group:'الملاءة والديون'},
 {key:'assets',label:'إجمالي الأصول',group:'الملاءة والديون'},
 {key:'liabilities',label:'إجمالي الالتزامات',group:'الملاءة والديون'},
 {key:'debt',label:'الديون التمويلية',group:'الملاءة والديون'},
 {key:'cash',label:'النقد وما في حكمه',group:'الملاءة والديون'},
 {key:'currentAssets',label:'الأصول المتداولة',group:'الملاءة والديون'},
 {key:'currentLiabilities',label:'الالتزامات المتداولة',group:'الملاءة والديون'},
 {key:'interestExpense',label:'تكلفة التمويل (موجبة)',group:'الملاءة والديون'},
 {key:'operatingCashFlow',label:'التدفق النقدي التشغيلي',group:'النقد والتقييم'},
 {key:'capex',label:'الإنفاق الرأسمالي (موجب)',group:'النقد والتقييم'},
 {key:'marketCap',label:'القيمة السوقية الحالية',group:'النقد والتقييم'},
 {key:'peerPE',label:'وسيط مكرر ربحية النظراء',group:'النقد والتقييم'},
 {key:'dividends',label:'التوزيعات النقدية للفترة',group:'النقد والتقييم'},
];
export const blankFinancials=():Financials=>Object.fromEntries(FIELDS.map(f=>[f.key,null]));
export const today=()=>new Date().toISOString().slice(0,10);
export const blankMeta=():Meta=>({name:'',symbol:'',market:'sa',currency:'SAR',priceCurrency:'SAR',sector:'general',periodEnd:'',publishedAt:'',period:'annual',unit:'million',priceSource:'',financialSource:'',peerSource:'',asOf:today(),shariaStatus:'unknown',shariaSource:'',shariaDate:'',accounting:'IFRS'});
export const blankChecks=():Checks=>({financial:false,prices:false,events:false});
export const blankEvents=():Events=>({goingConcern:false,suspended:false,adverseAudit:false,qualifiedAudit:false,upcoming:false});
export function finite(x:unknown):x is number{return typeof x==='number'&&Number.isFinite(x)}
export function fmt(v:number|null|undefined,d=2){return finite(v)?new Intl.NumberFormat('en-US',{maximumFractionDigits:d,minimumFractionDigits:0}).format(v):'—'}
export function level(s:number){return Math.min(4,Math.max(0,Math.floor(s/20)))}
export function label(s:number|null){return s===null?'بيانات غير كافية':LEVELS[level(s)]}
export function parseNumber(value:unknown):number|null{
 if(typeof value==='number')return finite(value)?value:null;
 if(typeof value!=='string')return null;
 let s=value.trim().replace(/[٠-٩]/g,x=>String(x.charCodeAt(0)-1632)).replace(/[۰-۹]/g,x=>String(x.charCodeAt(0)-1776)).replace(/٬/g,',').replace(/٫/g,'.').replace(/[\u200e\u200f\u061c\u202a-\u202e]/g,'').trim();
 if(!s||/^[-—–]+$/.test(s))return null;
 let neg=false;if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1).trim()}
 if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(s))return null;
 const n=Number(s.replace(/,/g,''))*(neg?-1:1);return finite(n)?n:null;
}
export function parseCSV(input:string):string[][]{
 const s=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 const first=s.split('\n')[0]; const sep=first.includes('\t')?'\t':first.includes(';')?';':',';
 const rows:string[][]=[];let row:string[]=[];let field='';let quoted=false;
 for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){field+='"';i++}else if(quoted||field==='')quoted=!quoted;else throw new Error('علامة اقتباس غير صحيحة في الملف.')}else if(c===sep&&!quoted){row.push(field.trim());field=''}else if(c==='\n'&&!quoted){row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field=''}else field+=c;}
 if(quoted)throw new Error('اقتباس غير مغلق في ملف CSV.'); row.push(field.trim());if(row.some(Boolean))rows.push(row);return rows;
}
export function validDate(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s}
export function ageDays(a:string,b:string){return (Date.parse(a)-Date.parse(b))/86400000}
export function parsePrices(text:string):Price[]{
 const rows=parseCSV(text);if(rows.length<2)throw new Error('ملف الأسعار لا يحتوي جلسات.');
 const aliases:Record<string,string>={'التاريخ':'date','افتتاح':'open','الافتتاح':'open','أعلى':'high','الأعلى':'high','ادنى':'low','أدنى':'low','الأدنى':'low','إغلاق':'close','الإغلاق':'close','الحجم':'volume','حجم التداول':'volume'};
 const head=rows[0].map(x=>aliases[x]||x.toLowerCase().trim()); const keys=['date','open','high','low','close','volume'];
 for(const k of keys)if(head.filter(x=>x===k).length!==1)throw new Error('يلزم عمود واحد لكل من: date, open, high, low, close, volume.');
 if(rows.length>10001)throw new Error('الحد الأعلى 10,000 جلسة في الملف الواحد.');const seen=new Set<string>();
 const data=rows.slice(1).map((row,i)=>{if(row.length!==head.length)throw new Error(`عدد الأعمدة غير صحيح في السطر ${i+2}.`);const vals=Object.fromEntries(keys.map(k=>[k,row[head.indexOf(k)]]));
 if(!validDate(vals.date))throw new Error(`تاريخ غير صالح في السطر ${i+2}؛ استخدم YYYY-MM-DD.`);
 if(seen.has(vals.date))throw new Error(`تاريخ مكرر: ${vals.date}. يلزم ملف جلسات يومية.`);seen.add(vals.date);
 const p={date:vals.date,open:parseNumber(vals.open),high:parseNumber(vals.high),low:parseNumber(vals.low),close:parseNumber(vals.close),volume:parseNumber(vals.volume)};
 if(!finite(p.open)||!finite(p.high)||!finite(p.low)||!finite(p.close)||!finite(p.volume)||p.open<=0||p.high<=0||p.low<=0||p.close<=0||p.volume<0||p.high<Math.max(p.open,p.close,p.low)||p.low>Math.min(p.open,p.close))throw new Error(`أسعار أو حجم غير صالح في السطر ${i+2}؛ راجع اتساق أعلى وأدنى سعر.`);
 return p as Price;});return data.sort((a,b)=>a.date.localeCompare(b.date));
}
export function parseFinancialCSV(text:string):Financials{
 const rows=parseCSV(text);if(rows.length<2)throw new Error('الملف المالي فارغ.');const header=rows[0].map(x=>x.toLowerCase());const k=header.indexOf('metric'),v=header.indexOf('value');if(k<0||v<0)throw new Error('استخدم قالب القوائم بعمودي metric,value؛ أو ارفع PDF لاستخراج النص.');
 const out=blankFinancials();let count=0;const seen=new Set<string>();for(const row of rows.slice(1)){const field=FIELDS.find(f=>f.key===row[k]||f.label===row[k]);if(!field)continue;if(seen.has(field.key))throw new Error('بند مالي مكرر: '+field.label);seen.add(field.key);const n=parseNumber(row[v]);if(n===null&&row[v]?.trim())throw new Error('رقم غير صالح: '+field.label);out[field.key]=n;if(n!==null)count++;}if(!count)throw new Error('لم أجد بنودًا مالية قابلة للقراءة.');return out;
}
export function sma(values:number[],n:number):(number|null)[]{let sum=0;return values.map((v,i)=>{sum+=v;if(i>=n)sum-=values[i-n];return i>=n-1?sum/n:null})}
export function ema(values:number[],n:number):(number|null)[]{const out:(number|null)[]=Array(values.length).fill(null);if(values.length<n)return out;let prev=values.slice(0,n).reduce((a,b)=>a+b,0)/n;out[n-1]=prev;for(let i=n;i<values.length;i++){prev=values[i]*2/(n+1)+prev*(1-2/(n+1));out[i]=prev}return out}
export function rsi(values:number[],n=14):(number|null)[]{const out:(number|null)[]=Array(values.length).fill(null);if(values.length<=n)return out;let gain=0,loss=0;for(let i=1;i<=n;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}gain/=n;loss/=n;const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);out[n]=value();for(let i=n+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n;out[i]=value()}return out}
export function atr(p:Price[],n=14):(number|null)[]{const tr=p.map((v,i)=>i?Math.max(v.high-v.low,Math.abs(v.high-p[i-1].close),Math.abs(v.low-p[i-1].close)):v.high-v.low);const out:(number|null)[]=Array(p.length).fill(null);if(p.length<n)return out;let prev=tr.slice(0,n).reduce((a,b)=>a+b,0)/n;out[n-1]=prev;for(let i=n;i<p.length;i++){prev=(prev*(n-1)+tr[i])/n;out[i]=prev}return out}
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const last=<T,>(a:T[]):T|null=>a.length?a[a.length-1]:null;
export function technical(prices:Price[]){
 const close=prices.map(p=>p.close),a50=sma(close,50),a200=sma(close,200),r=rsi(close),a=atr(prices),e12=ema(close,12),e26=ema(close,26);
 const macd=close.map((_,i)=>finite(e12[i])&&finite(e26[i])?e12[i]!-e26[i]!:null);const mvals=macd.filter(finite);const signal=Array(Math.min(25,prices.length)).fill(null).concat(ema(mvals,9)) as (number|null)[];
 const macdHist=macd.map((v,i)=>finite(v)&&finite(signal[i])?v-signal[i]!:null);
 let peak=0,maxDD=0;for(const v of close.slice(-252)){peak=Math.max(peak,v);if(peak>0)maxDD=Math.max(maxDD,(peak-v)/peak*100)}
 const returns=close.slice(1).map((v,i)=>Math.log(v/close[i])).slice(-60);const mu=mean(returns);const vol=returns.length>=20?Math.sqrt(returns.reduce((s,v)=>s+(v-mu!)**2,0)/(returns.length-1))*Math.sqrt(252)*100:null;
 const p=last(prices),avgV20=mean(prices.slice(-20).map(p=>p.volume)),priorV20=prices.length>=40?mean(prices.slice(-40,-20).map(p=>p.volume)):null;
 const history=prices.slice(-122);const lows:number[]=[],highs:number[]=[];for(let i=2;i<history.length-2;i++){const v=history[i],window=history.slice(i-2,i+3);if(window.every(x=>x.low>=v.low))lows.push(v.low);if(window.every(x=>x.high<=v.high))highs.push(v.high)}const below=lows.filter(v=>p&&v<p.close),above=highs.filter(v=>p&&v>p.close);const support=below.length?Math.max(...below):null,resistance=above.length?Math.min(...above):null;
 return {sma50:a50,sma200:a200,rsi:r,atr:a,macd,signal,macdHist,last:p,atrPct:p&&finite(last(a))?last(a)!/p.close*100:null,maxDD:prices.length?maxDD:null,vol,avgV20,turnover:mean(prices.slice(-20).map(p=>p.close*p.volume)),relativeVolume:p&&avgV20&&avgV20>0?p.volume/avgV20:null,volumeRatio:avgV20!==null&&priorV20&&priorV20>0?avgV20/priorV20:null,zeroVolume:prices.length>=20?prices.slice(-20).filter(p=>p.volume===0).length:null,support,resistance};
}
const ratio=(a:number|null,b:number|null)=>finite(a)&&finite(b)&&b>0?a/b:null;
function weighted(f:Factor[]):number|null{const v=f.filter(x=>x.score!==null);return v.length?v.reduce((a,b)=>a+b.score!*b.weight,0)/v.reduce((a,b)=>a+b.weight,0):null}
export function analyze(f:Financials,p:Price[],m:Meta,c:Checks,ev:Events){
 const t=technical(p);const factors:Factor[]=[];
 const add=(key:string,name:string,category:Factor['category'],v:number|null,score:number|null,weight:number,reason:string,rule:string,suffix='')=>factors.push({key,name,category,value:v,display:v===null&&score!==null?'حالة خاصة':fmt(v)+((v!==null)?suffix:''),score:finite(score)?score:null,weight,reason:v===null&&score===null?'البيانات اللازمة لهذا العامل غير مكتملة.':reason,rule});
 const margin=ratio(f.netIncome,f.revenue);add('margin','هامش صافي الربح','financial',margin===null?null:margin*100,margin===null?null:margin<0?90:margin<.05?65:margin<.15?40:20,10,margin!==null&&margin<0?'الشركة تسجل خسارة خلال الفترة.':'يقيس ما يتبقى من الإيراد كربح؛ يتأثر بطبيعة القطاع.','صافي الربح ÷ الإيرادات. درجات 90 / 65 / 40 / 20 عند: <0% / <5% / <15% / ≥15%.','%');
 const growth=finite(f.revenue)&&finite(f.previousRevenue)&&f.previousRevenue>0?(f.revenue/f.previousRevenue-1)*100:null;add('growth','نمو الإيرادات','financial',growth,growth===null?null:growth<-15?85:growth<0?65:growth<10?40:20,10,growth!==null&&growth<0?'تراجعت الإيرادات عن الفترة المقارنة.':'تتطلب المقارنة نفس مدة الفترة ونطاق القوائم.','(إيرادات الفترة ÷ المقارنة − 1) × 100. درجات 85 / 65 / 40 / 20 عند: <−15% / <0% / <10% / ≥10%.','%');
 const de=ratio(f.debt,f.equity);add('de','الدين إلى حقوق المساهمين','financial',de,finite(f.equity)&&f.equity<=0?100:de===null?null:de>2?90:de>1?70:de>.5?45:20,14,'ارتفاع الاعتماد على الدين يزيد حساسية الشركة للتمويل.','الديون التمويلية ÷ حقوق المساهمين. درجات 90 / 70 / 45 / 20 عند: >2 / >1 / >0.5 / ≤0.5؛ حقوق غير موجبة: 100.','×');
 const nd=finite(f.debt)&&finite(f.cash)?f.debt-f.cash:null;const ndE=ratio(nd,f.ebitda);add('nd','صافي الدين إلى EBITDA','financial',ndE,finite(f.ebitda)&&f.ebitda<=0&&finite(nd)&&nd>0?95:ndE===null?null:ndE>4?90:ndE>3?75:ndE>1.5?45:20,14,'يُقارن عبء الدين بصافي النقد والقدرة التشغيلية قبل الاستهلاك.','(الدين − النقد) ÷ EBITDA. درجات 90 / 75 / 45 / 20 عند: >4 / >3 / >1.5 / ≤1.5؛ EBITDA غير موجبة مع صافي دين موجب: 95.','×');
 const cr=ratio(f.currentAssets,f.currentLiabilities);add('current','السيولة الجارية','financial',cr,cr===null?null:cr<.75?90:cr<1?75:cr<1.5?45:20,12,'تقيس تغطية الأصول المتداولة للالتزامات القصيرة.','الأصول المتداولة ÷ الالتزامات المتداولة. درجات 90 / 75 / 45 / 20 عند: <0.75 / <1 / <1.5 / ≥1.5.','×');
 const cc=ratio(f.operatingCashFlow,f.netIncome);add('cash','تحول الأرباح إلى نقد','financial',cc,cc===null?null:cc<0?90:cc<.5?75:cc<1?45:20,14,'ضعف التدفق التشغيلي مقارنة بالأرباح يستلزم مراجعة جودة الأرباح.','التدفق التشغيلي ÷ الربح الموجب. درجات 90 / 75 / 45 / 20 عند: <0 / <0.5 / <1 / ≥1؛ مع خسارة لا يُفسَّر هذا المعدل.','×');
 const fcf=finite(f.operatingCashFlow)&&finite(f.capex)?f.operatingCashFlow-f.capex:null,fcfm=ratio(fcf,f.revenue);add('fcf','هامش النقد الحر','financial',fcfm===null?null:fcfm*100,fcfm===null?null:fcfm<-.1?85:fcfm<0?65:fcfm<.1?40:20,14,'النقد بعد الإنفاق الرأسمالي؛ قد ينخفض مؤقتًا بسبب التوسع.','(التدفق التشغيلي − الإنفاق الرأسمالي) ÷ الإيرادات. درجات 85 / 65 / 40 / 20 عند: <−10% / <0% / <10% / ≥10%.','%');
 const ic=ratio(f.operatingIncome,f.interestExpense);add('interest','تغطية تكلفة التمويل','financial',ic,f.interestExpense===0&&finite(f.operatingIncome)&&f.operatingIncome>0?20:ic===null?null:ic<1?95:ic<2?75:ic<4?45:20,12,'تقارن الأرباح التشغيلية بتكلفة التمويل السنوية.','EBIT ÷ تكلفة التمويل. درجات 95 / 75 / 45 / 20 عند: <1 / <2 / <4 / ≥4؛ تكلفة صفر مع EBIT موجب: 20.','×');
 const pe=ratio(f.marketCap,f.netIncome),peR=ratio(pe,f.peerPE);add('pe','التقييم مقابل النظراء','valuation',peR,f.netIncome!==null&&f.netIncome<=0&&finite(f.marketCap)?85:peR===null?null:peR>2?90:peR>1.5?75:peR>1.1?50:25,100,'مكرر الشركة مقارنة بوسيط نظراء مماثلين؛ الانخفاض وحده لا يثبت رخص السهم.','(القيمة السوقية ÷ ربح 12 شهرًا) ÷ مكرر النظراء. درجات 90 / 75 / 50 / 25 عند: >2 / >1.5 / >1.1 / ≤1.1؛ مع خسارة: 85.','×');
 const lp=t.last?.close??null,s50=last(t.sma50),s200=last(t.sma200);let trend:number|null=null;if(lp!==null&&finite(s50))trend=finite(s200)?(lp<s50&&s50<s200?85:lp>s50&&s50>s200?20:55):55;
 add('trend','اتجاه السعر','technical',s50,trend,30,trend!==null&&trend>=80?'السعر أسفل متوسط 50، ومتوسط 50 أسفل 200 جلسة.':trend===20?'السعر أعلى متوسط 50، ومتوسط 50 أعلى 200 جلسة.':'الاتجاه مختلط أو تاريخ 200 جلسة غير متاح.','درجات 85 للترتيب الهابط؛ 20 للترتيب الصاعد؛ 55 للترتيب المختلط أو غياب متوسط 200.');
 const ap=t.atrPct;add('atr','اتساع الحركة اليومية','technical',ap,ap===null?null:ap>7?95:ap>4?75:ap>2?55:ap>1?30:15,25,'ATR يصف اتساع الحركة بما يشمل الفجوات، ولا يحدد اتجاهها.','ATR(14) بتنعيم Wilder ÷ آخر إغلاق. درجات 95 / 75 / 55 / 30 / 15 عند: >7% / >4% / >2% / >1% / ≤1%.','%');
 const dd=t.maxDD;add('drawdown','أكبر تراجع في النافذة','technical',dd,dd===null?null:dd>40?90:dd>25?75:dd>15?55:dd>5?35:15,20,'أكبر هبوط من قمة إلى قاع لاحق خلال آخر 252 جلسة متاحة.','أكبر تراجع نسبي من قمة سابقة. درجات 90 / 75 / 55 / 35 / 15 عند: >40% / >25% / >15% / >5% / ≤5%.','%');
 const rv=last(t.rsi);add('rsi','تطرف الزخم','technical',rv,rv===null?null:rv>80||rv<20?75:rv>70||rv<30?60:35,15,'القراءات المتطرفة ترفع عدم اليقين؛ ليست أمرًا للتداول.','RSI(14) بطريقة Wilder. درجة 75 خارج 20–80؛ 60 خارج 30–70؛ 35 فيما عدا ذلك.');
 const zv=t.zeroVolume;add('volume','استمرارية السيولة','technical',t.volumeRatio,zv!==null&&zv>0?Math.min(95,65+zv*5):t.volumeRatio===null?null:t.volumeRatio<.4?75:t.volumeRatio<.7?50:25,10,'يقارن متوسط الحجم لآخر 20 جلسة بالعشرين السابقة ويرصد الجلسات بلا تداول.','جلسات بلا حجم: 65 + 5 لكل جلسة، حتى 95؛ وإلا نسبة الحجم <0.4: 75؛ <0.7: 50؛ ما عدا ذلك: 25.','×');
 const eventScore=ev.goingConcern||ev.suspended||ev.adverseAudit?100:ev.qualifiedAudit?80:ev.upcoming?65:20;
 add('events','الأحداث والإفصاحات','events',c.events?eventScore:null,c.events?eventScore:null,100,'يعتمد هذا المحور على الوقائع التي راجعها المستخدم وأثبتها.','الاستمرارية/التعليق/رأي سلبي: 100؛ رأي متحفظ: 80؛ حدث قريب: 65؛ لا حدث ضمن البنود المراجعة: 20.');
 const fin=factors.filter(f=>f.category==='financial'),finN=fin.filter(f=>f.score!==null).length;
 const scores={financial:weighted(fin),technical:weighted(factors.filter(f=>f.category==='technical')),valuation:weighted(factors.filter(f=>f.category==='valuation')),events:c.events?eventScore:null};
 const blockers:string[]=[],warnings:string[]=[];const as=m.asOf;
 if(!c.financial)blockers.push('راجع الأرقام والفترة والوحدة واعتمد البيانات المالية.');
 if(!c.prices)blockers.push('راجع بيانات الأسعار وتعديلات الإجراءات الرأسمالية واعتمدها.');
 if(!c.events)blockers.push('راجع أحدث الإفصاحات والأحداث الجوهرية.');
 if(!m.name.trim()||!m.symbol.trim())blockers.push('أدخل اسم الشركة ورمز الورقة المالية.');
 if(!m.financialSource.trim()||!m.priceSource.trim())blockers.push('سجّل مصدر القوائم ومصدر الأسعار.');
 if(m.sector!=='general')blockers.push('هذا القطاع يحتاج نموذجًا متخصصًا؛ الحساب العام لا يصدر له تصنيفًا.');
 if(m.period==='interim')blockers.push('يلزم تجميع آخر 12 شهرًا أو سنة كاملة قبل إصدار التصنيف؛ لا تُسنون الأرباح الفصلية تلقائيًا.');
 if(finN<7)blockers.push(`العوامل المالية المتاحة ${finN} من 8؛ يلزم 7 على الأقل.`);
 if(p.length<60)blockers.push('يلزم تاريخ يومي لا يقل عن 60 جلسة، والأفضل 200 جلسة.');
 if(m.currency!==m.priceCurrency)blockers.push('عملة القوائم تختلف عن عملة السعر؛ وحّد العملة والقيمة السوقية أولًا.');
 if(!validDate(as))blockers.push('تاريخ التقييم غير صالح.');else if(ageDays(as,today())>0)blockers.push('لا يمكن إصدار تقييم كما لو كانت البيانات المستقبلية متاحة.');
 if(!validDate(m.periodEnd)||!validDate(m.publishedAt))blockers.push('حدّد تاريخ نهاية الفترة وتاريخ نشر القوائم.');
 else if(validDate(as)){if(ageDays(m.publishedAt,m.periodEnd)<0)blockers.push('تاريخ النشر يسبق نهاية الفترة.');if(ageDays(as,m.publishedAt)<0||ageDays(as,m.periodEnd)<0)blockers.push('القوائم لم تكن متاحة في تاريخ التقييم.');if(ageDays(as,m.periodEnd)>550)blockers.push('الفترة المالية قديمة جدًا لهذا التقييم (أكثر من 550 يومًا).');else if(ageDays(as,m.periodEnd)>240)warnings.push('نهاية الفترة المالية مضى عليها أكثر من 240 يومًا.');}
 if(p.length&&validDate(as)){if(p.some(v=>ageDays(as,v.date)<0))blockers.push('الأسعار تتضمن جلسات لاحقة لتاريخ التقييم.');if(ageDays(as,p[p.length-1].date)>7)blockers.push('آخر سعر أقدم من 7 أيام تقويمية؛ حدّث الأسعار أو اختر تاريخ تقييم تاريخيًا.');}
 for(const k of ['assets','liabilities','debt','cash','currentAssets','currentLiabilities','interestExpense','capex','marketCap','dividends'])if(finite(f[k])&&f[k]!<0)blockers.push(`قيمة سالبة غير مقبولة في «${FIELDS.find(v=>v.key===k)?.label}».`);
 if(finite(f.assets)&&finite(f.liabilities)&&finite(f.equity)&&Math.abs(f.assets-f.liabilities-f.equity)>Math.max(Math.abs(f.assets)*.02,.001))blockers.push('الأصول لا تساوي الالتزامات + حقوق المساهمين ضمن هامش 2%؛ راجع النطاق والوحدة وحقوق الأقلية.');
 if(finite(f.currentAssets)&&finite(f.assets)&&f.currentAssets>f.assets)blockers.push('الأصول المتداولة أكبر من إجمالي الأصول.');
 if(finite(f.currentLiabilities)&&finite(f.liabilities)&&f.currentLiabilities>f.liabilities)blockers.push('الالتزامات المتداولة أكبر من إجمالي الالتزامات.');
 if(p.length>1){const gap=p.slice(1).some((v,i)=>Math.abs(v.close/p[i].close-1)>.4);if(gap)warnings.push('تغير يومي يتجاوز 40%: راجع التجزئة والحقوق والتوزيعات وسلامة السلسلة.');}
 if(p.length>=60&&p.length<200)warnings.push('متوسط 200 جلسة غير متاح؛ الاتجاه طويل الأجل غير مكتمل.');
 if(scores.valuation===null)warnings.push('التقييم النسبي غير مكتمل؛ يلزم ربح 12 شهرًا وقيمة سوقية ومكرر نظراء موثّق.');
 if(finite(f.peerPE)&&f.peerPE>0&&!m.peerSource.trim())warnings.push('مصدر مقارنة النظراء غير موثق.');
 if(finN<8)warnings.push('عامل مالي واحد على الأقل غير متاح.');

 const shariaValid=m.shariaStatus!=='unknown'&&m.shariaSource.trim()&&validDate(m.shariaDate)&&validDate(as)&&ageDays(as,m.shariaDate)>=0&&ageDays(as,m.shariaDate)<=180;
 const sharia=shariaValid?(m.shariaStatus==='compliant'?'متوافق بحسب المرجع المدخل':'غير متوافق بحسب المرجع المدخل'):'لم يُحسم — يلزم مرجع حديث';
 const critical=ev.suspended||ev.goingConcern||ev.adverseAudit||finite(f.equity)&&f.equity<=0;
 const missingCritical=scores.valuation===null||finN<8||p.length<200||!!(finite(f.peerPE)&&!m.peerSource.trim())||warnings.some(w=>w.includes('240')||w.includes('40%'));
 function composite(mode:'trader'|'investor'){
  if(blockers.length)return null;
  const w=mode==='trader'?{financial:.2,technical:.55,valuation:.1,events:.15}:{financial:.55,technical:.15,valuation:.2,events:.1};
  // Missing factors get a neutral-risk imputation, never a zero-risk bonus.
  let total=Object.entries(w).reduce((sum,[key,weight])=>sum+(scores[key as keyof typeof scores]??60)*weight,0);
  if(missingCritical)total=Math.max(total,40);
  if(critical)total=Math.max(total,85);else if(ev.qualifiedAudit)total=Math.max(total,65);
  return Math.round(Math.min(100,Math.max(0,total)));
 }
 const available=factors.filter(f=>f.score!==null).length;const coverage=Math.round(available/factors.length*100);
 return {factors,scores,technical:t,blockers:[...new Set(blockers)],warnings,coverage,trader:composite('trader'),investor:composite('investor'),sharia,critical,pe,fcf,dividendYield:finite(f.dividends)&&finite(f.marketCap)&&f.marketCap>0?f.dividends/f.marketCap*100:null,financialCount:finN,version:'1.0.0'};
}
export function makeDemo(){
 const m=blankMeta();Object.assign(m,{name:'شركة المثال الصناعية',symbol:'DEMO',financialSource:'قوائم مصطنعة للتجربة',priceSource:'سلسلة يومية مصطنعة للتجربة',peerSource:'نظير افتراضي للتجربة',publishedAt:'2026-08-10',periodEnd:'2026-06-30',period:'ttm',asOf:today()});
 const f:Financials={revenue:1250,previousRevenue:1110,netIncome:142,operatingIncome:208,ebitda:260,equity:950,assets:1850,liabilities:900,debt:570,cash:180,currentAssets:670,currentLiabilities:420,interestExpense:42,operatingCashFlow:174,capex:120,marketCap:2580,peerPE:16,dividends:90};
 const dates:string[]=[];let d=new Date(today()+'T00:00:00Z');while(dates.length<260){if(d.getUTCDay()!==5&&d.getUTCDay()!==6)dates.unshift(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()-1)}
 let close=39.2;const prices:Price[]=dates.map((date,i)=>{const open=close*(1+.006*Math.sin(i*2.7));close=Math.max(1,close*(1+.0011+.012*Math.sin(i*.71)-.004*Math.cos(i*.19)));if(i>235)close*=.997;return {date,open:+open.toFixed(2),close:+close.toFixed(2),high:+(Math.max(open,close)*(1+.007+Math.abs(Math.sin(i))*.008)).toFixed(2),low:+(Math.min(open,close)*(1-.007-Math.abs(Math.cos(i))*.008)).toFixed(2),volume:Math.round(650000+280000*(1+Math.sin(i*.63))+(i%7)*13000)}});
 return {meta:m,financials:f,prices,checks:{financial:true,prices:true,events:true},events:blankEvents()};
}
