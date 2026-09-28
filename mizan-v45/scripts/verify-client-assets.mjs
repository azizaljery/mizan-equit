import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const manifest=await readFile(resolve(root,'dist/server/__vite_rsc_assets_manifest.js'),'utf8');
const paths=[...new Set([...manifest.matchAll(/\/assets\/[A-Za-z0-9_.-]+/g)].map(m=>m[0]))];
if(!paths.length)throw Error('No client asset references found in the server manifest.');
for(const path of paths)await access(resolve(root,'dist/client'+path));
console.log('Verified '+paths.length+' server-referenced client assets.');
