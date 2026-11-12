/**
 * VOSA gates for the paper-trading path (BOT-0001), shadow use only. Models produce evidence; these gates read it and may only veto.
 * Thresholds come from the frozen bot strategy (lib/bot/engine.ts, not modified here) plus the fixed VOSA settings below; each gate's config hash goes into every audit event.
 * Only gates backed by data we actually have are implemented. The rest are listed in VOSA_NOT_ACTIVE and are NOT claimed to run.
 */
import type {Market,StrategyConfig} from '../bot/engine';
import {makeCandidate,makeGate,type GateResult,type VosaCandidate,type VosaGate,type Finding} from './engine';

export const VOSA_PIPELINE_ID='MIZAN-VOSA-BOT';
export const VOSA_PIPELINE_VERSION='vosa-mizan-1';
/** Fixed before any evaluation. costMargin: expected move must cover this multiple of the estimated round-trip cost. Range width limits are % of price per horizon (sessions). */
export const VOSA_MIZAN_SETTINGS=Object.freeze({costMargin:1.5,maxRangeWidthPct:{1:6,5:12,21:25} as Record<number,number>});
export const VOSA_NOT_ACTIVE=Object.freeze([
 {gate:'LOSER_EXCLUSION',reason:'لا نموذج «خاسرين» مدرَّب ولا تجربة توأمية (HYP-NEGSEL-0001 ما زالت CAPTURED/UNVERIFIED).'},
 {gate:'MARKET_REGIME',reason:'لا تعريف مثبت لنظام السوق ولا بيانات منظِّمة له.'},
 {gate:'TOXIC_FLOW',reason:'لا بيانات دفتر أوامر أو تدفق؛ المزود يعطي أسعارًا يومية ولحظية متأخرة فقط.'},
 {gate:'IAI_CONSENSUS',reason:'لا مصادر مستقلة موثقة الاستقلال؛ SOURCE_CONFLICT يكتفي بكشف التعارض.'},
]);
type Settings=typeof VOSA_MIZAN_SETTINGS;

export type SourceVote={source:string;direction:'up'|'down'|'neutral';issuedAt:string};
export type BotCandidateInput={market:Market;symbol:string;horizon:number;now:number;forecastId:string|null;forecastCreatedAt:string|null;votes:number|null;targetPrice:number|null;
 range:[number,number]|null;price:number|null;advValue:number|null;dailyVol:number|null;orderValue:number|null;signals:SourceVote[];quote?:{ageSeconds:number;isOpen:boolean}|null;version?:number;parentVersion?:number|null};
/** Evidence envelope for one (market, symbol, horizon, forecast). Missing evidence is null; the gates decide what that means. */
export const botCandidate=(i:BotCandidateInput):Promise<VosaCandidate>=>makeCandidate(`${i.market}:${i.symbol}:h${i.horizon}:${i.forecastId??'none'}`,i.version??1,{
 market:i.market,symbol:i.symbol,horizon:i.horizon,nowMs:i.now,forecastId:i.forecastId,forecastCreatedAt:i.forecastCreatedAt,votes:i.votes,targetPrice:i.targetPrice,
 rangeLow:i.range?i.range[0]:null,rangeHigh:i.range?i.range[1]:null,price:i.price,advValue:i.advValue,dailyVol:i.dailyVol,orderValue:i.orderValue,
 signals:i.signals.map(s=>({source:s.source,direction:s.direction,issuedAt:s.issuedAt})),quoteAgeSeconds:i.quote?.ageSeconds??null,marketOpen:i.quote?.isOpen??null},i.parentVersion??null);

