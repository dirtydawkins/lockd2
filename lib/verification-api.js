// Shares the existing private-RPC transport and Supabase caller identity.
const {endpoint,uuid,text}=require('./private-rpc');
module.exports=endpoint((method,q,b)=>{
 if(method==='GET'){
  if(q.view==='capabilities')return {rpc:'lockd_verification_capabilities'};
  if(q.view==='requirements'&&(!q.bookingId||uuid.test(q.bookingId)))return {rpc:'lockd_verification_requirements',args:{p_booking_id:q.bookingId||null}};
  if(q.view==='reviews')return {rpc:'lockd_verification_review'};
  if(q.view==='review'&&uuid.test(q.id||''))return {rpc:'lockd_verification_review',args:{p_case_id:q.id}};
  if(!q.view||q.view==='mine')return {rpc:'my_lockd_verification_cases'};
  return null;
 }
 if(b.action==='create'&&(!b.bookingId||uuid.test(b.bookingId))&&(!b.method||['mpesa','bank'].includes(b.method))&&text(b.address||'',1000)&&text(b.consent,80,1)&&typeof b.creditConsent==='boolean'&&uuid.test(b.requestKey||''))
  return {rpc:'create_lockd_verification_case',args:{p_booking_id:b.bookingId||null,p_method:b.method||null,p_address:b.address||null,p_consent:b.consent,p_credit_consent:b.creditConsent,p_request_key:b.requestKey}};
 if(b.action==='reserve'&&uuid.test(b.caseId||'')&&['utility','tenancy','student','family','landlord','other','mpesa','bank'].includes(b.kind)&&['application/pdf','image/jpeg','image/png','image/webp'].includes(b.mime)&&Number.isInteger(b.bytes)&&b.bytes>=16&&b.bytes<=2097152)
  return {rpc:'reserve_lockd_verification_document',args:{p_case_id:b.caseId,p_kind:b.kind,p_mime:b.mime,p_bytes:b.bytes}};
 if(b.action==='queue'&&uuid.test(b.documentId||''))return {rpc:'queue_lockd_verification_document',args:{p_document_id:b.documentId}};
 if(b.action==='submit'&&uuid.test(b.caseId||'')&&Number.isInteger(b.version)&&b.version>0&&b.fields&&typeof b.fields==='object'&&!Array.isArray(b.fields))return {rpc:'submit_lockd_verification_case',args:{p_case_id:b.caseId,p_version:b.version,p_fields:b.fields}};
 if(b.action==='transition'&&uuid.test(b.caseId||'')&&Number.isInteger(b.version)&&b.version>0&&['withdraw','appeal','verified','unable_to_verify','rejected','additional_information','revoked'].includes(b.transition)&&text(b.reason||'',2000))return {rpc:'transition_lockd_verification_case',args:{p_case_id:b.caseId,p_version:b.version,p_action:b.transition,p_reason:b.reason||''}};
 return null;
});
