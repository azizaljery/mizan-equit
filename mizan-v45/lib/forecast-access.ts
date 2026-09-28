import {fingerprint} from './evidence-ledger';
export async function forecastAccount(headers:Headers){const identity=headers.get('oai-authenticated-user-id');return identity?fingerprint('mizan-tests:'+identity):null;}
export function canReadForecast(row:any,account:string|null,owner:boolean){const d=typeof row.data==='string'?JSON.parse(row.data):row.data;return d.recordClass==='prospective-public'||!!account&&d.accountKey===account||owner&&!d.recordClass&&!d.accountKey;}

/** Apply visibility before LIMIT; other accounts cannot crowd out public records. */
export function forecastVisibilitySql(account:string|null,owner:boolean){return {clause:"(json_extract(f.data,'$.recordClass')='prospective-public' OR (? IS NOT NULL AND json_extract(f.data,'$.accountKey')=?) OR (?=1 AND json_extract(f.data,'$.recordClass') IS NULL AND json_extract(f.data,'$.accountKey') IS NULL))",args:[account,account,owner?1:0]};}
