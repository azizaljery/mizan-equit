import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const temp=await mkdtemp(join(tmpdir(),'mizan-tests-'));
let code=1;
try{const target=join(temp,'analysis.mjs');const build=spawnSync('node_modules/.bin/esbuild',['tests/export.ts','--bundle','--jsx=automatic','--banner:js=import {createRequire} from "node:module"; const require=createRequire(import.meta.url);','--alias:cloudflare:workers=./tests/runtime-env.ts','--platform=node','--format=esm',`--outfile=${target}`],{stdio:'inherit'});if(build.status===0){const test=spawnSync(process.execPath,['--test','tests/calculations.test.mjs','tests/background-jobs.test.mjs','tests/state-backtest.test.mjs','tests/maintenance-additions.test.mjs','tests/championship.test.mjs','tests/source-infrastructure.test.mjs','tests/forecast-conditions.test.mjs','tests/forecast-conformal.test.mjs','tests/sources-audit.test.mjs'],{stdio:'inherit',env:{...process.env,MIZAN_TEST_MODULE:pathToFileURL(target).href}});code=test.status??1}else code=build.status??1}finally{await rm(temp,{recursive:true,force:true})}process.exitCode=code;
