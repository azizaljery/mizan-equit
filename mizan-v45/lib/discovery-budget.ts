export const SEARCH_CONFIG_ID='research:settings:v1';
export type DiscoverySettings={enabled:boolean;monthlyCap:number;maxSearches:number;maxReads:number;};
export const DISCOVERY_DEFAULTS:DiscoverySettings={enabled:true,monthlyCap:1000,maxSearches:2,maxReads:3};
export async function readDiscoverySettings(db:any):Promise<DiscoverySettings>{const row=await db.prepare('SELECT data FROM research_state WHERE id=?').bind(SEARCH_CONFIG_ID).first();return row?validateDiscoverySettings(JSON.parse(row.data)):DISCOVERY_DEFAULTS;}
export function validateDiscoverySettings(v:any):DiscoverySettings{if(typeof v?.enabled!=='boolean'||!Number.isInteger(v.monthlyCap)||v.monthlyCap<0||v.monthlyCap>1000||!Number.isInteger(v.maxSearches)||v.maxSearches<0||v.maxSearches>2||!Number.isInteger(v.maxReads)||v.maxReads<0||v.maxReads>3)throw Error('الحد الشهري 0–1000، وبحد أقصى بحثين وثلاث قراءات لكل تحليل.');return {enabled:v.enabled,monthlyCap:v.monthlyCap,maxSearches:v.maxSearches,maxReads:v.maxReads};}
/** Retain the legacy budget key prefix so an upgrade never resets spent quota.
 * Reservation is atomic across Workers; ambiguous failures retain the reservation. */
export async function reserveSearch(db:any,cap:number,now=Date.now()){
 const month=new Date(now).toISOString().slice(0,7),id='tavily-keyless:'+month;
 if(cap<1)return false;
 const row=await db.prepare('INSERT INTO research_budgets(id,reserved,reported,updated_at) VALUES(?,1,0,?) ON CONFLICT(id) DO UPDATE SET reserved=reserved+1,updated_at=excluded.updated_at WHERE reserved<? RETURNING reserved').bind(id,new Date(now).toISOString(),cap).first();return !!row;
}
export async function recordSearchUsage(db:any,credits:unknown,now=Date.now()){if(typeof credits!=='number'||!Number.isFinite(credits)||credits<0)return;await db.prepare('UPDATE research_budgets SET reported=reported+? WHERE id=?').bind(credits,'tavily-keyless:'+new Date(now).toISOString().slice(0,7)).run();}
