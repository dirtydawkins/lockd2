const {endpoint,uuid,text}=require('../lib/private-rpc');
const documentFile=require('../lib/document-file');
const operations=endpoint((method,q,b)=>{
  if(method==='GET') {
    if(q.view==='capabilities') return {rpc:'lockd_document_capabilities'};
    if(q.view==='reviews') return {rpc:'lockd_address_review_queue'};
    if(q.view==='review' && uuid.test(q.id||'')) return {rpc:'lockd_address_review_detail',args:{p_case_id:q.id}};
    if(!q.view || q.view==='mine') return {rpc:'my_lockd_address_cases'};
    return null;
  }
  if(b.action==='create' && ['utility','tenancy','student','landlord','family','other'].includes(b.method) && text(b.address,1000,5) && text(b.explanation,2000) && text(b.consent,80,1) && uuid.test(b.requestKey||''))
    return {rpc:'create_lockd_address_case',args:{p_method:b.method,p_address:b.address,p_explanation:b.explanation,p_consent:b.consent,p_request_key:b.requestKey}};
  if(b.action==='reserve' && uuid.test(b.caseId||'') && ['application/pdf','image/jpeg','image/png','image/webp'].includes(b.mime) && Number.isInteger(b.bytes) && b.bytes>=16 && b.bytes<=2097152)
    return {rpc:'reserve_lockd_document',args:{p_case_id:b.caseId,p_mime:b.mime,p_bytes:b.bytes}};
  if(b.action==='queue' && uuid.test(b.documentId||'')) return {rpc:'queue_lockd_document',args:{p_document_id:b.documentId}};
  if(b.action==='withdraw' && uuid.test(b.caseId||'')) return {rpc:'withdraw_lockd_address_case',args:{p_case_id:b.caseId}};
  if(b.action==='appeal' && uuid.test(b.caseId||'') && text(b.reason,2000,10)) return {rpc:'appeal_lockd_address_case',args:{p_case_id:b.caseId,p_reason:b.reason}};
  if(b.action==='submit' && uuid.test(b.caseId||'') && Number.isInteger(b.version) && b.version>0 && b.fields && typeof b.fields==='object' && !Array.isArray(b.fields))
    return {rpc:'submit_lockd_address_case',args:{p_case_id:b.caseId,p_version:b.version,p_fields:b.fields}};
  if(b.action==='review' && uuid.test(b.caseId||'') && Number.isInteger(b.version) && b.version>0 && ['accepted','more_evidence','declined'].includes(b.decision) && text(b.reason,2000,10))
    return {rpc:'review_lockd_address_case',args:{p_case_id:b.caseId,p_version:b.version,p_decision:b.decision,p_reason:b.reason}};
  return null;
});
module.exports=(req,res)=>req.query?.module==='verification'?(req.query?.view==='unlock'?require('../lib/statement-unlock')(req,res):require('../lib/verification-api')(req,res)):req.method==='GET'&&req.query?.view==='file'?documentFile(req,res):operations(req,res);
