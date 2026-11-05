// Ephemeral password forwarding. Never persist, log or return the password.
const configuration = require('../api/supabase-config');
const {uuid} = require('./private-rpc');
module.exports = async (req,res) => {
 res.setHeader('Cache-Control','private, no-store');
 const fail=(code,message)=>res.status(code).json({message});
 if(req.method!=='POST'){res.setHeader('Allow','POST');return fail(405,'Method not allowed.');}
 const token=req.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{32,4096})$/i)?.[1];
 if(!token)return fail(401,'Sign in to continue.');
 let body;
 try{
  if(Number(req.headers?.['content-length'])>4096)return fail(413,'Request too large.');
  body=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!body||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>4096||!uuid.test(body.documentId||'')||typeof body.password!=='string'||!body.password||Buffer.byteLength(body.password)>1024||body.password.includes('\0'))return fail(400,'Enter the password for this statement.');
 }catch{return fail(400,'Enter the password for this statement.');}
 const config=configuration(),secret=process.env.LOCKD_INTELLIGENCE_SECRET;
 let base;
 try{base=new URL(process.env.LOCKD_INTELLIGENCE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.onrender.com')||base.username||base.password||base.search||base.hash)throw Error();}catch{return fail(503,'Statement processing is unavailable.');}
 if(!config||!secret||secret.length<32)return fail(503,'Statement processing is unavailable.');
 try{
  const headers={...config.headers,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const identity=await fetch(config.url+'/auth/v1/user',{headers,redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!identity.ok)return fail(401,'Your session has expired. Sign in again.');
  const claim=await fetch(config.url+'/rest/v1/rpc/claim_lockd_statement_unlock',{method:'POST',headers,body:JSON.stringify({p_document_id:body.documentId}),redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!claim.ok)return fail(409,'This statement cannot be unlocked right now. Refresh and try again shortly.');
  const lease=await claim.json();
  if(!uuid.test(lease?.lease||'')||lease.documentId!==body.documentId)return fail(502,'Statement processing is unavailable.');
  const result=await fetch(new URL('/v1/documents/unlock',base.origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(40000),headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({document_id:body.documentId,lease:lease.lease,password:body.password})});
  body.password='';
  const data=await result.json().catch(()=>null);
  if(!result.ok||!['screened','not_applied','password_required','review_or_retry'].includes(data?.state))return fail(503,'We couldn’t read the statement. Refresh and try again shortly.');
  return res.status(200).json({item:{state:data.state}});
 }catch{return fail(502,'Processing stopped. Refresh before trying again; your password has not been saved.');}
 finally{if(body)body.password='';}
};
