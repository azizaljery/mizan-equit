export function pickRoundRobin<T extends {symbol:string}>(rows:T[], start:number, count:number){
  if(!rows.length || count <= 0) return {items:[] as T[], next:0};
  const safe=((Number.isSafeInteger(start)?start:0)%rows.length+rows.length)%rows.length;
  const n=Math.min(Math.max(0,Math.trunc(count)),rows.length);
  const items=Array.from({length:n},(_,i)=>rows[(safe+i)%rows.length]);
  return {items,next:(safe+n)%rows.length};
}
