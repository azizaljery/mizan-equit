import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';
import {forecasts} from '@/lib/research-model';
import {DEFAULT_SETTINGS} from '@/lib/site-settings';
import {Forecasts} from '@/components/forecasts';
import {AccuracySampleTable} from '@/components/accuracy-sample';
import {UnprovenEdgeNote,EngineConfidenceBadge} from '@/components/engine-notice';

const raw=JSON.parse(fs.readFileSync(process.env.PRICES_JSON as string,'utf8'));
const sym=raw.symbol as string;
const mk=(rows:any[])=>rows.map(r=>({date:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]})).filter(p=>p.date<='2024-09-04');
const report=(prices:any[])=>({company:{symbol:sym,name:sym,exchange:'SAU',instrument:'EQUITY'},asOf:prices.at(-1).date,retrievedAt:prices.at(-1).date+'T20:00:00Z',prices,priceSource:'research-data',quoteTime:null,currency:raw.currency,facts:[],official:null,news:[],peers:[],checks:[],warnings:[],mode:'historical',context:{market:null,sector:null}} as any);
const ok=report(mk(raw.rows));const now=Date.parse(ok.asOf+'T20:00:00Z');
const good=forecasts(ok,null,now,DEFAULT_SETTINGS);
const badPrices=mk(raw.rows);badPrices[badPrices.length-1]={...badPrices[badPrices.length-1],date:badPrices[badPrices.length-2].date};
const bad=forecasts(report(badPrices),null,now,DEFAULT_SETTINGS);
const row=good.rows[1] as any;
const sample={run:{period:'أسبوع',sessions:5,date:ok.asOf},rows:[{id:'a',ordinal:1,symbol:sym,company:{name:sym},state:'complete',forecast:{available:true,direction:row.direction,range:row.range,currency:raw.currency,confidence:row.confidence,price:row.price,priceTime:ok.asOf,anchorDate:ok.asOf,scenarios:row.scenarios},outcome:{state:'complete',actualPrice:row.price*1.01,actualDate:ok.asOf,changePct:1,periodLow:row.price*.98,periodHigh:row.price*1.03,matchPct:80,directionCorrect:true,rangeHit:true,nearRangePct:0,baseHit:true,formula:'—',source:'research-data',retrievedAt:ok.asOf}},{id:'b',ordinal:2,symbol:'X.SR',company:{name:'X'},state:'unavailable',forecast:null,outcome:null}]};
const sec=(t:string,n:string,el:React.ReactElement)=>`<section data-shot="${n}"><p class="shot-caption">${t}</p>${renderToStaticMarkup(el)}</section>`;
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="site.css"><style>.shot-caption{font:12px monospace;direction:ltr;color:#666;margin:16px 0 4px}</style></head><body><main class="workspace" dir="rtl">`
+sec('available forecast (real engine, '+sym+' prices cut 2024-09-04)','available',<Forecasts data={good as any}/>)
+sec('abstention (same data, last session date duplicated -> price_series_invalid)','abstention',<Forecasts data={bad as any}/>)
+sec('accuracy-sample table row (engine direction + neutral internal label)','accuracy',<AccuracySampleTable data={sample as any}/>)
+sec('shared notice + badge (picks / screener)','notice',<><UnprovenEdgeNote sessions={5}/><UnprovenEdgeNote sessions={63}/><UnprovenEdgeNote/><EngineConfidenceBadge value="متوسط"/></>)
+`</main></body></html>`;
fs.writeFileSync(process.env.OUT_HTML as string,html);
