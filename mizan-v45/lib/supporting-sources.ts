/** User-supplied references. A reviewed page is not an activated quote feed. */
export const SUPPORTING_SOURCES=[
 {id:'tadawul-watch',name:'تداول السعودية — مراقبة السوق الرئيسية',url:'https://www.saudiexchange.sa/wps/portal/saudiexchange/ourmarkets/main-market-watch?locale=ar',official:true,role:'مرجع رسمي للمراجعة',note:'تُراجع هوية السهم والعملة ووقت آخر صفقة. الصفحة تنبّه إلى تأخر الأسعار؛ لا يُستخدم مستوى تاسي بدل سعر الشركة.',priceFeedEnabled:false},
 {id:'sahm-reference',name:'سهم — الأسهم السعودية والأمريكية',url:'https://www.sahmcapital.com/invest/stocks',official:false,role:'مرجع ثانوي للمقارنة',note:'الصفحة تذكر تأخر الأسعار 15 دقيقة. يلزم فتح بيانات الورقة نفسها والتحقق من الرمز والسوق والعملة والتاريخ؛ وجود خانة تطهير لا يثبت توافقًا شرعيًا.',priceFeedEnabled:false},
 {id:'investing-reference',name:'Investing.com — الأسهم السعودية',url:'https://sa.investing.com/equities/saudi-arabia',official:false,role:'مرجع ثانوي للمقارنة',note:'دليل للوصول إلى بيانات الشركة. لا تُخلط أسعار الأسهم بالمؤشرات أو الأخبار والتحليلات، ويُراجع توقيت السعر ونوع الورقة في الصفحة الخاصة بها.',priceFeedEnabled:false},
 {id:'capital-reference',name:'Capital.com',url:'https://capital.com/ar-int',official:false,role:'صفحة تسويقية — مستبعدة من اعتماد الأسعار',note:'الرابط يعرض خدمات وعقود فروقات. سعر عقد الفروقات ليس سعر السهم الأصلي، ولا يُنقل إلى التقييم أو المحفظة كسعر سهم.',priceFeedEnabled:false}
] as const;
export const SUPPORTING_SOURCES_REVIEWED_ON='2026-09-09';
export function automaticSourceId(value:string):'tadawul'|'sec'|'yahoo'|null{
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;return u.hostname==='www.saudiexchange.sa'?'tadawul':['www.sec.gov','data.sec.gov'].includes(u.hostname)?'sec':u.hostname==='query1.finance.yahoo.com'?'yahoo':null;}catch{return null;}
}
