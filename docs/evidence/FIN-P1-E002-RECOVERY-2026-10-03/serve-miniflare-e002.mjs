#!/usr/bin/env node
import {createServer} from 'node:http';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';

const [worktreeArg, portArg] = process.argv.slice(2);
const worktree=resolve(worktreeArg||'');
const port=Number(portArg||0);
if (!worktreeArg || !Number.isInteger(port) || port<1024 || port>65535) throw new Error('usage: node serve-miniflare-e002.mjs <worktree> <port>');
const config=JSON.parse(await (await import('node:fs/promises')).readFile(join(worktree,'dist/server/wrangler-e002.json'),'utf8'));
if (config.d1_databases?.length!==1 || config.d1_databases[0].binding!=='DB' || config.d1_databases[0].database_id!=='00000000-0000-4000-8000-202610032032') throw new Error('Refusing non-synthetic D1 configuration');
if (config.triggers?.crons?.length) throw new Error('Refusing a local test config with cron schedules');
const modulePath=pathToFileURL(join(worktree,'node_modules/miniflare/dist/src/index.js')).href;
const {Miniflare}=await import(modulePath);
const mf=new Miniflare({
  modules:true,
  scriptPath:resolve(worktree,'dist/server/index.js'),
  modulesRules:[{type:'ESModule',include:['**/*.js']}],
  compatibilityDate:config.compatibility_date,
  compatibilityFlags:config.compatibility_flags,
  assets:{directory:resolve(worktree,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
  d1Databases:{DB:config.d1_databases[0].database_id},
  d1Persist:resolve(worktree,'.wrangler/state/v3/d1'),
  bindings:config.vars||{}
});
await mf.getD1Database('DB');
const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length']);
const server=createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'){res.writeHead(405,{'content-type':'application/json'});res.end('{"error":"test bridge accepts GET only"}');return;}
    const headers=new Headers();
    for(const [name,value] of Object.entries(req.headers)){
      if(hop.has(name.toLowerCase())||value===undefined)continue;
      if(name.toLowerCase()==='accept'||name.toLowerCase()==='accept-language'||name.toLowerCase()==='user-agent')headers.set(name,Array.isArray(value)?value.join(', '):value);
    }
    const url=`http://127.0.0.1:${port}${req.url||'/'}`;
    const workerRequest=new Request(url,{method:'GET',headers});
    const response=await mf.dispatchFetch(workerRequest);
    const body=Buffer.from(await response.arrayBuffer());
    const responseHeaders={};
    for(const [name,value] of response.headers){if(!['connection','keep-alive','transfer-encoding','upgrade'].includes(name.toLowerCase()))responseHeaders[name]=value;}
    res.writeHead(response.status,responseHeaders);res.end(body);
  }catch(e){
    if(!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'local worker bridge error',name:String(e?.name||'Error')}));}
    else res.destroy();
  }
});
server.requestTimeout=30000;
server.headersTimeout=15000;
server.listen(port,'127.0.0.1',()=>{
  const addr=server.address();
  if(!addr||typeof addr==='string'||addr.address!=='127.0.0.1'){
    console.error('Unexpected loopback bind address; stopping.');
    server.close(async()=>{await mf.dispose();process.exit(1);});
    return;
  }
  console.log('E002_LOCAL_WORKER_READY='+JSON.stringify({bindAddress:addr.address,port:addr.port,workerName:config.name,sourceIdentity:JSON.parse(readFileSync(join(worktree,'lib/deployment-identity.json'),'utf8')).commit,d1Database:config.d1_databases[0].database_name,d1Id:config.d1_databases[0].database_id,cronSchedules:config.triggers.crons,runtime:'Miniflare built Worker; local synthetic D1'}));
});
async function shutdown(){server.close(async()=>{await mf.dispose();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
