// Weekday-based scheduling is provisional until an exchange calendar is connected.
function localDate(time:number,zone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));}
function localClose(date:string,hour:number,zone:string){
 const target=Date.parse(date+'T'+String(hour).padStart(2,'0')+':00:00Z');let utc=target;
 for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utc)).map(p=>[p.type,p.value]));const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);utc+=target-represented;}
 return new Date(utc).toISOString();
}
export function forecastWindow(symbol:string,sessions:number,asOf:string,now:number,historical=false){
 const sa=symbol.endsWith('.SR'),zone=sa?'Asia/Riyadh':'America/New_York';
 const knownMarket=sa||/^[A-Z][A-Z0-9.-]*$/.test(symbol),anchorDate=historical?asOf:knownMarket?localDate(now,zone):asOf;
 let date=anchorDate,count=0;
 if(knownMarket)while(count<sessions){date=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);const day=new Date(date+'T12:00:00Z').getUTCDay();if(sa?day!==5&&day!==6:day!==0&&day!==6)count++;}
 return {anchorDate,startAt:historical?null:new Date(now).toISOString(),estimatedEndAt:knownMarket?localClose(date,sa?15:16,zone):null,timezone:knownMarket?zone:null,calendarVerified:false,
  definition:sessions===1?'إغلاق الجلسة التالية لتاريخ بدء التوقع':'إغلاق جلسة التداول رقم '+sessions+' بعد تاريخ بدء التوقع',
  deadlineNote:'وقت النهاية تقديري: يستثني عطلة نهاية الأسبوع، ولم يُربط تقويم العطلات والإغلاق المبكر. القياس النهائي يعتمد الجلسات الفعلية لا هذا الموعد التقديري.',
  successRule:'يقاس الاتجاه وإغلاق نهاية الفترة داخل النطاق؛ لمس الهدف أثناء الفترة لا يُعد نجاحًا عند نهايتها. حد الحياد مثبت في التوقع المحفوظ؛ السجلات السابقة دون حد صريح تستخدم ±1%.'};
}
