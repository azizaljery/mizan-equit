/**
 * VOSA shadow mode for the paper bot. The veto gates (lib/vosa) evaluate the same candidate the bot just decided on and RECORD their verdict
 * next to the bot's decision. They never change it. Everything here is best-effort: a failure is swallowed and can never stop trading.
 * relation: same | vosa_stricter (bot would buy, a gate vetoes) | vosa_looser (bot declined, every gate passes).
 */
import {botCandidate,mizanBotGates,VOSA_PIPELINE_ID,VOSA_PIPELINE_VERSION,type SourceVote} from '../vosa/mizan-gates';
import {vosaEvaluate,canonicalHash} from '../vosa/engine';
import type {Market,StrategyConfig,Liquidity,ForecastView} from './engine';

export type ShadowInput={db:any;experimentId:string;day:string;nowMs:number;iso:string;S:StrategyConfig;market:Market;symbol:string;horizon:number;f:ForecastView;votes:number|null;
 signals:SourceVote[];price:number|null;liq:Liquidity;orderValue:number|null;quote:{ageSeconds:number;isOpen:boolean}|null;botAction:string;botReason:string};

const INSERT=`INSERT INTO bot_vosa_audit(id,experiment_id,audit_key,created_at,symbol,horizon,forecast_id,pipeline_version,candidate_hash,vosa_status,bot_action,bot_reason,relation,blocking_gates,gate_results_json,audit_json)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;

export async function shadowVosa(i:ShadowInput):Promise<boolean>{
 try{
  const key=`${i.experimentId}|${i.symbol}|${i.horizon}|${i.f.id}|${i.day}|${VOSA_PIPELINE_VERSION}`;
  const c=await botCandidate({market:i.market,symbol:i.symbol,horizon:i.horizon,now:i.nowMs,forecastId:i.f.id,forecastCreatedAt:i.f.createdAt,votes:i.votes,targetPrice:i.f.call?.targetPrice??null,
   range:i.f.range,price:i.price,advValue:i.liq.advValue,dailyVol:i.liq.dailyVol,orderValue:i.orderValue,signals:i.signals,quote:i.quote});
  const gates=await mizanBotGates(i.S,i.market);
  const ev=await vosaEvaluate(gates,c,{pipelineId:VOSA_PIPELINE_ID,pipelineVersion:VOSA_PIPELINE_VERSION,mode:'AUDIT',now:()=>new Date(i.nowMs)});
  const botBuys=i.botAction==='buy',vosaPass=ev.finalStatus==='PASS';
  const relation=botBuys&&!vosaPass?'vosa_stricter':!botBuys&&vosaPass?'vosa_looser':'same';
  const blocking=ev.gateResults.filter((g:any)=>g.status!=='PASS').map((g:any)=>`${g.gateId}:${g.status}`).join(',');
  const res=await i.db.prepare(INSERT).bind('vosa:'+key,i.experimentId,key,i.iso,i.symbol,i.horizon,i.f.id,VOSA_PIPELINE_VERSION,await canonicalHash(c.payload),ev.finalStatus,i.botAction,i.botReason,relation,blocking,
   JSON.stringify(ev.gateResults),JSON.stringify(ev.auditTrail)).run();
  return Number(res?.meta?.changes??0)>0;
 }catch{return false;}
}
