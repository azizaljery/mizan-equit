import {env} from 'cloudflare:workers';
import {eligibleSaudiCompanies} from '@/lib/saudi-directory';
import {eligibleUSCompanies} from '@/lib/us-directory';
import {listingRestriction} from '@/lib/listing-lifecycle';
import {buildReadiness,d1DataReader} from '@/lib/aziz/readiness';

// Read-only readiness (spec 2026-10-21 phase 3): registry + archived-data summary via one SELECT.
// No training, no forecast, no write. Creating a research forecast is a separate authorised operation (not in this release).
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store, private'};
 const p=new URL(request.url).searchParams,market=p.get('market'),symbol=(p.get('symbol')||'').trim().toUpperCase();
 if(!['sa','us'].includes(market||'')||!symbol||symbol.length>32||! /^[A-Z0-9.^-]+$/.test(symbol))return Response.json({error:'حدّد السوق ورمز الشركة الصحيح.'},{status:400,headers});
 const company=(market==='sa'?eligibleSaudiCompanies():eligibleUSCompanies()).find(c=>c.symbol===symbol);
 if(!company)return Response.json({error:'الشركة غير موجودة في دليل السوق المحدد.'},{status:404,headers});
 const DB=(env as any)?.DB;
 const body=await buildReadiness({market:market as 'sa'|'us',company:{symbol:company.symbol,name:company.name},restriction:listingRestriction(symbol),reader:DB?d1DataReader(DB):null});
 return Response.json(body,{headers});
}
