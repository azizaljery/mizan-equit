/**
 * Gate for automatic re-requests of an owner-only endpoint from a public page.
 * After a visitor denial (401 SIGN_IN_REQUIRED) or a non-owner denial (403 OWNER_REQUIRED) the page stops
 * AUTOMATIC re-requests (effects firing on every analysis change). It never blocks:
 *  - explicit retries (buttons, after a save),
 *  - a re-check when the tab regains focus/visibility (the user may have signed in, out, or switched account elsewhere).
 * Any 2xx clears the denial; a later 401/403 (session expired, user switched) sets it again.
 * Endpoint protection is unchanged: the server still decides every request.
 */
export type OwnerDenial='SIGN_IN_REQUIRED'|'OWNER_REQUIRED';
export type FetchTrigger='auto'|'explicit'|'focus';
export function createOwnerFetchGate(){
 let denied:OwnerDenial|null=null;
 return {
  allow(trigger:FetchTrigger){return trigger!=='auto'||denied===null;},
  record(status:number,code?:string){
   if(status>=200&&status<300){denied=null;return;}
   if(status===401&&code==='SIGN_IN_REQUIRED')denied='SIGN_IN_REQUIRED';
   else if(status===403&&code==='OWNER_REQUIRED')denied='OWNER_REQUIRED';
  },
  get denied(){return denied;},
 };
}
