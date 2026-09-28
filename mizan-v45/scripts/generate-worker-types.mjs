// Generate from the installed, pinned Wrangler version after `npm run build`.
// Scope Worker web globals away from the mixed React DOM / server TS project.
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
const file = 'worker-runtime.d.ts';
const result = spawnSync('node_modules/.bin/wrangler', ['types', file, '--config', 'dist/server/wrangler.json', '--include-env', 'false'], {stdio: 'inherit'});
if (result.status !== 0) process.exit(result.status ?? 1);
let source = readFileSync(file, 'utf8');
if (!source.includes('interface Env {')) throw Error('Wrangler runtime shape changed; review generated types.');
source = source.replace('interface Env {', 'interface Env {\n        DB: D1Database;');
source = source.replace('/* eslint-disable */', '/* eslint-disable */\n// Module-scoped so Worker web globals do not replace DOM types in the React app.\nexport {};');
writeFileSync(file, source);
