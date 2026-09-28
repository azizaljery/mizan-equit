// Check the generated public stamp, the app import, and the actual entry bundle.
// No marker is manufactured here and no missing evidence is treated as success.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function verifyReleaseBundle(root,expectedSha){
 if(!/^[a-f0-9]{40}$/.test(expectedSha||''))throw Error('invalid-release-sha');
 const publicStamp=JSON.parse(await readFile(resolve(root,'public/mizan-deployment.json'),'utf8'));
 const bundledStamp=JSON.parse(await readFile(resolve(root,'lib/deployment-identity.json'),'utf8'));
 const entry=await readFile(resolve(root,'dist/server/index.js'),'utf8');
 const checks={publicCommit:publicStamp.commit===expectedSha,bundledCommit:bundledStamp.commit===expectedSha,
  identicalMetadata:JSON.stringify(publicStamp)===JSON.stringify(bundledStamp),
  entryContainsCommit:entry.includes(expectedSha),entryContainsReleaseRoute:entry.includes('mizan-deployment.json')};
 const report={checkedAt:new Date().toISOString(),expectedSha,checks,status:Object.values(checks).every(Boolean)?'passed':'failed'};
 await mkdir(resolve(root,'verify-out'),{recursive:true});
 await writeFile(resolve(root,'verify-out/release-bundle.json'),JSON.stringify(report,null,2)+'\n');
 if(report.status!=='passed')throw Error('release-bundle-mismatch');
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 verifyReleaseBundle(process.cwd(),process.env.GITHUB_SHA).then(r=>console.log('MIZAN_RELEASE_BUNDLE='+JSON.stringify(r))).catch(()=>{console.error('Release metadata is not present in the actual bundle; deployment stopped.');process.exitCode=1;});
}
