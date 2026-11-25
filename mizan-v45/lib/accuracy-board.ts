/**
 * Accuracy board for "up" picks. Pure aggregation over rows already stored; nothing stored is changed or recomputed.
 * For each engine, market and horizon: up-picks that actually rose out of resolved up-picks, against the rise rate of ALL stocks available for picking
 * in the same market, on the same issue dates and horizon (the matched base rate). Also: share of cases where the engine issued a signal, and what is still pending.
 * The 0.15% "no signal" cut-off applies only to forecast-model rows and only to how they are shown; it is experimental and never alters a stored forecast.
 */
export const NO_SIGNAL_PCT=0.15;
export const MIN_RESOLVED=30,MIN_DATES=10;
export type Market='sa'|'us';
/** One pre-aggregated cell: how many rows (n) of an engine/market/horizon/date/signal/resolved combination, and how many of them rose (ups; resolved rows only). */
export type Cell={engine:string;market:Market;horizon:number;date:string;signal:'up'|'down'|'none'|'unknown';resolved:boolean;n:number;ups:number};
/** Universe rise rates: one cell per market/horizon/date over every resolved stock that was available for picking. */
export type BaseCell={market:Market;horizon:number;date:string;n:number;ups:number};
/** `universe` engines are compared with the external universe cells; `self` engines with their own full resolved set (all signals) on the same date. */
export type EngineBase='universe'|'self';
export type Row={
 engine:string;market:Market;horizon:number;baseSource:EngineBase;
 records:number;resolved:number;pending:number;withSignal:number;signalShare:number|null;
 upSignals:number;upResolved:number;upHits:number;upHitRate:number|null;
 baseRate:number|null;baseCovered:number;lift:number|null;dates:number;
 downResolved:number;downHits:number;downHitRate:number|null;small:boolean;note:string;
};
const key=(m:string,h:number,d:string)=>`${m}|${h}|${d}`;
export function buildBoard(cells:Cell[],universe:BaseCell[],engineBase:(engine:string)=>EngineBase):Row[]{
 const uni=new Map<string,{n:number;ups:number}>();
 for(const u of universe){const k=key(u.market,u.horizon,u.date),c=uni.get(k)||{n:0,ups:0};c.n+=u.n;c.ups+=u.ups;uni.set(k,c);}
 const groups=new Map<string,Cell[]>();
 for(const c of cells){const k=`${c.engine}|${c.market}|${c.horizon}`;(groups.get(k)||groups.set(k,[]).get(k)!).push(c);}
 const out:Row[]=[];
 for(const [k,g] of groups){
  const [engine,market,hz]=k.split('|'),horizon=Number(hz),baseSource=engineBase(engine);
  const self=new Map<string,{n:number;ups:number}>();
  for(const c of g)if(c.resolved){const kk=key(c.market,c.horizon,c.date),x=self.get(kk)||{n:0,ups:0};x.n+=c.n;x.ups+=c.ups;self.set(kk,x);}
  const baseMap=baseSource==='universe'?uni:self;
  const sum=(f:(c:Cell)=>boolean,v:(c:Cell)=>number)=>g.reduce((s,c)=>f(c)?s+v(c):s,0);
  const records=sum(()=>true,c=>c.n),resolved=sum(c=>c.resolved,c=>c.n),pending=records-resolved;
  const known=sum(c=>c.signal!=='unknown',c=>c.n),withSignal=sum(c=>c.signal==='up'||c.signal==='down',c=>c.n);
  const upSignals=sum(c=>c.signal==='up',c=>c.n);
  const upRes=g.filter(c=>c.signal==='up'&&c.resolved);
  const upResolved=upRes.reduce((s,c)=>s+c.n,0),upHits=upRes.reduce((s,c)=>s+c.ups,0);
  let expected=0,covered=0,coveredHits=0;const dates=new Set<string>();
  for(const c of upRes){dates.add(c.date);const b=baseMap.get(key(c.market,c.horizon,c.date));if(b&&b.n>0){expected+=c.n*(b.ups/b.n);covered+=c.n;coveredHits+=c.ups;}}
  const baseRate=covered?expected/covered:null,hitCovered=covered?coveredHits/covered:null;
  const dn=g.filter(c=>c.signal==='down'&&c.resolved),downResolved=dn.reduce((s,c)=>s+c.n,0),downHits=dn.reduce((s,c)=>s+(c.n-c.ups),0);
  const small=upResolved<MIN_RESOLVED||dates.size<MIN_DATES;
  out.push({engine,market:market as Market,horizon,baseSource,records,resolved,pending,withSignal,signalShare:known?withSignal/known:null,
   upSignals,upResolved,upHits,upHitRate:upResolved?upHits/upResolved:null,baseRate,baseCovered:covered,
   lift:baseRate!==null&&hitCovered!==null?hitCovered-baseRate:null,dates:dates.size,downResolved,downHits,downHitRate:downResolved?downHits/downResolved:null,small,
   note:upResolved===0?'لا ترشيحات صعود محسومة بعد':small?`عينة صغيرة: يلزم ${MIN_RESOLVED} ترشيحًا محسومًا و${MIN_DATES} تواريخ على الأقل قبل أي حكم`:''});
 }
 return out.sort((a,b)=>a.engine.localeCompare(b.engine)||a.market.localeCompare(b.market)||a.horizon-b.horizon);
}
