const {endpoint,uuid,text}=require('../lib/private-rpc');
const {signImages}=require('./listing-images');
const validId=x=>uuid.test(x||'');
module.exports=endpoint((method,q,b)=>{
  if(method==='GET') {
    if(q.view==='capabilities') return {rpc:'lockd_messaging_capabilities'};
    if(q.view==='bookingContext' && validId(q.conversationId)) return {rpc:'lockd_conversation_booking_context',args:{p_conversation_id:q.conversationId}};
    if(q.view==='devices' && (!q.conversationId || validId(q.conversationId))) return {rpc:'lockd_conversation_devices',args:{p_conversation_id:q.conversationId||null}};
    if(q.view==='history' && validId(q.conversationId) && (!q.before || /^[1-9][0-9]{0,15}$/.test(q.before)) && (!q.after || /^[1-9][0-9]{0,15}$/.test(q.after))) return {rpc:'lockd_message_history',args:{p_conversation_id:q.conversationId,p_before:q.before||null,p_after:q.after||null}};
    if(q.view==='reports') return {rpc:'my_lockd_message_reports'};
    if(q.view==='reviewQueue') return {rpc:'lockd_message_report_queue'};
    if(q.view==='evidence' && validId(q.id)) return {rpc:'lockd_message_report_evidence',args:{p_report_id:q.id}};
    if(!q.view || q.view==='inbox') return {rpc:'my_lockd_conversations'};
    return null;
  }
  if(b.action==='registerDevice' && text(b.publicKey,20000,100) && /^[a-f0-9]{64}$/.test(b.fingerprint||'')) return {rpc:'register_lockd_message_device',args:{p_key:b.publicKey,p_fingerprint:b.fingerprint}};
  if(b.action==='revokeDevice' && validId(b.id)) return {rpc:'revoke_lockd_message_device',args:{p_id:b.id}};
  if(b.action==='open' && validId(b.listingId) && (!b.bookingId || validId(b.bookingId))) return {rpc:'open_lockd_conversation',args:{p_listing_id:b.listingId,p_booking_id:b.bookingId||null}};
  if(b.action==='reserveAttachment' && validId(b.conversationId) && validId(b.id) && Number.isInteger(b.bytes) && b.bytes>=100 && b.bytes<=2200000)return {rpc:'reserve_lockd_chat_attachment',args:{p_conversation_id:b.conversationId,p_id:b.id,p_bytes:b.bytes}};
  if(b.action==='send' && validId(b.conversationId) && validId(b.clientId) && validId(b.senderDevice) && validId(b.recipientDevice) && text(b.ciphertext,65536,100) && (!b.attachmentIds || (Array.isArray(b.attachmentIds)&&b.attachmentIds.length<=3&&b.attachmentIds.every(validId)))) return {rpc:'send_lockd_ciphertext',args:{p_conversation_id:b.conversationId,p_client_id:b.clientId,p_sender_device:b.senderDevice,p_recipient_device:b.recipientDevice,p_ciphertext:b.ciphertext,p_attachment_ids:b.attachmentIds||[]}};
  if(b.action==='acknowledge' && validId(b.id) && typeof b.read==='boolean') return {rpc:'acknowledge_lockd_message',args:{p_message_id:b.id,p_read:b.read}};
  if(b.action==='block' && validId(b.conversationId) && typeof b.block==='boolean') return {rpc:'block_lockd_participant',args:{p_conversation_id:b.conversationId,p_block:b.block}};
  if(b.action==='report' && validId(b.conversationId) && validId(b.clientId) && validId(b.deviceId) && ['fraud','off_platform_payment','harassment','threats','attachment','listing','unsafe','other'].includes(b.category) && Array.isArray(b.ids) && b.ids.length>=1 && b.ids.length<=30 && b.ids.every(validId) && text(b.evidence,262144,100) && /^[a-f0-9]{64}$/.test(b.fingerprint||'') && /^[a-f0-9]{64}$/.test(b.sha256||'')) return {rpc:'report_lockd_messages',args:{p_conversation_id:b.conversationId,p_client_id:b.clientId,p_category:b.category,p_ids:b.ids,p_evidence:b.evidence,p_fingerprint:b.fingerprint,p_sha256:b.sha256,p_device:b.deviceId}};
  if(b.action==='reportConcern' && validId(b.conversationId) && validId(b.clientId) && validId(b.deviceId) && ['fraud','off_platform_payment','harassment','threats','attachment','listing','unsafe','other'].includes(b.category) && Array.isArray(b.ids) && b.ids.length>=1 && b.ids.length<=30 && b.ids.every(validId)) return {rpc:'report_lockd_conversation',args:{p_conversation_id:b.conversationId,p_client_id:b.clientId,p_category:b.category,p_ids:b.ids,p_device:b.deviceId}};
  if(b.action==='reviewReport' && validId(b.id) && ['under_review','additional_information_required','escalated','resolved','dismissed'].includes(b.status) && text(b.reason,2000,10)) return {rpc:'review_lockd_message_report',args:{p_report_id:b.id,p_status:b.status,p_reason:b.reason}};
  return null;
},300000,async(result,{config,token,action})=>{
  if(action.rpc!=='my_lockd_conversations'||!Array.isArray(result))return result;
  const images=await signImages(config,result.map(item=>item.image),{token,limit:100}).catch(()=>[]);
  return result.map((item,index)=>({...item,image:images[index]||null}));
});
