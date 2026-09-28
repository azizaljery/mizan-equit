/** Public release metadata only; no environment variables or credentials. */
export function deploymentIdentityResponse(value:unknown):Response {
 const data=value as {worker?:unknown;commit?:unknown;generatedAt?:unknown}|null;
 const headers={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'};
 if(!data||data.worker!=='mizan-equity'||typeof data.commit!=='string'||!/^[a-f0-9]{40}$/.test(data.commit)||typeof data.generatedAt!=='string'||!Number.isFinite(Date.parse(data.generatedAt)))
  return Response.json({error:'Release identity is not stamped.'},{status:503,headers});
 return Response.json({worker:data.worker,commit:data.commit,generatedAt:data.generatedAt},{headers});
}
