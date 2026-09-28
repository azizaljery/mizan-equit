/** Stamp the checked-out revision in both GitHub Actions and Workers Builds.
 * Cloudflare documents WORKERS_CI_COMMIT_SHA; never ship the null placeholder.
 */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function resolveBuildRevision(env,gitSha=null){
 const hints=[env.GITHUB_SHA,env.WORKERS_CI_COMMIT_SHA].filter(v=>v!==undefined&&v!=='');
 if(hints.some(v=>typeof v!=='string'||! /^[a-f0-9]{40}$/.test(v)))throw Error('Invalid CI revision.');
 if(gitSha!==null&&!/^[a-f0-9]{40}$/.test(gitSha))throw Error('Invalid checkout revision.');
 const candidates=new Set([...hints,...(gitSha?[gitSha]:[])]);
 if(candidates.size===0)throw Error('A verified checkout revision is required.');
 if(candidates.size!==1)throw Error('CI revision differs from checked-out source.');
 return [...candidates][0];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const root=resolve(process.argv[2]||process.cwd());let gitSha=null;
  try{gitSha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();}catch{}
  process.stdout.write(resolveBuildRevision(process.env,gitSha)+'\n');
 }catch{console.error('Cannot verify build revision; refusing an unstamped production build.');process.exitCode=1;}
}
