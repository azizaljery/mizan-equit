import {MACRO_SERIES,FRED_URL,WB_URL,YAHOO_URL,NYFED_URL,type MacroSeries} from './series';
import {parseFredCsv,parseWorldBank,parseYahooChart,parseNyFedRates,type MacroRow} from './parse';

export type MacroSummary={series:{id:string;fetched:number;inserted:number;error?:string}[];inserted:number};
const INSERT=`INSERT OR IGNORE INTO macro_observations(id,series_id,obs_date,value,source,source_url,retrieved_at,availability_basis) VALUES(?,?,?,?,?,?,?,'retrieval_time_only')`;
const errorText=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,160);

/** Fetches every catalogued series, keeps observations since `sinceDate`, and appends only values not already stored (a revision is a new row). One failing series never stops the others. */
export async function collectMacro(db:any,now:number,fetchText:(url:string)=>Promise<string>,opts:{sinceDate?:string;series?:MacroSeries[]}={}):Promise<MacroSummary>{
 const since=opts.sinceDate??'2024-01-01',iso=new Date(now).toISOString(),sum:MacroSummary={series:[],inserted:0};
 for(const s of opts.series??MACRO_SERIES){
  const item={id:s.id,fetched:0,inserted:0} as MacroSummary['series'][number];sum.series.push(item);
  try{
   const url=s.provider==='fred'?FRED_URL(s.id):s.provider==='yahoo'?YAHOO_URL(s.id):s.provider==='nyfed'?NYFED_URL(s.id):WB_URL(s.id),text=await fetchText(url);
   const rows:MacroRow[]=s.provider==='fred'?parseFredCsv(text,s.id,since):s.provider==='yahoo'?parseYahooChart(JSON.parse(text),s.id,since,iso.slice(0,10)):s.provider==='nyfed'?parseNyFedRates(JSON.parse(text),s.id,since):parseWorldBank(JSON.parse(text),s.id).filter(r=>r.date>=since);
   item.fetched=rows.length;
   if(!rows.length){item.error='no_rows';continue;}
   for(let i=0;i<rows.length;i+=90){
    const part=rows.slice(i,i+90),res=await db.batch(part.map((r:MacroRow)=>db.prepare(INSERT).bind(`${r.seriesId}|${r.date}|${r.value}`,r.seriesId,r.date,r.value,s.provider,url,iso)));
    for(const x of res||[])item.inserted+=Number(x?.meta?.changes??0);
   }
   sum.inserted+=item.inserted;
  }catch(e){item.error=errorText(e);}
 }
 return sum;
}
/** Latest value per series (by obs_date, then newest retrieval) with the previous distinct observation, for display. */
export async function latestMacro(db:any){
 const out:any[]=[];
 for(const s of MACRO_SERIES){
  const r=(await db.prepare(`SELECT obs_date,value,retrieved_at FROM macro_observations WHERE series_id=? ORDER BY obs_date DESC,retrieved_at DESC LIMIT 12`).bind(s.id).all()).results||[];
  const seen=new Set<string>(),dist=r.filter((x:any)=>!seen.has(x.obs_date)&&seen.add(x.obs_date));
  out.push({...s,latest:dist[0]?{date:dist[0].obs_date,value:dist[0].value,retrievedAt:dist[0].retrieved_at}:null,previous:dist[1]?{date:dist[1].obs_date,value:dist[1].value}:null});
 }
 return out;
}
