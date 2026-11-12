import {botGuard,botError} from '../guard';
import {EXPORT_TABLES,exportRows,toCsv,type ExportTable} from '@/lib/bot/queries';

export async function GET(req:Request){
  try{
    const g=await botGuard(req,false);if(g instanceof Response)return g;
    const q=new URL(req.url).searchParams,table=q.get('table') as ExportTable,experiment=q.get('experiment')||undefined;
    if(!EXPORT_TABLES.includes(table))return botError('الجدول غير معروف.',400);
    if(experiment!==undefined&&!/^[\w.-]{1,80}$/.test(experiment))return botError('معرّف التجربة غير صالح.',400);
    let rows;try{rows=await exportRows(g.db,table,experiment);}catch(e){return botError(e instanceof Error&&e.message==='experiment_required'?'حدّد التجربة (experiment).':'تعذر قراءة الجدول.',e instanceof Error&&e.message==='experiment_required'?400:503);}
    return new Response(toCsv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="mizan-bot-${table}${experiment?'-'+experiment:''}.csv"`,'Cache-Control':'no-store, private'}});
  }catch{return botError('تعذر التصدير.',503);}
}
