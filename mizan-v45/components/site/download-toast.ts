'use client';
import {toast} from 'sonner';
import {downloadCsv} from '@/lib/export-data';

/** Same download as lib/export-data `downloadCsv`, with a toast confirming the file name (or the failure). */
export function downloadCsvWithToast(name:string,rows:Record<string,unknown>[]){
 try{downloadCsv(name,rows);toast.success('بدأ تنزيل الملف',{description:`${name}.csv · ${rows.length} صفًا`});}
 catch(e){toast.error('تعذر تجهيز الملف',{description:e instanceof Error?e.message:undefined});}
}
