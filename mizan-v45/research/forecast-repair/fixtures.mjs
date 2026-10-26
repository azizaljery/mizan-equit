// SYNTHETIC TEST DATA ONLY. Dates use weekday proxies, not verified exchange calendars.
export const AS_OF='2026-10-26',NOW=Date.parse(AS_OF+'T20:00:00Z');
export function syntheticReport({id='TEST_US_CALM',count=420,drift=.0003,amplitude=.004,shock=0,market='us'}={}){
 const dates=[];let day=new Date(AS_OF+'T00:00:00Z');
 while(dates.length<count){const d=day.getUTCDay();if(market==='sa'?d!==5&&d!==6:d!==0&&d!==6)dates.unshift(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()-1);}
 let close=100;const prices=dates.map((date,i)=>{close*=Math.exp(drift+amplitude*Math.sin(i*1.71));if(i===count-1)close*=Math.exp(shock);return {date,open:close,high:close*1.001,low:close*.999,close,volume:1000000+100000*Math.sin(i)};});
 const symbol=market==='sa'?id+'.SR':id;
 return {fixtureKind:'synthetic',fixtureId:id,company:{symbol,name:'SYNTHETIC TEST ONLY '+id,exchange:market==='sa'?'SAU':'NASDAQ',sector:'Test',industry:'Test',source:'synthetic://fixture'},currency:market==='sa'?'SAR':'USD',asOf:AS_OF,retrievedAt:new Date(NOW).toISOString(),quoteTime:null,priceSource:'synthetic://fixture',prices,facts:[],official:null,news:[],peers:[],checks:[{name:'الأسعار اليومية',state:'ok'}],warnings:['SYNTHETIC: لا تمثل سهمًا حقيقيًا ولا دليل دقة'],mode:'historical'};
}
export function diagnosticCases(defaultSettings){
 const cases=[];const add=(id,report,settings={})=>cases.push({id,kind:'synthetic',report,settings:{...structuredClone(defaultSettings),...settings},now:NOW});
 add('calm',syntheticReport());
 add('shock',syntheticReport({id:'TEST_SA_SHOCK',market:'sa',shock:-.025}));
 add('wide_range_policy',syntheticReport({id:'TEST_US_RANGE'}),{maxSigma:1});
 add('insufficient_history',syntheticReport({id:'TEST_US_SHORT',count:10}));
 const duplicate=syntheticReport({id:'TEST_SA_DUPLICATE',market:'sa'});duplicate.prices[20].date=duplicate.prices[19].date;add('duplicate_session',duplicate);
 const stale=syntheticReport({id:'TEST_US_STALE'});stale.prices=stale.prices.slice(0,-40);add('stale_history',stale);
 add('zero_volatility',syntheticReport({id:'TEST_US_FLAT',drift:0,amplitude:0}));
 add('uptrend',syntheticReport({id:'TEST_US_UP',drift:.0015}));
 add('downtrend',syntheticReport({id:'TEST_SA_DOWN',market:'sa',drift:-.0015}));
 return cases;
}
