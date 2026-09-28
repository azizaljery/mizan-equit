// Run only for explicitly requested isolated browser QA; remove the two generated files before building.
import {writeFile,access,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const file of ['public/__mizan-qa.html','public/__mizan-qa.js']){try{await access(file);throw Error('QA output already exists: '+file)}catch(e){if(e.code!=='ENOENT')throw e;}}
const entry=process.argv[2]==='forecast-tests'?'tests/forecast-tests-browser-harness.tsx':'tests/browser-harness.tsx';
const result=spawnSync('node_modules/.bin/esbuild',[entry,'--bundle','--jsx=automatic','--format=esm','--platform=browser','--outfile=public/__mizan-qa.js'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
const productCss=(await readFile('app/globals.css','utf8')).replace(/^@import[^;]+;/gm,'');
await writeFile('public/__mizan-qa.html','<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>اختبار ميزان المعزول</title><style>'+productCss+'</style><style>'+(process.argv[2]==='forecast-tests'?'':'body{font:18px sans-serif;max-width:1100px;margin:40px auto;padding:20px}button{padding:14px;margin:8px}section,article,details{border:1px solid #ccc;padding:18px;margin:12px}svg{max-width:100%}.help-popover{position:fixed;bottom:20px;right:20px;max-width:360px;background:white;box-shadow:0 0 0 3px #153d2e;padding:20px;z-index:100}.metric-grid{display:flex;gap:18px;flex-wrap:wrap}')+'</style><div id="root"></div><script type="module" src="/__mizan-qa.js"></script></html>');
