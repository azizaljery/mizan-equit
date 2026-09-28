// Preserve the existing release stamp. Bundle the same identity in the app route
// so verification does not rely on a static asset fallback in the Worker router.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function stampDeploymentRoute(root,expectedSha){
 if(!/^[a-f0-9]{40}$/.test(expectedSha||''))throw Error('Invalid expected release.');
 const data=JSON.parse(await readFile(resolve(root,'public/mizan-deployment.json'),'utf8'));
 if(data.worker!=='mizan-equity'||data.commit!==expectedSha||typeof data.generatedAt!=='string'||!Number.isFinite(Date.parse(data.generatedAt)))throw Error('Release stamp does not match build.');
 await mkdir(resolve(root,'lib'),{recursive:true});
 await writeFile(resolve(root,'lib/deployment-identity.json'),JSON.stringify({worker:data.worker,commit:data.commit,generatedAt:data.generatedAt})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 stampDeploymentRoute(process.cwd(),process.env.GITHUB_SHA).catch(()=>{console.error('Cannot stamp release route; build must stop.');process.exitCode=1;});
}
