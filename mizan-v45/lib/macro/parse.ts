export type MacroRow={seriesId:string;date:string;value:number};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
/** FRED graph CSV: `observation_date,<ID>` then `YYYY-MM-DD,value`. Missing observations are empty or '.'; they are skipped, never filled. */
export function parseFredCsv(text:string,seriesId:string,sinceDate='1900-01-01'):MacroRow[]{
 const lines=String(text||'').split(/\r?\n/);
 if(lines.length<2||!/^observation_date,/i.test(lines[0])||lines[0].split(',')[1]?.trim()!==seriesId)return [];
 const out:MacroRow[]=[];
 for(const line of lines.slice(1)){const [d,v]=line.split(',');if(!d||!DATE.test(d)||d<sinceDate)continue;const t=(v??'').trim();if(t===''||t==='.')continue;const n=Number(t);if(Number.isFinite(n))out.push({seriesId,date:d,value:n});}
 return out;
}
/** World Bank v2 JSON: [meta, rows]; annual `date` is the year, stored as YYYY-12-31. Null values are skipped. */
export function parseWorldBank(json:unknown,seriesId:string):MacroRow[]{
 if(!Array.isArray(json)||!Array.isArray(json[1]))return [];
 const out:MacroRow[]=[];
 for(const r of json[1] as any[]){const y=String(r?.date??'');if(!/^\d{4}$/.test(y)||r?.value===null||r?.value===undefined)continue;const n=Number(r.value);if(Number.isFinite(n))out.push({seriesId,date:`${y}-12-31`,value:n});}
 return out;
}
