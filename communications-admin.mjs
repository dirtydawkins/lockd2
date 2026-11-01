// Only voluntarily disclosed evidence. No ordinary chat decryption key exists on the server.
import {privateRequest,node,action,label,status} from './private-client.mjs';
const root=document.querySelector('#communication-reviews');
let accountId=null;
function request(service,query={},body){if(!accountId)throw Error('Reload your account to continue.');return privateRequest(service,query,body,accountId);}
window.addEventListener('lockd:auth-change',event=>{if(accountId&&event.detail?.user?.id!==accountId){accountId=null;root?.replaceChildren();if(root)root.hidden=true;}});
if(root){
 try{
  const session=await window.LockdAccount.getSession();
  accountId=session?.user?.id||null;
  if(session?.user?.app_metadata?.role==='admin' && (await request('messages',{view:'capabilities'})).enabled){
   root.hidden=false;
   const queue=node('div'),detail=node('div'),notice=node('p','',{role:'status'});
   root.append(node('h2','Communication reports'),node('p','Review only the evidence a participant chose to disclose. A report does not establish misconduct.'),queue,detail,notice);
   const refresh=async()=>{
    const items=await request('messages',{view:'reviewQueue'});queue.replaceChildren();
    if(!items.length)queue.append(node('p','No communication reports to review.'));
    for(const item of items)queue.append(action(`${item.id.slice(0,8)} · ${item.category.replaceAll('_',' ')} · ${item.status.replaceAll('_',' ')}`,async()=>{
     try{
      const evidence=await request('messages',{view:'evidence',id:item.id}),report=evidence.report;
      detail.replaceChildren(node('h3','Report '+item.id.slice(0,8)),node('p','Encrypted for investigator fingerprint '+report.investigator_fingerprint));
      const open=node('form',undefined,{class:'account-form'}),file=node('input',undefined,{type:'file',accept:'.json',required:''}),pass=node('input',undefined,{type:'password',autocomplete:'off',required:''}),decrypted=node('div'),message=node('p','',{role:'status'});
      open.append(label('Authorized investigator encrypted-key backup',file),label('Investigator key passphrase',pass),node('button','Open disclosed evidence',{type:'submit',class:'button button-light'}),message);
      open.addEventListener('submit',async event=>{
       event.preventDefault();const button=open.querySelector('button');button.disabled=true;
       try{
        const {readPublic,unlock,decryptEvidence,hash,PROTOCOL}=await import('./messaging-crypto.mjs');
        const source=file.files[0];if(!source||source.size>60000)throw Error('Choose an authorized encrypted key backup.');
        const backup=JSON.parse(await source.text()),identity=backup.identity;
        if(identity?.protocol!==PROTOCOL||identity.fingerprint!==report.investigator_fingerprint)throw Error('The investigator key does not match this report.');
        await readPublic(identity.publicKey,identity.fingerprint);const key=await unlock(identity,pass.value);
        if(await hash(report.encrypted_evidence)!==report.evidence_sha256)throw Error('Evidence integrity check failed.');
        const reporter=await readPublic(evidence.reporterKey.publicKey,evidence.reporterKey.fingerprint),copy=await decryptEvidence(report.encrypted_evidence,key,reporter);
        if(copy.conversationId!==report.conversation_id||copy.clientId!==report.client_id||!Array.isArray(copy.messages)||copy.messages.length!==report.selected_message_ids.length||copy.messages.some(m=>!report.selected_message_ids.includes(m.id)))throw Error('Evidence context does not match its submission.');
        if(!accountId||(await window.LockdAccount.getSession())?.user?.id!==accountId)throw Error('Your account changed. Reload this page to continue.');
        decrypted.replaceChildren(node('p','Participant-disclosed copies. The reporter’s signature is verified; other participant statements are not independently authenticated by this report.'));
        for(const m of copy.messages)decrypted.append(node('p',m.payload?.text||'[No text excerpt]'));
        status(message,'Disclosed evidence decrypted locally.');
       }catch(error){status(message,error.message||'Could not open evidence.',true);}finally{pass.value='';file.value='';button.disabled=false;}
      });
      detail.append(open,decrypted);
      const form=node('form',undefined,{class:'account-form'}),select=node('select'),reason=node('textarea',undefined,{minlength:'10',maxlength:'2000',required:'',rows:'4'}),state=node('p','',{role:'status'});
      for(const value of ['under_review','additional_information_required','escalated','resolved','dismissed'])select.append(node('option',value.replaceAll('_',' '),{value}));
      form.append(label('Review status',select),label('Reason · visible to the reporter',reason),node('button','Record review',{type:'submit',class:'button button-dark'}),state);
      form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('messages',{}, {action:'reviewReport',id:report.id,status:select.value,reason:reason.value});detail.replaceChildren(node('p','Review recorded. No account, reservation or payment was changed.'));await refresh();}catch(error){status(state,error.message,true);}finally{button.disabled=false;}});
      if(!['resolved','dismissed'].includes(report.status))detail.append(form);
      detail.append(node('h4','Access & review audit'));for(const entry of evidence.audit)detail.append(node('p',`${entry.event.replaceAll('_',' ')} · ${new Date(entry.created_at).toLocaleString()}`));
     }catch(error){status(notice,error.message,true);}
    }));
   };
   root.append(action('Refresh report queue',()=>refresh().catch(error=>status(notice,error.message,true))));
   await refresh();
  }
 }catch{root.hidden=true;}
}
