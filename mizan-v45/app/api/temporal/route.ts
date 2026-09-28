import {env} from 'cloudflare:workers';
import {archivedAnalysis} from '@/lib/temporal-lab';
import {fetchCompany} from '@/lib/market-data';
import {configuredReader} from '@/lib/source-status';
import {evaluateForecast} from '@/lib/forecast-journal';
const headers={'Cache-Control':'no-store'};
export async function GET(req:Request){try{const u=new URL(req.url);return Response.json(await archivedAnalysis((env as any).DB,u.searchParams.get('symbol')||'',u.searchParams.get('date')||''),{headers});}catch(e){return Response.json({error:e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر قراءة الأرشيف؛ أعد المحاولة.'},{status:503,headers});}}
export async function POST(req:Request){try{
 if(req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'طلب غير مسموح.'},{status:403,headers});
 const raw=await req.text();if(raw.length>1000)throw Error('الطلب أكبر من الحد.');const b=JSON.parse(raw),db=(env as any).DB;
 if(b.action!=='reveal')throw Error('عملية غير مدعومة.');
 const archive=await archivedAnalysis(db,b.symbol,b.date);if(!archive.available)return Response.json(archive,{headers});
 const report=await fetchCompany(b.symbol,await configuredReader(db));
 const outcomes=archive.forecast.rows.map((r:any)=>({period:r.period,outcome:evaluateForecast({available:r.available,horizon:r.sessions,data:r},report)}));
 return Response.json({available:true,snapshotId:archive.snapshotId,outcomes,retrievedAt:report.retrievedAt,source:report.priceSource},{headers});
 }catch(e){return Response.json({error:e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message:'تعذر جلب نتيجة المقارنة؛ لم نغيّر التوقع المحفوظ.'},{status:503,headers});}}
