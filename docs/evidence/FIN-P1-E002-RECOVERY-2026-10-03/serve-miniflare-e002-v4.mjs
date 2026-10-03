#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {promises as fs} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const [worktreeArg, stage, portArg] = process.argv.slice(2);
const worktree=resolve(worktreeArg||'');
const port=Number(portArg||0);
if(!worktreeArg||!['v52-before','v51-rollback','v52-return'].includes(stage)||!Number.isInteger(port)||port<1024||port>65535)throw new Error('usage: node serve-miniflare-e002-v3.mjs <worktree> <stage> <port>');
const cfgPath=join(worktree,'dist/server/wrangler-e002.json');
const config=JSON.parse(await fs.readFile(cfgPath,'utf8'));
if(config.d1_databases?.length!==1||config.d1_databases[0].binding!=='DB'||config.d1_databases[0].database_id!=='00000000-0000-4000-8000-202610032032')throw new Error('Refusing non-synthetic D1 configuration');
if(config.triggers?.crons?.length)throw new Error('Refusing test config with cron schedules');
const identity=JSON.parse(readFileSync(join(worktree,'lib/deployment-identity.json'),'utf8'));
const {Miniflare}=await import(pathToFileURL(join(worktree,'node_modules/miniflare/dist/src/index.js')).href);
const serverRoot=join(worktree,'dist/server');
async function walk(dir){const entries=await fs.readdir(dir,{withFileTypes:true});const found=[];for(const ent of entries){const p=join(dir,ent.name);if(ent.isDirectory())found.push(...await walk(p));else if(ent.isFile()&&['.js','.mjs'].includes(p.slice(p.lastIndexOf('.'))))found.push(p);}return found;}
const paths=(await walk(serverRoot)).sort((a,b)=>a===join(serverRoot,'index.js')?-1:b===join(serverRoot,'index.js')?1:a.localeCompare(b));
if(!paths.length||paths[0]!==join(serverRoot,'index.js'))throw new Error('Built Worker entrypoint index.js is missing');
const modules=[];for(const path of paths)modules.push({type:'ESModule',path:relative(worktree,path).split(sep).join('/'),contents:await fs.readFile(path,'utf8')});
const mf=new Miniflare({
  modules,modulesRoot:worktree,
  compatibilityDate:config.compatibility_date,
  compatibilityFlags:config.compatibility_flags,
  assets:{directory:resolve(worktree,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
  d1Databases:{DB:config.d1_databases[0].database_id},
  d1Persist:resolve(worktree,'.wrangler/state/v3/d1'),
  bindings:config.vars||{}
});
await mf.getD1Database('DB');
let firstBridgeErrorLogged=false;
const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length']);
const server=createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'){res.writeHead(405,{'content-type':'application/json'});res.end('{"error":"E-002 test bridge accepts GET only"}');return;}
    const headers=new Headers();
    for(const [name,value] of Object.entries(req.headers))if(!hop.has(name.toLowerCase())&&value!==undefined&&['accept','accept-language','user-agent'].includes(name.toLowerCase()))headers.set(name,Array.isArray(value)?value.join(', '):value);
    const response=await mf.dispatchFetch(`http://127.0.0.1:${port}${req.url||'/'}`,{method:'GET',headers});
    const body=Buffer.from(await response.arrayBuffer()),outHeaders={};
    for(const [name,value] of response.headers)if(!['connection','keep-alive','transfer-encoding','upgrade'].includes(name.toLowerCase()))outHeaders[name]=value;
    res.writeHead(response.status,outHeaders);res.end(body);
  }catch(e){
    if(!firstBridgeErrorLogged){firstBridgeErrorLogged=true;console.error('E002_BRIDGE_EXCEPTION='+JSON.stringify({name:String(e?.name||'Error'),code:e?.code||null,message:String(e?.message||'').slice(0,300)}));}
    if(!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'local worker bridge error',name:String(e?.name||'Error')}));}
    else res.destroy();
  }
});
server.requestTimeout=30000;server.headersTimeout=15000;
await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveListen);});
const addr=server.address();
if(!addr||typeof addr==='string'||addr.address!=='127.0.0.1'){server.close();await mf.dispose();throw new Error('Loopback bind check failed');}
console.log('E002_LOCAL_WORKER_READY='+JSON.stringify({bindAddress:addr.address,port:addr.port,stage,workerName:config.name,sourceIdentity:identity.commit,d1Database:config.d1_databases[0].database_name,d1Id:config.d1_databases[0].database_id,cronSchedules:config.triggers.crons,explicitModuleCount:modules.length,mainModule:modules[0].path,runtime:'Miniflare built Worker with same-process loopback HTTP client'}));
const smokePath=join('/workspace/shared/engineering-qa/mizan-e002-2026-10-03','http-smoke-e002-v2.mjs');
process.argv.splice(1,process.argv.length-1,smokePath,stage,identity.commit,`http://127.0.0.1:${port}`);
try{await import(pathToFileURL(smokePath).href+`?stage=${stage}`);}finally{await new Promise(r=>server.close(r));await mf.dispose();}
