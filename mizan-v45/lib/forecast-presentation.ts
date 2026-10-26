/** Client-safe presentation only. A reference price is never substituted for a missing forecast. */
type ForecastView={available?:boolean;predictedPrice?:number|null;direction?:string};
export function forecastPoint(row:ForecastView):number|null{
 return row.available===true&&typeof row.predictedPrice==='number'&&Number.isFinite(row.predictedPrice)&&row.predictedPrice>0?row.predictedPrice:null;
}
export function forecastDisplayStatus(row:ForecastView){
 if(!row.available)return {tone:'neutral',label:'لم يصدر توقع'};
 if(row.direction==='هابط')return {tone:'danger',label:'سيناريو هابط'};
 if(row.direction==='صاعد')return {tone:'safe',label:'سيناريو صاعد'};
 return {tone:'neutral',label:'سيناريو محايد'};
}