const res=(g:{gateId:string;gateVersion:string},status:GateResult['status'],findings:Finding[]=[]):GateResult=>({gateId:g.gateId,gateVersion:g.gateVersion,status,findings});
type Num={v:number}|{err:Finding};
const NUMERIC=['price','advValue','dailyVol','orderValue','votes','targetPrice','rangeLow','rangeHigh','nowMs','horizon'] as const;
const read=(c:VosaCandidate,f:string):Num=>{
 const raw=c.payload[f];
 if(raw===null||raw===undefined)return {err:{ruleId:'DATA-MISSING',message:`${f} missing`,observed:null,required:'finite number'}};
 if(typeof raw!=='number'||!Number.isFinite(raw))return {err:{ruleId:'NON-FINITE-OR-NON-NUMERIC',message:`${f} is not a finite number`,observed:raw,required:'finite number'}};
 return {v:raw};
};
const need=(c:VosaCandidate,fields:readonly string[]):{vals:Record<string,number>}|{res:Finding[]}=>{
 const vals:Record<string,number>={},bad:Finding[]=[];
 for(const f of fields){const r=read(c,f);if('err' in r)bad.push(r.err);else vals[f]=r.v;}
 return bad.length?{res:bad}:{vals};
};
const roundTripBps=(s:StrategyConfig,m:Market,adv:number,vol:number,orderValue:number)=>{
 const cm=s.costs[m],half=(cm.halfSpreadTiers.find(t=>adv>=t.minAdvValue)??cm.halfSpreadTiers[cm.halfSpreadTiers.length-1]).bps,impact=1e4*cm.impactCoef*vol*Math.sqrt(orderValue/adv);
 return {halfSpreadBps:half,impactBps:impact,commissionBps:cm.commissionBps,total:2*(cm.commissionBps+half+impact)};
};

