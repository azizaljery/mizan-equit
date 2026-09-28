import { desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { azizMonitorRecords } from '@/db/schema';

export const dynamic='force-dynamic';

export async function GET(){
 try{
  const rows=await getDb().select().from(azizMonitorRecords).orderBy(desc(azizMonitorRecords.issuedAt),azizMonitorRecords.horizon).limit(20);
  return Response.json({records:rows.map(row=>({...row,data:JSON.parse(row.data)}))},{headers:{'Cache-Control':'no-store'}});
 }catch{
  return Response.json({records:[],error:'سجل عزيز غير جاهز بعد.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
