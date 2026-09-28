#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {adminRequest} from './admin-http.mjs';
import {backtestOk} from './verification-checks.mjs';
// single START END SYMBOL...; walk-forward CONFIG.json (explicit windows, no invented defaults).
try {
  const [, , mode,...args]=process.argv;let body;
  if(mode==='single'){
    const [startDate,endDate,...symbols]=args;if(!startDate||!endDate||!symbols.length)throw Error('single START END SYMBOL...');
    body={mode,runId:process.env.MIZAN_RUN_ID??crypto.randomUUID(),symbols,startDate,endDate,horizons:[5,21,63,126,252]};
  }else if(mode==='walk-forward'){
    if(args.length!==1)throw Error('walk-forward CONFIG.json');
    const raw=await readFile(args[0]);if(raw.byteLength>12000)throw Error('الإعداد أكبر من الحد.');
    const config=JSON.parse(raw.toString('utf8'));if(!config||typeof config!=='object'||Array.isArray(config))throw Error('إعداد غير صالح.');
    body={...config,mode,runId:process.env.MIZAN_RUN_ID??config.runId??crypto.randomUUID()};
  }else throw Error('استخدم single أو walk-forward.');
  const result=await adminRequest('/api/admin/backtest',{method:'POST',body});
  console.log(JSON.stringify(result,null,2));
  const ok=mode==='single'?backtestOk(result):result?.kind==='mizan-issued-forecast-windows-v1'&&result.persisted===true&&Array.isArray(result.windows)&&result.windows.length>0&&result.windows.every(w=>backtestOk(w.result));
  if(!ok)process.exitCode=3;
}catch(error){console.error(error.message);process.exitCode=1;}
