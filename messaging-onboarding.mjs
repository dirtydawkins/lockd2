// Quietly prepares a public messaging identity after ordinary account sign-in.
// Disabled/unconfigured messaging never interrupts account or owner operations.
import {privateRequest} from './private-client.mjs';
let generation=0;
function expose(kind,enabled){
 document.documentElement.dataset[kind==='messaging'?'lockdMessaging':'lockdAddress']=enabled?'enabled':'disabled';
 document.querySelectorAll(`[data-lockd-${kind}-entry]`).forEach(element=>{element.hidden=!enabled;});
}
async function prepare(){
 const current=++generation;
 try{
  const session=await window.LockdAccount.getSession();if(!session)return;
  const publish=(kind,enabled)=>{if(current===generation)expose(kind,enabled);};
  await Promise.allSettled([
   (async()=>{const capabilities=await privateRequest('messages',{view:'capabilities'},undefined,session.user.id);publish('messaging',capabilities.enabled===true);if(capabilities.enabled&&current===generation){const {ensureMessageDevice}=await import('./messaging-device.mjs');if(current===generation)await ensureMessageDevice();}})(),
   (async()=>{const capabilities=await privateRequest('documents',{view:'capabilities'},undefined,session.user.id);publish('address',capabilities.submissionsEnabled===true);})()
  ]);
 }catch{/* Account browsing stays independent of optional messaging provisioning. */}
}
window.addEventListener('lockd:auth-change',event=>{generation++;expose('messaging',false);expose('address',false);if(event.detail?.user)void prepare();});
void prepare();
