#!/usr/bin/env node
import {adminRequest} from './admin-http.mjs';
import {privateChecks} from './verification-checks.mjs';
// Not read-only: opening the existing recommendation can save a new forecast.
// Uses the authenticated owner session; no recommendation PIN is required.
try{
  if(process.argv.length!==3||process.argv[2]!=='--run')throw Error('استخدم --run لتأكيد تجربة التوصية؛ قد يحفظ المسار توقعًا جديدًا.');
  const symbol=process.env.MIZAN_SYMBOL;
  if(!symbol||!/^([A-Z][A-Z0-9.-]{0,14}|\d{4,5}\.SR)$/.test(symbol))throw Error('اضبط MIZAN_SYMBOL وجلسة المالك محليًا.');
  const search=await adminRequest('/api/company/search?'+new URLSearchParams({q:symbol,market:'auto'}));
  const exact=Array.isArray(search.companies)&&search.companies.some(c=>c.symbol===symbol);
  const rec=await adminRequest('/api/private-recommendation',{method:'POST',body:{action:'view',symbol}});
  const checks={search:exact,...privateChecks(rec,symbol)};
  console.log(JSON.stringify({symbol,ok:Object.values(checks).every(Boolean),checks,scope:'نجاح استجابة المسار لا يثبت دقة القرار الاستثمارية أو اكتمال اختبار المتصفح.'},null,2));
  process.exitCode=Object.values(checks).every(Boolean)?0:3;
}catch(error){console.error(error.message);process.exitCode=2;}
