import {privateRequest,storageRequest,fetchResponse,node,action,status} from './private-client.mjs';
import {PROTOCOL,readPublic,encryptMessage,decryptMessage,encryptEvidence,encryptAttachment,decryptAttachment,hash,assertPinned} from './messaging-crypto.mjs';
import {stored} from './messaging-store.mjs';
import {ensureMessageDevice,createConnectionRequest,connectAnotherDevice,acceptConnection,removeMessageDevice} from './messaging-device.mjs';
import {RealtimeClient} from './vendor/realtime-2.118.0.min.mjs';
import {dialogUI} from './dialog-ui.mjs';

const $=selector=>document.querySelector(selector),notice=$('#messages-status');
const threadWelcome=$('#message-history').firstElementChild.cloneNode(true);
let user=null,capabilities=null,identity=null,privateKey=null,device=null,peer=null,conversations=[],active=null,connectionEpoch=0;
let inboxFilter='all',listingImageOrigin=null,inboxSignature=null;
function request(service,query={},body){if(!user)throw Error('Open your account to continue.');return privateRequest(service,query,body,user.id);}
let devices=[],messages=new Map(),decrypted=new Map(),selected=new Set(),pendingReport=null,epoch=0;
let realtime=null,channel=null,poll=null,loading=null,outbox=[],allEarlierLoaded=false,inboxPending=null,refreshPending=null;
const sending=new Set();
const objectURLs=new Set();
const reading=new Set(),readOnDevice=new Set();
const drafts=new Map(),previews=new Map();let syncCursor=null,pendingConversation=null;
const pretty=value=>String(value||'').replaceAll('_',' ');
function error(err){const message=err?.name==='TypeError'||err?.name==='TimeoutError'||err?.name==='AbortError'?'Messages couldn’t refresh. Check your connection and try Refresh.':err.message||'Messages could not be reached. Please try again.';status(notice,message,true);}
function fingerprint(value){return value?.match(/.{1,4}/g)?.join(' ')||'';}
function listingArtwork(item){
 const artwork=node('span',undefined,{class:'conversation-artwork','aria-hidden':'true'});
 artwork.append(node('span',(item.title||item.participant_name||'L').slice(0,1).toLocaleUpperCase()));
 try{const url=new URL(item.image,location.href);if(item.image&&(url.origin===location.origin||(url.origin===listingImageOrigin&&/^\/storage\/v1\/object\/(?:public|sign)\/lockd-listings\//.test(url.pathname)))&&!url.username&&!url.password){const image=node('img',undefined,{src:url.href,alt:'',loading:'lazy',width:'56',height:'56'});image.addEventListener('error',()=>image.remove(),{once:true});artwork.append(image);}}catch{}
 return artwork;
}
function showAccountAccess(){
 $('#messages-access').hidden=false;$('#messages-signin').href=window.LockdAccount.authLink({returnTo:location.pathname+location.search});status(notice,'');
}
function lock(message='Sign in to open your messages.'){
 epoch++;connectionEpoch++;privateKey=null;decrypted.clear();selected.clear();pendingReport=null;drafts.clear();previews.clear();syncCursor=null;
 inboxPending=null;refreshPending=null;inboxSignature=null;
 if(channel&&realtime)void realtime.removeChannel(channel);channel=null;realtime?.disconnect();realtime=null;clearInterval(poll);poll=null;
 for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();reading.clear();readOnDevice.clear();
 $('#message-workspace').hidden=true;$('#message-history').replaceChildren(threadWelcome.cloneNode(true));$('.message-thread').setAttribute('data-empty','');$('#message-text').value='';clearAttachment();$('#report-dialog').close();$('#new-message-dialog').close();$('#message-target-results').replaceChildren();$('#report-preview').replaceChildren();status(notice,message);
 active=null;conversations=[];$('#new-message').hidden=true;$('#retry-inbox').hidden=!user;if(!user)showAccountAccess();
}
async function getDevices(conversationId=null){return await request('messages',{view:'devices',...(conversationId?{conversationId}:{})});}
async function inbox(){
 if(inboxPending)return inboxPending;
 const accountId=user?.id,connection=connectionEpoch;
 const task=(async()=>{const items=await request('messages');if(user?.id!==accountId||connection!==connectionEpoch)return;
  const signature=JSON.stringify([Math.floor(Date.now()/300000),items.map(item=>({...item,image:item.image?.split('?')[0]||null}))]);
  const unchanged=signature===inboxSignature;inboxSignature=signature;conversations=items;
  if(!unchanged||!$('#conversations').children.length)renderInbox();
 })();inboxPending=task;
 try{return await task;}finally{if(inboxPending===task)inboxPending=null;}
}
function renderInbox(){
 const list=$('#conversations'),focusedId=document.activeElement?.closest('[data-conversation-id]')?.dataset.conversationId;list.replaceChildren();
 $('#message-workspace').classList.toggle('is-inbox-empty',!conversations.length);
 const term=$('#conversation-search').value.trim().toLocaleLowerCase();
 if(!conversations.length){const empty=node('div',undefined,{class:'inbox-empty'}),icon=node('span',undefined,{class:'inbox-empty-icon','aria-hidden':'true'});icon.append(threadWelcome.querySelector('svg').cloneNode(true));empty.append(icon,node('h3','No messages yet.'),node('p','Ask a lister about a rental. Your conversations and booking updates will appear here.'),node('a','Explore rentals',{href:'rentals.html',class:'text-button'}));list.append(empty);}
 for(const item of conversations){
  if((inboxFilter==='rental'&&item.booking_id)||(inboxFilter==='booking'&&!item.booking_id)||(inboxFilter==='unread'&&!Number(item.unread)))continue;
  if(term&&![item.participant_name,item.title].some(value=>String(value||'').toLocaleLowerCase().includes(term)))continue;
  const link=action('',()=>open(item.id).catch(error),'conversation-link');link.dataset.conversationId=item.id;link.setAttribute('aria-current',String(active?.id===item.id));
  const copy=node('span',undefined,{class:'conversation-copy'});copy.append(node('strong',item.title||item.participant_name||'Rental conversation'));
  if(item.participant_name)copy.append(node('span',item.participant_name,{class:'conversation-person'}));
  copy.append(node('span',item.blocked?'Conversation blocked':previews.get(item.id)||`${item.booking_id?'Reservation':'Rental enquiry'}`,{class:'conversation-preview'}));
  const meta=node('span',undefined,{class:'conversation-meta'}),date=new Date(item.updated_at||NaN);
  if(Number.isFinite(date.getTime()))meta.append(node('time',new Intl.DateTimeFormat(undefined,date.toDateString()===new Date().toDateString()?{hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'}).format(date),{datetime:date.toISOString()}));
  if(Number(item.unread)>0)meta.append(node('span',Number(item.unread)>99?'99+':String(item.unread),{class:'conversation-unread','aria-label':`${item.unread} unread messages`}));
  link.append(listingArtwork(item),copy,meta);list.append(link);
 }
 if(conversations.length&&!list.children.length)list.append(node('p','No conversations match. Try another name or filter.'));
 if(focusedId)list.querySelector(`[data-conversation-id="${CSS.escape(focusedId)}"]`)?.focus({preventScroll:true});
}
$('#conversation-search').addEventListener('input',renderInbox);
document.querySelectorAll('[data-inbox-filter]').forEach(button=>button.addEventListener('click',()=>{inboxFilter=button.dataset.inboxFilter;document.querySelectorAll('[data-inbox-filter]').forEach(control=>control.setAttribute('aria-pressed',String(control===button)));renderInbox();}));

// Start from the existing public catalogue, then use the participant-scoped RPC.
const targetDialog=$('#new-message-dialog'),targetQuery=$('#message-target-query'),targetResults=$('#message-target-results'),targetNotice=$('#message-target-status');
let targetRequest=null,targetSequence=0,targetDebounce;
const targetUI=dialogUI(targetDialog,{focus:()=>targetQuery,onOpen:()=>{targetQuery.value='';targetResults.replaceChildren();$('#message-target-back').hidden=true;status(targetNotice,'Search for a rental or lister by name.');}});
$('#new-message').addEventListener('click',()=>targetUI.open($('#new-message')));
targetDialog.addEventListener('close',()=>{targetSequence++;targetRequest?.abort();clearTimeout(targetDebounce);if(targetDialog.dataset.started){delete targetDialog.dataset.started;requestAnimationFrame(()=>$('#message-compose').hidden?$('#thread-title').focus():$('#message-text').focus());}});
async function publicTargets(url,signal){const response=await fetchResponse(url,{cache:'no-store',signal}),data=await response.json().catch(()=>null);if(!response.ok||!data||data.configured===false)throw Error('Search is unavailable right now. Please try again.');return data;}
function targetButton(item,lister=false){
 const button=action('',async()=>{try{
  if(lister){const current=++targetSequence;targetRequest?.abort();targetRequest=new AbortController();targetResults.replaceChildren();$('#message-target-back').hidden=false;status(targetNotice,'Finding rentals…');const data=await publicTargets('/api/listings?'+new URLSearchParams({view:'lister',lister:item.slug}),AbortSignal.any([targetRequest.signal,AbortSignal.timeout(15000)]));if(current!==targetSequence)return;const ids=data.item?.listingIds?.slice(0,24)||[];if(!ids.length){status(targetNotice,'This lister has no rentals to message about right now.');return;}const listings=await publicTargets('/api/listings?ids='+ids.join(','),targetRequest.signal);if(current!==targetSequence)return;targetResults.replaceChildren(...listings.items.map(row=>targetButton(row)));status(targetNotice,'Choose a rental to start your conversation.');return;}
  if(!user||!privateKey)throw Error('Reopen your messages to continue.');
  const accountId=user.id,id=await request('messages',{}, {action:'open',listingId:item.id});if(user?.id!==accountId)return;await inbox();if(!conversations.some(row=>row.id===id))throw Error('Your conversation could not be opened. Please refresh your inbox.');await open(id);targetDialog.dataset.started='true';targetUI.close();const url=new URL(location.href);url.searchParams.set('conversation',id);history.replaceState(null,'',url);
 }catch(err){if(err.name!=='AbortError')status(targetNotice,err.message||'This conversation could not be opened.',true);}},'message-target');
 const copy=node('span');copy.append(node('strong',lister?item.name:item.title));if(lister)copy.append(node('small','Choose one of their rentals'));else if(item.location_label)copy.append(node('small',item.location_label));button.append(listingArtwork(lister?{title:item.name}: {...item,image:item.images?.[0]}),copy);return button;
}
async function searchTargets(){
 clearTimeout(targetDebounce);targetRequest?.abort();const current=++targetSequence,query=targetQuery.value.trim();targetResults.replaceChildren();$('#message-target-back').hidden=true;
 if(query.length<2){status(targetNotice,'Enter at least two letters.');return;}
 targetRequest=new AbortController();const signal=AbortSignal.any([targetRequest.signal,AbortSignal.timeout(15000)]);status(targetNotice,'Searching…');
 const responses=await Promise.allSettled([publicTargets('/api/listings?'+new URLSearchParams({q:query}),signal),publicTargets('/api/listings?'+new URLSearchParams({view:'listers',q:query}),signal)]);if(current!==targetSequence||!targetDialog.open)return;
 let found=0;responses.forEach((result,index)=>{if(result.status!=='fulfilled')return;const items=result.value.items?.slice(0,6)||[];if(!items.length)return;found+=items.length;targetResults.append(node('h3',index?'Listers':'Rentals'),...items.map(item=>targetButton(item,Boolean(index))));});
 status(targetNotice,responses.some(result=>result.status==='rejected')?'Some results could not be loaded. Please try again.':found?'Choose a rental, or see a lister’s rentals.':'No rentals or listers matched. Try another name.');
}
$('#message-target-form').addEventListener('submit',event=>{event.preventDefault();void searchTargets();});
targetQuery.addEventListener('input',()=>{targetSequence++;targetRequest?.abort();clearTimeout(targetDebounce);targetResults.replaceChildren();if(targetQuery.value.trim().length>=2)targetDebounce=setTimeout(()=>void searchTargets(),400);else status(targetNotice,'Search for a rental or lister by name.');});
$('#message-target-back').addEventListener('click',()=>void searchTargets());
async function startRealtime(){
 const config=await window.LockdAccount.getConfig();
 if(config.messagingRealtimeEnabled===false)return;
 realtime=new RealtimeClient(config.supabase.url.replace('https:','wss:')+'/realtime/v1',{params:{apikey:config.supabase.publishableKey},accessToken:async()=> (await window.LockdAccount.getSession())?.access_token||null});
 await realtime.setAuth((await window.LockdAccount.getSession()).access_token);
}
async function subscribe(){
 if(!realtime)await startRealtime();
 if(!realtime){status($('#sync-status'),'');return;}
 if(channel)await realtime.removeChannel(channel);
 const context=active.id;
 channel=realtime.channel('lockd-conversation-'+context)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'lockd_encrypted_messages',filter:'conversation_id=eq.'+context},()=>{if(active?.id===context)void sync().catch(error);})
 .on('postgres_changes',{event:'*',schema:'public',table:'lockd_message_receipts',filter:'recipient_id=eq.'+peer?.user_id},()=>{if(active?.id===context)void sync().catch(error);})
 .subscribe(state=>{if(active?.id!==context)return;status($('#sync-status'),state==='SUBSCRIBED'?'':state==='CHANNEL_ERROR'||state==='TIMED_OUT'?'Trying to refresh. Your messages are still here.':'');});
}
async function open(id){
 const item=conversations.find(c=>c.id===id);if(!item)return;
 if(!privateKey){pendingConversation=id;await connectMessages();return;}
 if(active)drafts.set(active.id,$('#message-text').value);
 const current=++epoch;active=item;messages.clear();decrypted.clear();selected.clear();allEarlierLoaded=false;syncCursor=null;
 peer=null;$('#message-compose').hidden=true;$('#conversation-availability').hidden=true;status($('#compose-status'),'');renderInbox();
 $('#thread-search-field').hidden=true;$('#toggle-message-search').setAttribute('aria-expanded','false');$('#contact-check').open=false;$('#message-booking').hidden=true;$('#message-booking').replaceChildren();
 $('.message-thread').removeAttribute('data-empty');
 $('#message-workspace').classList.add('has-open-thread');
 $('#message-text').value=drafts.get(id)||'';$('#message-text').style.height='auto';clearAttachment();$('#message-search').value='';$('#report-dialog').close();pendingReport=null;
 $('#thread-title').textContent=item.title||'Rental conversation';$('#thread-person').textContent=item.participant_name||'';$('#thread-title').parentElement.querySelector('.thread-artwork')?.remove();const artwork=listingArtwork(item);artwork.classList.add('thread-artwork');$('#thread-title').parentElement.prepend(artwork);$('#message-history').replaceChildren(node('p','Opening your conversation…'));
 devices=await getDevices(id);if(current!==epoch)return;
 device=devices.find(d=>d.user_id===user.id && d.fingerprint===identity.fingerprint && !d.revoked_at);
 peer=devices.find(d=>d.user_id!==user.id && !d.revoked_at)||null;
 if(!device){lock('Message access changed. Reconnecting your account…');await connectMessages();return;}

 const links=$('#message-context');links.replaceChildren(node('a','View rental',{href:'rental.html?slug='+encodeURIComponent(item.slug||'')}));
 // The listing route uses its stored slug; no fabricated path from the title.
 if(!item.slug)links.replaceChildren(node('a','Browse rentals',{href:'rentals.html'}));
 if(item.booking_id)void loadBookingContext(item,current);
 $('#contact-check').hidden=false;$('#peer-fingerprint').textContent=peer?fingerprint(peer.fingerprint):'Your contact hasn’t opened private messages yet. You’ll be able to message them once they do.';
 let pin=peer?await stored(user.id,'contact:'+peer.user_id):null;
 if(peer&&!pin){await readPublic(peer.public_key,peer.fingerprint);pin={current:peer.fingerprint,verified:[peer.fingerprint],firstSeenAt:new Date().toISOString(),manualComparison:false};await stored(user.id,'contact:'+peer.user_id,pin);}
 $('#contact-reminder').hidden=!peer||(typeof pin==='string'?pin:pin?.current)===peer?.fingerprint;
 $('#fingerprint-compared').checked=false;$('#verify-contact').disabled=!peer;$('#block-contact').textContent=item.blocked?'Unblock contact':'Block contact';
 $('#message-compose').hidden=!peer || item.blocked;
 const availability=$('#conversation-availability');availability.hidden=Boolean(peer)&&!item.blocked;
 availability.textContent=item.blocked?'You blocked this conversation. You can unblock it in Conversation options.':!peer?'Your contact has not opened messages yet. You can write to them when they do.':'';
 await inbox();await sync(true);if(current!==epoch)return;await subscribe();
}
async function loadBookingContext(item,current){
 const panel=$('#message-booking');panel.hidden=false;panel.replaceChildren(node('p','Loading reservation…'));
 try{const context=await request('messages',{view:'bookingContext',conversationId:item.id});if(current!==epoch)return;
  if(!context){panel.hidden=true;return;}
  const bookingState={pending_owner:'Awaiting lister',awaiting_payment:'Awaiting payment',confirmed:'Confirmed',active:'In progress',completed:'Completed',cancelled:'Cancelled',expired:'Expired',rejected:'Declined'};
  const copy=node('div'),state=bookingState[context.status]||pretty(context.status);copy.append(node('strong',state),node('p',`Payment: ${pretty(context.paymentStatus)}`));
  const formatDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00')):'';
  const start=formatDate(context.startDate),end=formatDate(context.endDate);if(start&&end)copy.append(node('p',`${start} – ${end}`));
  if(context.events?.length){const updates=node('details');updates.append(node('summary','Reservation updates'));for(const event of context.events)updates.append(node('p',`${bookingState[event.status]||pretty(event.status)} · ${new Date(event.created_at).toLocaleString()}`));copy.append(updates);}
  panel.replaceChildren(copy,node('a','View reservation',{href:'trust.html?booking='+encodeURIComponent(item.booking_id)}));
 }catch{if(current===epoch)panel.replaceChildren(node('p','Reservation details couldn’t load.'),node('a','View reservation',{href:'trust.html?booking='+encodeURIComponent(item.booking_id)}));}
}
async function verifiedPeer(){
 if(!peer)throw Error('Your contact needs to open private messages before you can send.');
 const fresh=await getDevices(active.id),current=fresh.find(d=>d.user_id===peer.user_id && !d.revoked_at);
 if(!current || current.id!==peer.id || current.fingerprint!==peer.fingerprint)throw Error('Your contact’s security code changed. Refresh this conversation and compare codes with them.');
 const pinned=await stored(user.id,'contact:'+peer.user_id);
 try{assertPinned(typeof pinned==='string'?pinned:pinned?.current,peer.fingerprint);}catch{$('#contact-reminder').hidden=false;throw Error('Your contact’s security code changed. Check it with them before continuing.');}
 return await readPublic(peer.public_key,peer.fingerprint);
}
async function sync(initial=false,before=null){
 if(!active || !privateKey || loading===active.id)return;
 const context=active.id,current=epoch,key=privateKey;loading=context;
 try{
  const after=!initial&&!before&&syncCursor?String(syncCursor):null;
  const rows=await request('messages',{view:'history',conversationId:context,...(before?{before:String(before)}:{}),...(after?{after}:{})});let changed=initial||Boolean(before);
  if(current!==epoch)return;
  if(!before && rows.length)syncCursor=Math.max(...rows.map(row=>row.sequence));
  if(after){
   const latest=await request('messages',{view:'history',conversationId:context});if(current!==epoch)return;
   for(const row of latest){if(messages.has(row.id)){const old=messages.get(row.id);if(old.read_at!==row.read_at||old.delivered_at!==row.delivered_at)changed=true;messages.set(row.id,row);}}
  }
  if(before || initial)allEarlierLoaded=rows.length<40;
  const known=await getDevices(context);if(current!==epoch)return;devices=known;
  for(const row of rows){
   if(current!==epoch)return;
   const old=messages.get(row.id);if(!old||old.read_at!==row.read_at||old.delivered_at!==row.delivered_at)changed=true;
   messages.set(row.id,row);
   if(!decrypted.has(row.id)){
    try{
     const sender=known.find(d=>d.id===row.sender_device && d.user_id===row.sender_id);
     if(!sender)throw Error('Unknown sender device.');
     if(sender.user_id!==user.id){const pins=await stored(user.id,'contact:'+sender.user_id);assertPinned(typeof pins==='string'?pins:(pins?.verified||[]).find(fp=>fp===sender.fingerprint),sender.fingerprint);}
     const keyForSender=await readPublic(sender.public_key,sender.fingerprint);
     const payload=await decryptMessage(row,key,keyForSender);
     if(current!==epoch)return;
     decrypted.set(row.id,payload);changed=true;
     if(row.sender_id!==user.id)await request('messages',{}, {action:'acknowledge',id:row.id,read:false});
    }catch{if(current!==epoch)return;/* Locked/unverified rows remain ciphertext; do not acknowledge. */}
   }
  }
  if(current!==epoch)return;
  $('#older-messages').hidden=allEarlierLoaded||!messages.size;if(changed){render({prepend:Boolean(before)});const latest=[...messages.values()].sort((a,b)=>b.sequence-a.sequence).find(row=>decrypted.has(row.id));if(latest){const payload=decrypted.get(latest.id);previews.set(context,(latest.sender_id===user.id?'You: ':'')+(payload.text||'Attachment').replace(/\s+/g,' ').slice(0,120));renderInbox();}}
  acknowledgeVisible();
  if(initial)$('#message-history').scrollTop=$('#message-history').scrollHeight;
  if(after&&rows.length===40)queueMicrotask(()=>sync().catch(error));
 }finally{if(loading===context)loading=null;}
}
function acknowledgeVisible(){
 if(document.hidden||!privateKey||!user)return;
 const box=$('#message-history').getBoundingClientRect();
 for(const row of $('#message-history').querySelectorAll('[data-message-id]')){
  const id=row.dataset.messageId,item=messages.get(id),rect=row.getBoundingClientRect();
  if(!item||item.sender_id===user.id||!decrypted.has(id)||item.read_at||reading.has(id)||readOnDevice.has(id)||rect.bottom<=box.top||rect.top>=box.bottom||rect.bottom<=0||rect.top>=innerHeight)continue;
  reading.add(id);request('messages',{}, {action:'acknowledge',id,read:true}).then(()=>readOnDevice.add(id)).catch(()=>{}).finally(()=>reading.delete(id));
 }
}
function render({prepend=false}={}){
 for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();
 const container=$('#message-history'),query=$('#message-search').value.trim().toLocaleLowerCase(),top=container.scrollTop,height=container.scrollHeight,nearBottom=height-top-container.clientHeight<60;
 const focused=document.activeElement,focusedRow=focused?.closest('[data-message-id]'),focusIndex=focusedRow?[...focusedRow.querySelectorAll('button,input,summary')].indexOf(focused):-1;
 const openMenus=new Set([...container.querySelectorAll('[data-message-id] details[open]')].map(el=>el.closest('[data-message-id]').dataset.messageId));
 container.replaceChildren();let day='';
 const sorted=[...messages.values()].sort((a,b)=>a.sequence-b.sequence);
 for(const row of sorted){
  const payload=decrypted.get(row.id);
  if(query && !payload?.text.toLocaleLowerCase().includes(query))continue;
  const date=new Date(row.created_at).toLocaleDateString();if(day!==date){container.append(node('p',date,{class:'message-day'}));day=date;}
  const element=node('article',undefined,{class:'message-row','data-self':String(row.sender_id===user.id),'data-message-id':row.id});
  element.append(node('p',payload?(payload.text||'Attachment'):'This message can’t be opened on this browser. Check Settings & privacy.'));
  const footer=node('footer');footer.append(node('time',new Date(row.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),{datetime:row.created_at}));
  if(row.sender_id===user.id)footer.append(node('span',row.read_at?'Read':row.delivered_at?'Delivered':'Sent'));
  if(payload){
   if(Array.isArray(payload.attachments))for(const attachment of payload.attachments){
    element.append(action('Open '+(attachment.mime==='application/pdf'?'PDF attachment':'image attachment'),async()=>{
     try{
      if(!/^[a-f0-9-]{36}$/.test(attachment.id)||!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(attachment.mime))throw Error('Invalid attachment.');
      const response=await storageRequest('lockd-chat-private',row.conversation_id+'/'+attachment.id);
      const cipher=new Uint8Array(await response.arrayBuffer());if(!privateKey)return;
      const sender=devices.find(d=>d.id===row.sender_device),key=await readPublic(sender.public_key,sender.fingerprint);
      const bytes=await decryptAttachment(cipher,attachment,privateKey,key);
      const url=URL.createObjectURL(new Blob([bytes],{type:attachment.mime}));objectURLs.add(url);
      if(attachment.mime==='application/pdf'){
       element.append(node('p','Encrypted files cannot be malware-scanned by LOCKD. Open PDFs only in a trusted, updated viewer.'));
       element.append(node('a','Download PDF',{href:url,download:'rental-document.pdf'}));
      }else{
       const img=node('img',undefined,{src:url,alt:'Private conversation attachment',loading:'lazy',class:'chat-attachment-image'});element.append(img);
      }
     }catch(err){error(err);}
    }));
   }
   const more=node('details',undefined,{class:'message-more'});more.open=openMenus.has(row.id);more.append(node('summary','More'));
   more.append(action('Reply',async()=>{$('#message-text').value=`Replying to: ${payload.text.slice(0,180)}\n\n`;$('#message-text').focus();}));
   more.append(action('Copy text',async()=>{try{await navigator.clipboard.writeText(payload.text);}catch{status(notice,'Select the message text to copy it.');}}));
   const select=node('input',undefined,{type:'checkbox','aria-label':'Select this message for a report'});select.checked=selected.has(row.id);select.addEventListener('change',()=>{select.checked?selected.add(row.id):selected.delete(row.id);$('#report-messages').hidden=!selected.size;});const selectLabel=node('label','Select for report');selectLabel.prepend(select);more.append(selectLabel);
   more.append(action('Report message',async()=>{selected.add(row.id);$('#report-messages').click();}));footer.append(more);
  }
  element.append(footer);container.append(element);
 }
 for(const item of outbox.filter(x=>x.conversationId===active?.id)){
  const element=node('article',undefined,{class:'message-row','data-self':'true'});element.append(node('p',item.failed?'Message not sent. Your draft is saved in this browser.':'Sending your message…'));
  element.append(action('Retry',()=>sendOutbox(item).catch(error)));container.append(element);
 }
 if(!container.children.length)container.append(node('p',query?'No matches here. Try loading earlier messages.':'No messages yet.'));
 $('#report-messages').hidden=!selected.size;
 container.scrollTop=prepend?top+(container.scrollHeight-height):nearBottom?container.scrollHeight:top;
 if(focusIndex>=0)container.querySelector(`[data-message-id="${CSS.escape(focusedRow.dataset.messageId)}"]`)?.querySelectorAll('button,input,summary')[focusIndex]?.focus({preventScroll:true});
 acknowledgeVisible();
}
async function sendOutbox(item){
 if(!privateKey||sending.has(item.clientId))return;
 if(active?.id!==item.conversationId)throw Error('Open this conversation to send your saved message.');
 const accountId=user.id,context=active.id,current=epoch;sending.add(item.clientId);
 try{
  await verifiedPeer();
  if(user?.id!==accountId||epoch!==current||active?.id!==context)throw Error('Your message is saved. Open this conversation to try again.');
  const result=await request('messages',{}, {action:'send',...item});
  if(user?.id!==accountId)return;
  outbox=outbox.filter(x=>x.clientId!==item.clientId);await stored(accountId,'outbox',outbox);
  if(active?.id===item.conversationId){messages.set(result.id,result);await sync();render();}
  if(active?.id===context)status($('#compose-status'),'');
 }catch(err){if(user?.id===accountId){item.failed=true;await stored(accountId,'outbox',outbox);render();}throw err;}finally{sending.delete(item.clientId);}
}
async function connectMessages(){
 try{
  const accountId=user?.id,currentConnection=++connectionEpoch;
  status(notice,'Opening your messages…');const result=await ensureMessageDevice();if(currentConnection!==connectionEpoch||user?.id!==accountId||(result.userId&&result.userId!==accountId))return;capabilities=result.capabilities;
  if(result.state==='signed_out'){lock();return;}
  if(result.state==='disabled'){$('#message-workspace').hidden=true;status(notice,'Messaging is unavailable right now. Please try again later.');return;}
  const config=await window.LockdAccount.getConfig();listingImageOrigin=new URL(config.supabase.url).origin;
  $('#messages-access').hidden=true;$('#retry-inbox').hidden=true;$('#new-message').hidden=true;
  $('#message-workspace').hidden=false;await inbox();
  $('.message-attachment-control').hidden=capabilities.attachmentsEnabled!==true;
  if(result.state==='another_device'){
   device=result.active;$('#message-device').hidden=false;$('#message-workspace').classList.add('is-locked','has-open-thread');status(notice,'Approve this browser from one you already use for messages.');return;
  }
  identity=result.identity;privateKey=result.privateKey;device=result.device;
  $('#new-message').hidden=false;
  $('#own-fingerprint').textContent=fingerprint(identity.fingerprint);outbox=(await stored(user.id,'outbox'))||[];
  $('#message-device').hidden=true;$('#message-workspace').classList.remove('is-locked');status(notice,'');
  const url=new URL(location.href);
  if(url.searchParams.has('listing')){
   const conversationId=await request('messages',{}, {action:'open',listingId:url.searchParams.get('listing'),bookingId:url.searchParams.get('booking')||undefined});await inbox();url.searchParams.delete('listing');url.searchParams.delete('booking');url.searchParams.set('conversation',conversationId);history.replaceState(null,'',url);await open(conversationId);
  }else if(pendingConversation){const selected=pendingConversation;pendingConversation=null;await open(selected);}
  else if(conversations.some(c=>c.id===url.searchParams.get('conversation')))await open(url.searchParams.get('conversation'));
  else if(conversations.length&&matchMedia('(min-width:761px)').matches)await open(conversations[0].id);
  else $('#message-workspace').classList.remove('has-open-thread');
  clearInterval(poll);poll=setInterval(()=>{if(!document.hidden&&privateKey)void refreshMessages().catch(error);},10000);
 }catch(err){lock(err.message||'Your messages couldn’t open. Please try again.');}
}
$('#verify-contact').addEventListener('click',async()=>{try{
 if(!$('#fingerprint-compared').checked || !peer)throw Error('Please check that the full code matches with your contact first.');
 await readPublic(peer.public_key,peer.fingerprint);const previous=await stored(user.id,'contact:'+peer.user_id);const verified=typeof previous==='string'?[previous]:previous?.verified||[];await stored(user.id,'contact:'+peer.user_id,{current:peer.fingerprint,verified:[...new Set([...verified,peer.fingerprint])]});decrypted.clear();await sync();$('#contact-reminder').hidden=true;$('#contact-check').open=false;status(notice,'Contact confirmed. You can now message each other.');
}catch(err){error(err);}});
$('#message-compose').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button'),text=$('#message-text').value.trim(),file=$('#chat-file').files[0];if((!text&&!file)||!active||!privateKey)return;button.disabled=true;status($('#compose-status'),'Sending…');
 try{
  const current=epoch,context=active.id,senderDevice=device.id,recipientDevice=peer?.id;
  const recipient=await verifiedPeer(),self=await readPublic(identity.publicKey,identity.fingerprint),clientId=crypto.randomUUID();
  if(current!==epoch)throw Error('Conversation changed. Review your draft before sending.');
  const attachments=[];
  if(file){
   if(file.size>2097152)throw Error('Choose an image or PDF up to 2 MB.');
   const encrypted=await encryptAttachment(new Uint8Array(await file.arrayBuffer()),privateKey,[self,recipient]);
   if(current!==epoch)throw Error('Conversation changed. Review your draft before sending.');
   const id=crypto.randomUUID(),reservation=await request('messages',{}, {action:'reserveAttachment',conversationId:context,id,bytes:encrypted.ciphertext.length});
   await storageRequest(reservation.bucket,reservation.path,{method:'POST',data:encrypted.ciphertext});
   attachments.push({id,mime:encrypted.mime,bytes:encrypted.bytes,sha256:encrypted.sha256});
  }
  const payload={protocol:PROTOCOL,text,conversationId:context,clientId,senderDevice,recipientDevice,attachments};
  const ciphertext=await encryptMessage(payload,privateKey,[self,recipient]);
  if(current!==epoch)throw Error('Conversation changed. Review your draft before sending.');
  const item={conversationId:context,clientId,senderDevice,recipientDevice,ciphertext,attachmentIds:attachments.map(a=>a.id)};
  outbox.push(item);await stored(user.id,'outbox',outbox);$('#message-text').value='';$('#message-text').style.height='auto';drafts.delete(context);clearAttachment();render();await sendOutbox(item);
 }catch(err){status($('#compose-status'),err.message,true);}finally{button.disabled=false;}
});
$('#older-messages').addEventListener('click',()=>{const before=Math.min(...[...messages.values()].map(m=>m.sequence));void sync(false,before).catch(error);});
function clearAttachment(){ $('#chat-file').value='';$('#attachment-name').textContent='';$('#remove-attachment').hidden=true; }
$('#message-search').addEventListener('input',render);
$('#toggle-message-search').addEventListener('click',()=>{const field=$('#thread-search-field');field.hidden=!field.hidden;$('#toggle-message-search').setAttribute('aria-expanded',String(!field.hidden));if(!field.hidden)$('#message-search').focus();else{$('#message-search').value='';render();}});
$('#message-search').addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();$('#thread-search-field').hidden=true;$('#toggle-message-search').setAttribute('aria-expanded','false');$('#message-search').value='';render();$('#toggle-message-search').focus();}});
document.addEventListener('click',event=>{if($('#contact-check').open&&!$('#contact-check').contains(event.target))$('#contact-check').open=false;});
$('#contact-check').addEventListener('keydown',event=>{if(event.key==='Escape'){$('#contact-check').open=false;$('#contact-check>summary').focus();}});
$('#message-history').addEventListener('scroll',acknowledgeVisible,{passive:true});
$('#chat-file').addEventListener('change',()=>{$('#attachment-name').textContent=$('#chat-file').files[0]?.name||'';$('#remove-attachment').hidden=!$('#chat-file').files.length;});
$('#remove-attachment').addEventListener('click',()=>{clearAttachment();$('#attachment-name').textContent='';$('#remove-attachment').hidden=true;});
$('#message-text').addEventListener('input',()=>{const field=$('#message-text');field.style.height='auto';field.style.height=Math.min(field.scrollHeight,144)+'px';});
$('#message-text').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('#message-compose button').disabled)$('#message-compose').requestSubmit();}});
async function refreshMessages(){
 if(refreshPending)return refreshPending;
 const connection=connectionEpoch,accountId=user?.id;
 const task=(async()=>{await inbox();if(connection!==connectionEpoch||accountId!==user?.id)return;
  if(active&&!peer){const known=await getDevices(active.id);if(known.some(item=>item.user_id!==user.id&&!item.revoked_at)){await open(active.id);return;}}
  await sync();if(notice.dataset.kind==='error')status(notice,'');
 })();refreshPending=task;try{return await task;}finally{if(refreshPending===task)refreshPending=null;}
}
$('#refresh-inbox').addEventListener('click',()=>refreshMessages().catch(error));
$('#back-to-inbox').addEventListener('click',()=>{$('#message-workspace').classList.remove('has-open-thread');($('#conversations [aria-current=true]')||$('#conversations button'))?.focus();});
$('#retry-inbox').addEventListener('click',()=>{if(user)void connectMessages();});
$('#confirm-contact').addEventListener('click',()=>{$('#contact-check').open=true;$('#security-details').open=true;$('#fingerprint-compared').focus();});
$('#block-contact').addEventListener('click',async()=>{if(!active)return;try{await request('messages',{}, {action:'block',conversationId:active.id,block:!active.blocked});await inbox();await open(active.id);}catch(err){error(err);}});
function downloadConnection(data,name,type='application/json'){
 const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data)],{type})),link=node('a','',{href:url,download:name});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#create-link-request').addEventListener('click',async()=>{try{const link=await createConnectionRequest(user.id);$('#connection-request-code').textContent='Connection code: '+fingerprint(link.fingerprint);downloadConnection(link,'lockd-connection-request.json');status($('#connection-status'),'Open this request on your existing browser, then bring its connection file back here.');}catch(err){error(err);}});
