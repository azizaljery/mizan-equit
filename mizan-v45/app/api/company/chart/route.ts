import {env} from 'cloudflare:workers';
import {configuredReader} from '@/lib/source-status';
import {fetchIntradayChart} from '@/lib/market-data';
export async function GET(request:Request){
 try{const p=new URL(request.url).searchParams;return Response.json(await fetchIntradayChart(p.get('symbol')||'',p.get('interval')||'',await configuredReader((env as any).DB)),{headers:{'Cache-Control':'no-store'}})}
 catch(e){return Response.json({error:'تعذر جلب هذا الفاصل من مزود الأسعار. '+(e instanceof Error?e.message:'جرّب التحديث لاحقًا.')},{status:422})}
}
