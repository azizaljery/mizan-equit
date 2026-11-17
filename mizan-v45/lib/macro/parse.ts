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
/** Yahoo chart JSON: daily closes. Bars dated on or after `beforeDate` (today, still forming) and null closes are skipped, never filled. */
export function parseYahooChart(json:any,seriesId:string,sinceDate='1900-01-01',beforeDate='9999-12-31'):MacroRow[]{
 const r=json?.chart?.result?.[0],ts=r?.timestamp,close=r?.indicators?.quote?.[0]?.close;
 if(!Array.isArray(ts)||!Array.isArray(close))return [];
 const off=Number(r?.meta?.gmtoffset)||0,out:MacroRow[]=[];
 for(let i=0;i<ts.length;i++){
  const t=Number(ts[i]),v=close[i];if(!Number.isFinite(t)||t<=0||v===null||v===undefined)continue;
  const n=Number(v);if(!Number.isFinite(n))continue;
  const date=new Date((t+off)*1000).toISOString().slice(0,10);
  if(date<sinceDate||date>=beforeDate)continue;
  out.push({seriesId,date,value:n});
 }
 return out;
}
/** FRED API JSON -> the same CSV shape as the graph download, so one parser serves both. Non-numeric values ('.') stay '.' and are skipped later. */
export function fredApiToCsv(json:any,seriesId:string):string{
 const obs=Array.isArray(json?.observations)?json.observations:[];
 return `observation_date,${seriesId}\n`+obs.map((o:any)=>`${String(o?.date??'')},${String(o?.value??'')}`).join('\n')+'\n';
}
/** NY Fed reference-rate JSON: `refRates` (or a bare array) of {effectiveDate, percentRate}. Missing rates are skipped. */
export function parseNyFedRates(json:any,seriesId:string,sinceDate='1900-01-01'):MacroRow[]{
 const list=Array.isArray(json?.refRates)?json.refRates:Array.isArray(json)?json:[];
 const out:MacroRow[]=[];
 for(const r of list){const d=String(r?.effectiveDate??'');if(!DATE.test(d)||d<sinceDate||r?.percentRate===null||r?.percentRate===undefined)continue;const n=Number(r.percentRate);if(Number.isFinite(n))out.push({seriesId,date:d,value:n});}
 return out;
}