$('#create-device-transfer').addEventListener('click',async()=>{try{
 if(!$('#device-link-confirm').checked)throw Error('Check that the connection code matches your new browser first.');
 const file=$('#device-link-request').files[0];if(!file||file.size>20000)throw Error('Choose the connection request from your new browser.');
 const link=JSON.parse(await file.text()),encrypted=await connectAnotherDevice(user.id,link);downloadConnection(encrypted,'lockd-device-connection.lockd','application/octet-stream');status(notice,'Open the connection file on your new browser within 10 minutes.');
}catch(err){error(err);}});
$('#device-link-request').addEventListener('change',async()=>{try{const file=$('#device-link-request').files[0];if(!file||file.size>20000)throw Error('Choose a valid connection request.');const link=JSON.parse(await file.text());await readPublic(link.publicKey,link.fingerprint);$('#device-link-code').textContent='Connection code: '+fingerprint(link.fingerprint);$('#device-link-confirm').checked=false;}catch(err){error(err);}});
$('#accept-device-transfer').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file||file.size>262144)throw Error('Choose the connection file from your existing browser.');await acceptConnection(user.id,await file.text());await connectMessages();}catch(err){status($('#connection-status'),err.message,true);}finally{event.target.value='';}});
$('#retry-message-access').addEventListener('click',()=>connectMessages());
$('#revoke-device').addEventListener('click',async()=>{try{if(!$('#remove-access-confirm').checked)throw Error('Review and confirm the effect on your old messages first.');await removeMessageDevice(user.id,device.id);lock('Message access removed.');identity=null;await connectMessages();}catch(err){error(err);}});
$('#report-messages').addEventListener('click',()=>{
 const records=[...selected].map(id=>({row:messages.get(id),payload:decrypted.get(id)})).filter(x=>x.row&&x.payload);
 if(!records.length||records.length>30){error(Error('Select between 1 and 30 readable messages.'));return;}
 pendingReport={clientId:crypto.randomUUID(),conversationId:active.id,messages:records.map(({row,payload})=>({id:row.id,senderId:row.sender_id,createdAt:row.created_at,ciphertext:row.ciphertext,payload}))};
 const canShare=Boolean(capabilities.investigatorKey&&capabilities.investigatorFingerprint);
 $('#report-description').textContent=canShare?'Only the messages shown here will be shared with LOCKD for review. Attachments are not included. We can’t read the rest of your conversation.':'Report a concern about this conversation. Your message text and attachments will stay private.';
 $('#report-consent-label').textContent=canShare?'I agree to share these messages with LOCKD for this report.':'I agree to send this concern and the selected message references to LOCKD.';
 $('#report-preview').replaceChildren(...(canShare?pendingReport.messages.map(item=>node('p',item.payload.text)):[node('p',`${pendingReport.messages.length} message reference${pendingReport.messages.length===1?'':'s'} selected. No message content will be shared.`)]));$('#report-form').reset();$('#report-dialog').showModal();
});
$('#close-report').addEventListener('click',()=>{$('#report-dialog').close();pendingReport=null;$('#report-preview').replaceChildren();});
$('#report-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!pendingReport||!privateKey)return;const form=event.currentTarget,button=form.querySelector('[type=submit]'),message=form.querySelector('[role=status]');button.disabled=true;
 try{
  const body={action:'reportConcern',conversationId:pendingReport.conversationId,clientId:pendingReport.clientId,category:form.elements.category.value,ids:pendingReport.messages.map(m=>m.id),deviceId:device.id};
  if(capabilities.investigatorKey&&capabilities.investigatorFingerprint){
   const publicKey=await readPublic(capabilities.investigatorKey,capabilities.investigatorFingerprint);
   const evidence=await encryptEvidence({...pendingReport,disclosure:'selected_messages_only',submittedAt:new Date().toISOString()},privateKey,publicKey);
   Object.assign(body,{action:'report',evidence,fingerprint:capabilities.investigatorFingerprint,sha256:await hash(evidence)});
  }
  const id=await request('messages',{},body);
  $('#report-dialog').close();pendingReport=null;selected.clear();$('#report-preview').replaceChildren();render();status(notice,'Your report was received. Reference '+id.slice(0,8)+'.');await myReports();
 }catch(err){status(message,err.message,true);}finally{button.disabled=false;}
});
async function myReports(){const items=await request('messages',{view:'reports'}),target=$('#my-message-reports');target.replaceChildren(...(items.length?items.map(r=>node('p',`${r.id.slice(0,8)} · ${pretty(r.category)} · ${pretty(r.status)}`)):[node('p','No reports submitted.')]));}
$('#message-reports-panel').addEventListener('toggle',()=>{if($('#message-reports-panel').open&&user){$('#my-message-reports').replaceChildren(node('p','Loading your reports…'));void myReports().catch(()=>$('#my-message-reports').replaceChildren(node('p','Reports could not be loaded. Close and reopen this section to try again.')));}});
window.addEventListener('online',()=>{if(privateKey)void sync().catch(error);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&privateKey)void sync().catch(error);});
window.addEventListener('pagehide',()=>lock());
window.addEventListener('pageshow',event=>{if(event.persisted&&user)void connectMessages();});
window.addEventListener('lockd:auth-change',event=>{if(user && event.detail?.user?.id!==user.id){user=null;lock('Sign in again to open your messages.');identity=null;outbox=[];}});
try{
 const session=await window.LockdAccount.getSession();user=session?.user||null;
 if(!user)showAccountAccess();
 else await connectMessages();
}catch(err){error(err);}