/** The bot's veto chain. Order matters only for EXECUTION fail-fast; AUDIT mode runs all of them. */
export async function mizanBotGates(s:StrategyConfig,market:Market,cfg:Settings=VOSA_MIZAN_SETTINGS):Promise<VosaGate[]>{
 const G=(gateId:string,description:string,config:Record<string,unknown>,evaluate:(c:VosaCandidate,g:{gateId:string;gateVersion:string})=>GateResult)=>
  makeGate({gateId,gateVersion:'1',description,config:{...config,market,strategyVersion:s.version},evaluate:(c)=>evaluate(c,{gateId,gateVersion:'1'})});
 return Promise.all([
  G('REQUIRED_EVIDENCE','Price, liquidity, forecast time and votes must exist; otherwise SUSPEND',{fields:['price','advValue','dailyVol','orderValue','votes','forecastCreatedAt']},(c,g)=>{
   const miss=['price','advValue','dailyVol','orderValue','votes','forecastCreatedAt'].filter(f=>c.payload[f]===null||c.payload[f]===undefined);
   return miss.length?res(g,'SUSPEND',[{ruleId:'DATA-MISSING',message:'Required evidence missing',observed:miss,required:'all present'}]):res(g,'PASS');
  }),
  G('FINITE_NUMBERS','Every numeric evidence value must be a finite number; NaN/Infinity/text SUSPEND',{fields:NUMERIC},(c,g)=>{
   const bad:Finding[]=[];
   for(const f of NUMERIC){const raw=c.payload[f];if(raw===null||raw===undefined)continue;if(typeof raw!=='number'||!Number.isFinite(raw))bad.push({ruleId:'NON-FINITE-NUMERIC-VALUE',message:`${f} not finite`,observed:raw,required:'finite number'});}
   return bad.length?res(g,'SUSPEND',bad):res(g,'PASS');
  }),
  G('FORECAST_FRESHNESS','Forecast older than the strategy limit is killed; invalid or future time is SUSPEND',{maxForecastAgeHours:s.entry.maxForecastAgeHours},(c,g)=>{
   const n=read(c,'nowMs');if('err' in n)return res(g,'SUSPEND',[n.err]);
   const t=Date.parse(String(c.payload.forecastCreatedAt));
   if(!Number.isFinite(t)||t>n.v)return res(g,'SUSPEND',[{ruleId:'FORECAST-TIME-INVALID',message:'forecast time invalid or in the future',observed:c.payload.forecastCreatedAt,required:'time <= decision time'}]);
   const age=(n.v-t)/3600000;
   return age>s.entry.maxForecastAgeHours?res(g,'KILL',[{ruleId:'FORECAST-STALE',message:'forecast older than the limit',observed:age,required:s.entry.maxForecastAgeHours}]):res(g,'PASS');
  }),
  G('SOURCE_CONFLICT','Sources that disagree (up vs down) on the same stock and horizon: SUSPEND',{},(c,g)=>{
   const sg=Array.isArray(c.payload.signals)?c.payload.signals as {source:string;direction:string}[]:null;
   if(!sg)return res(g,'SUSPEND',[{ruleId:'DATA-MISSING',message:'signals missing',observed:null,required:'array'}]);
   const up=sg.filter(x=>x.direction==='up').map(x=>x.source),down=sg.filter(x=>x.direction==='down').map(x=>x.source);
   return up.length&&down.length?res(g,'SUSPEND',[{ruleId:'SOURCES-DISAGREE',message:'up and down calls on the same stock and horizon',observed:{up,down},required:'no opposing source'}]):res(g,'PASS');
  }),
  G('SIGNAL_STRENGTH','Votes below the strategy minimum are killed',{minVotes:s.entry.minVotes},(c,g)=>{
   const v=read(c,'votes');if('err' in v)return res(g,'SUSPEND',[v.err]);
   return Math.abs(v.v)<s.entry.minVotes?res(g,'KILL',[{ruleId:'SIGNAL-TOO-WEAK',message:'votes below minimum',observed:Math.abs(v.v),required:s.entry.minVotes}]):res(g,'PASS');
  }),
  G('LIQUIDITY','Traded value below the minimum, or an order above the allowed share of it, is killed',{minAdvValue:s.liquidity.minAdvValue[market],maxOrderPctOfAdv:s.liquidity.maxOrderPctOfAdv},(c,g)=>{
   const n=need(c,['advValue','orderValue']);if('res' in n)return res(g,'SUSPEND',n.res);
   const min=s.liquidity.minAdvValue[market],cap=n.vals.advValue*s.liquidity.maxOrderPctOfAdv/100;
   if(n.vals.advValue<min)return res(g,'KILL',[{ruleId:'LIQUIDITY-BELOW-MINIMUM',message:'average traded value below minimum',observed:n.vals.advValue,required:min}]);
   if(n.vals.orderValue>cap*1.0000001)return res(g,'KILL',[{ruleId:'ORDER-EXCEEDS-LIQUIDITY-LIMIT',message:'order above allowed share of daily traded value',observed:n.vals.orderValue,required:cap}]);
   return res(g,'PASS');
  }),
  G('COST','Expected move to the forecast target must cover costMargin x estimated round-trip cost',{costMargin:cfg.costMargin,costs:s.costs[market]},(c,g)=>{
   const n=need(c,['price','targetPrice','advValue','dailyVol','orderValue']);if('res' in n)return res(g,'SUSPEND',n.res);
   if(n.vals.price<=0||n.vals.advValue<=0||n.vals.dailyVol<0||n.vals.orderValue<=0)return res(g,'SUSPEND',[{ruleId:'INVALID-NUMERIC-VALUE',message:'price/liquidity values out of domain',observed:n.vals,required:'positive'}]);
   const move=(n.vals.targetPrice-n.vals.price)/n.vals.price*1e4,cost=roundTripBps(s,market,n.vals.advValue,n.vals.dailyVol,n.vals.orderValue),need_=cfg.costMargin*cost.total;
   return move<need_?res(g,'KILL',[{ruleId:'EXPECTED-MOVE-BELOW-COST',message:'expected move does not cover the estimated round-trip cost',observed:{moveBps:move,roundTripBps:cost.total,halfSpreadBps:cost.halfSpreadBps,impactBps:cost.impactBps},required:{minMoveBps:need_,margin:cfg.costMargin}}]):res(g,'PASS');
  }),
  G('CONFORMAL_RANGE','A forecast range wider than the fixed limit for its horizon carries too much uncertainty: killed; missing/invalid range SUSPEND',{maxRangeWidthPct:cfg.maxRangeWidthPct},(c,g)=>{
   const n=need(c,['price','rangeLow','rangeHigh','horizon']);if('res' in n)return res(g,'SUSPEND',n.res);
   const lim=cfg.maxRangeWidthPct[n.vals.horizon];
   if(!(n.vals.price>0)||n.vals.rangeHigh<n.vals.rangeLow||lim===undefined)return res(g,'SUSPEND',[{ruleId:'RANGE-INVALID',message:'range or horizon invalid',observed:{price:n.vals.price,low:n.vals.rangeLow,high:n.vals.rangeHigh,horizon:n.vals.horizon},required:'low<=high, price>0, known horizon'}]);
   const w=(n.vals.rangeHigh-n.vals.rangeLow)/n.vals.price*100;
   return w>lim?res(g,'KILL',[{ruleId:'RANGE-TOO-WIDE',message:'relative range width above the limit',observed:w,required:lim}]):res(g,'PASS');
  }),
 ]);
}
