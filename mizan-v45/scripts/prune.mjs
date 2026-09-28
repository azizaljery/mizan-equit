#!/usr/bin/env node
// Compatibility name: preview only. This script never deletes data.
import {adminRequest} from './admin-http.mjs';
try{
 if(process.argv.length>2)throw Error('هذا الأمر يعرض معاينة الاحتفاظ فقط، دون حذف.');
 console.log(JSON.stringify(await adminRequest('/api/admin/retention'),null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
