const fs=require('fs'),N=require('/home/claude/mizan-equit/research/experiments/negsel-lib.cjs');
const L='/tmp/claude-0/built';const {forecasts}=require(L+'/lib/research-model');const {DEFAULT_SETTINGS}=require(L+'/lib/site-settings');
const sym=process.argv[2]||'1120.SR';
const d=JSON.parse(fs.readFileSync('/tmp/claude-0/rd/research-data/prices/'+sym+'.json'));
const prices=N.cutRows(d.rows,'2024-09-04').map(r=>({date:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]}));
const asOf=prices.at(-1).date;
const slice={company:{symbol:sym,name:sym,exchange:'SAU',instrument:'EQUITY'},asOf,retrievedAt:asOf+'T20:00:00Z',prices,priceSource:'research-data',quoteTime:null,currency:d.currency,facts:[],official:null,news:[],peers:[],checks:[],warnings:[],mode:'historical',context:{market:null,sector:null}};
fs.writeFileSync('data.json',JSON.stringify(forecasts(slice,null,Date.parse(asOf+'T20:00:00Z'),DEFAULT_SETTINGS)));
