import {env} from 'cloudflare:workers';
import {authorizeAdminSession} from '@/lib/admin-request';
import {readArrival,readEvaluation,readSaveFailure} from '@/lib/jobs/heartbeat';
export async function GET(req:Request){
 const denied=await authorizeAdminSession(req);if(denied)return denied;
 const db=(env as unknown as {DB:any}).DB;
 const [arrival,evaluation,saveFailure]=await Promise.all([readArrival(db),readEvaluation(db),readSaveFailure(db)]);
 return Response.json({readOnly:true,arrival,evaluation,saveFailure},{headers:{'Cache-Control':'no-store, private'}});
}
