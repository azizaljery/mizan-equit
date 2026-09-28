#!/usr/bin/env node
import {resolve,dirname,join} from 'node:path';
import {readReport,saveReport,renderMarkdown} from './verification-report.mjs';
try{const input=process.env.MIZAN_REPORT_PATH;if(!input)throw Error('حدد MIZAN_REPORT_PATH لمسار تقرير JSON الناتج.');const output=process.env.MIZAN_MD_PATH||join(dirname(resolve(input)),'run-all-checks.md');await saveReport(output,renderMarkdown(await readReport(input)));console.log('Markdown: '+resolve(output));}catch(error){console.error(error.message);process.exitCode=2;}
