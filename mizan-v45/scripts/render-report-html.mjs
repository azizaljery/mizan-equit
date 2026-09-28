#!/usr/bin/env node
import {resolve,dirname,join} from 'node:path';
import {readReport,saveReport,renderHtml} from './verification-report.mjs';
try{const input=process.env.MIZAN_REPORT_PATH;if(!input)throw Error('حدد MIZAN_REPORT_PATH لمسار تقرير JSON الناتج.');const output=process.env.MIZAN_HTML_PATH||join(dirname(resolve(input)),'run-all-checks.html');await saveReport(output,renderHtml(await readReport(input)));console.log('HTML: '+resolve(output));}catch(error){console.error(error.message);process.exitCode=2;}
