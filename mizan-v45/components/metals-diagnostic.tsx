'use client';
export type MetalsDiagnostic={code:string;httpStatus?:number;attempts:number;checkedAt:string};
export function MetalsDiagnosticDetails({diagnostic}:{diagnostic:MetalsDiagnostic}){
 const at=Date.parse(diagnostic.checkedAt),time=Number.isFinite(at)?new Date(at+3*3600000).toISOString().slice(0,19).replace('T',' '):'غير متاح';
 return <details><summary>تفاصيل اختبار الاتصال</summary><p>رمز التشخيص: <bdi>{diagnostic.code}</bdi> · عدد المحاولات: {diagnostic.attempts}</p>{diagnostic.httpStatus&&<p>حالة رد المصدر: {diagnostic.httpStatus}</p>}<p>وقت الاختبار بتوقيت السعودية: <bdi>{time}</bdi></p><p>حُسبت كل محاولة ضمن سقف طلبات المصدر. هذه التفاصيل لا تحتوي المفتاح.</p></details>;
}
