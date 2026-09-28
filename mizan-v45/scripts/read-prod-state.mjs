#!/usr/bin/env node
import {adminRequest} from './admin-http.mjs';
// MIZAN_COOKIE must include the actual hosting login AND mizan_admin session.
// list/keys [offset] [limit]; exists id; fields id names; slices id [offset] [length] [updatedAt]
try {
  const [, , mode = 'list', ...rest] = process.argv;
  const query = new URLSearchParams({mode});
  if (['list','keys'].includes(mode)) { if (rest.length > 2) throw Error('وسائط زائدة.'); query.set('offset',rest[0] ?? '0'); query.set('limit',rest[1] ?? '20'); }
  else if (['exists','fields','slices'].includes(mode)) {
    if (!rest[0]) throw Error('id مطلوب.'); query.set('id',rest[0]);
    if (mode === 'exists' && rest.length > 1) throw Error('وسائط زائدة.');
    if (mode === 'fields') { if (!rest[1] || rest.length > 2) throw Error('fields مطلوب، دون وسائط زائدة.'); query.set('fields',rest[1]); }
    if (mode === 'slices') { if (rest.length > 4) throw Error('وسائط زائدة.'); query.set('offset',rest[1] ?? '0'); query.set('length',rest[2] ?? '4000'); if (rest[3]) query.set('updatedAt',rest[3]); }
  } else throw Error('استخدم list | keys | exists | fields | slices.');
  console.log(JSON.stringify(await adminRequest('/api/admin/state?' + query), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
