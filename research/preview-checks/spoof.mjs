// Read-only spoofing probe: forged identity headers / forged token must not grant owner access.
// Distinguishes Access-level blocking (redirect to *.cloudflareaccess.com, before the Worker) from app-level denial (401/403 from the Worker).
const [host,label,ownerEmail,outFile]=process.argv.slice(2);const BASE='https://'+host;const fs=await import('node:fs');
const forgedHeaders={'oai-authenticated-user-email':ownerEmail,'cf-access-authenticated-user-email':ownerEmail,'oai-authenticated-user-id':'victim'};
const junkJwt='eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJlbWFpbCI6Im93bmVyIn0.c2ln';
const cases=[
 ['GET /api/research (no identity)','/api/research',{}],
 ['GET /api/research forged owner headers','/api/research',forgedHeaders],
 ['GET /api/research forged headers + junk Cf-Access-Jwt-Assertion','/api/research',{...forgedHeaders,'cf-access-jwt-assertion':junkJwt}],
 ['GET /api/research forged CF_Authorization cookie','/api/research',{...forgedHeaders,cookie:'CF_Authorization='+junkJwt}],
 ['GET /api/admin/signin forged owner headers','/api/admin/signin?return_to=%2F',forgedHeaders],
 ['GET /api/market-watch forged user headers','/api/market-watch',forgedHeaders],
];
const res=[];for(const [name,path,headers] of cases){const r=await fetch(BASE+path,{headers,redirect:'manual'});const loc=r.headers.get('location')||'';const body=(await r.text()).slice(0,160);
 const layer=r.status>=300&&r.status<400&&/cloudflareaccess\.com/.test(loc)?'Access (edge, before Worker)':r.status===401||r.status===403?'app (Worker)':'other';
 const granted=r.status===200||(r.status>=300&&r.status<400&&!/cloudflareaccess\.com/.test(loc));
 res.push({name,status:r.status,layer,granted,location:loc.replace(/\?.*/,'?…'),body:body.replace(/\s+/g,' ')});}
fs.writeFileSync(outFile,JSON.stringify({host,label,results:res},null,1));console.log(label,JSON.stringify(res.map(r=>[r.name,r.status,r.layer,r.granted?'GRANTED':'denied'])));
