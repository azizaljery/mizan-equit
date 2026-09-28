import {env} from 'cloudflare:workers';
import {eligibleSaudiCompanies,searchSaudiPage} from '@/lib/saudi-directory';
import {eligibleUSCompanies,searchUSDirectory} from '@/lib/us-directory';
import {randomSample} from '@/lib/accuracy-sample';
import {readSettings} from '@/lib/site-settings';

// Select before any price read. A failed company is never silently replaced.
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store'};
 try{
  const p=new URL(request.url).searchParams,market=p.get('market');
  if(market!=='sa'&&market!=='us')return Response.json({error:'اختر السوق السعودي أو الأمريكي.'},{status:400,headers});
  const settings=await readSettings((env as any).DB);
  if(!settings.enabledMarkets.includes(market))return Response.json({error:'هذا السوق متوقف من الإدارة.'},{status:403,headers});
  const seed=crypto.randomUUID();
  const pool=market==='sa'?eligibleSaudiCompanies():eligibleUSCompanies();
  const sample=randomSample(pool,seed,1);
  const directory=market==='sa'?searchSaudiPage('').directory:searchUSDirectory('').directory;
  return Response.json({company:sample.companies[0],selection:{method:'random-directory',seed,market,poolCount:sample.universe.length,selectedAt:new Date().toISOString(),directory}}, {headers});
 }catch{return Response.json({error:'تعذر اختيار الشركة من الدليل. أعد المحاولة.'},{status:503,headers});}
}
