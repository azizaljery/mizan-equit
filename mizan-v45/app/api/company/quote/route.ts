import {env} from 'cloudflare:workers';
import {configuredReader} from '@/lib/source-status';
import {fetchLiveQuote} from '@/lib/market-data';
export async function GET(request:Request){try{return Response.json(await fetchLiveQuote(new URL(request.url).searchParams.get('symbol')||'',await configuredReader((env as any).DB)),{headers:{'Cache-Control':'no-store'}})}catch(e){const reason=e instanceof Error&&/[\u0600-\u06ff]/.test(e.message)?e.message.slice(0,300):'تعذر الاتصال أو قراءة الاستجابة.';return Response.json({error:'تعذر تحديث السعر من المصدر. '+reason+' آخر سعر ظاهر لم يُحدّث.'},{status:503,headers:{'Cache-Control':'no-store'}})}}
