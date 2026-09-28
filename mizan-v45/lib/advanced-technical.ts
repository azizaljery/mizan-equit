import {sma,atr,type Price} from './analysis';
export function advancedTechnical(prices:Price[]){
 const closes=prices.map(p=>p.close),middle=sma(closes,20),bands=closes.map((_,i)=>{if(i<19)return null;const m=middle[i]!,std=Math.sqrt(closes.slice(i-19,i+1).reduce((s,v)=>s+(v-m)**2,0)/20);return {middle:m,upper:m+2*std,lower:m-2*std}});
 const a=atr(prices),dx:(number|null)[]=Array(prices.length).fill(null),adx:(number|null)[]=Array(prices.length).fill(null);let plus=0,minus=0;
 for(let i=1;i<prices.length;i++){const up=prices[i].high-prices[i-1].high,down=prices[i-1].low-prices[i].low,p=up>down&&up>0?up:0,m=down>up&&down>0?down:0;if(i<=14){plus+=p;minus+=m}else{plus=plus-plus/14+p;minus=minus-minus/14+m}if(i>=14&&a[i]){const pdi=100*plus/(14*a[i]!),mdi=100*minus/(14*a[i]!);dx[i]=pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0;}}
 if(prices.length>27){adx[27]=dx.slice(14,28).reduce<number>((s,n)=>s+(n||0),0)/14;for(let i=28;i<prices.length;i++)adx[i]=(adx[i-1]!*13+dx[i]!)/14;}
 let pv=0,volume=0,day='';const vwap=prices.map((p,i)=>{const d=p.date.slice(0,10);if(p.date.includes('T')&&day!==d){pv=0;volume=0;day=d;}if(!p.date.includes('T')&&i>=20){const old=prices[i-20];pv-=(old.high+old.low+old.close)/3*old.volume;volume-=old.volume;}pv+=(p.high+p.low+p.close)/3*p.volume;volume+=p.volume;return volume?pv/volume:null});
 return {bands,adx,vwap};
}
