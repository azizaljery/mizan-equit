#!/usr/bin/env node
import {adminRequest} from './admin-http.mjs';
try{
 const raw=process.argv[2]||'10';
 if(process.argv.length>3||!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>20)throw Error('الاستخدام: node scripts/aggregate-backtests.mjs [1..20]');
 console.log(JSON.stringify(await adminRequest('/api/admin/backtest/aggregate?limit='+raw),null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
