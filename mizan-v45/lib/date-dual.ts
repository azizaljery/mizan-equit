/** Hijri (Umm al-Qura, set explicitly) with the Gregorian date beside it, in Riyadh time. Gregorian digits are Latin so the two never look alike. */
export type DualOptions=Intl.DateTimeFormatOptions;
export function dualFormat(input:string|number|Date|null|undefined,options:DualOptions={dateStyle:'medium',timeStyle:'short'}):string|null{
 if(input===null||input===undefined||input==='')return null;
 const d=input instanceof Date?input:new Date(input);
 if(!Number.isFinite(d.getTime()))return null;
 const o:DualOptions={timeZone:'Asia/Riyadh',...options};
 return `${new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',o).format(d)} (${new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',o).format(d)})`;
}
/** A plain YYYY-MM-DD calendar day (no time): noon UTC keeps it on the same day in Riyadh. */
export function dualDay(day:string):string|null{
 return /^\d{4}-\d{2}-\d{2}$/.test(day)?dualFormat(`${day}T12:00:00Z`,{dateStyle:'medium'}):null;
}
