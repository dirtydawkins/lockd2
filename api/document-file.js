// Authenticated, audited file proxy. No public Storage access or shareable bearer URL.
const configuration=require('./supabase-config');
const {uuid}=require('../lib/private-rpc');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const fail=(code,message)=>res.status(code).json({message});
 if(req.method!=='GET'){res.setHeader('Allow','GET');return fail(405,'Method not allowed.');}
 const config=configuration(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!config||!secret||secret.length<32)return fail(503,'Private document access is not configured.');
 const token=req.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{32,4096})$/i)?.[1];
 if(!token)return fail(401,'Sign in to continue.');
 if(!uuid.test(req.query?.id||''))return fail(400,'Choose a valid document.');
 try{
  const headers={...config.headers,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const user=await fetch(config.url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(8000)});
  if(!user.ok)return fail(401,'Sign in again to view this file.');
  const allowed=await fetch(config.url+'/rest/v1/rpc/lockd_document_file_reference',{method:'POST',headers,body:JSON.stringify({p_document_id:req.query.id}),signal:AbortSignal.timeout(8000)});
  if(!allowed.ok)return fail(404,'Document is unavailable.');
  const reference=await allowed.json();
  if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(reference?.path||'')||!['application/pdf','image/jpeg','image/png','image/webp'].includes(reference.mime)||!Number.isInteger(reference.bytes)||reference.bytes>2097152)return fail(502,'Document is unavailable.');
  const source=await fetch(config.url+'/storage/v1/object/lockd-verification-private/'+reference.path,{headers:{apikey:secret,Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!source.ok)return fail(502,'Document is unavailable.');
  const chunks=[];let size=0;const reader=source.body.getReader();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152){await reader.cancel();return fail(502,'Document exceeds its limit.');}chunks.push(Buffer.from(value));}
  if(size!==reference.bytes)return fail(502,'Document is unavailable.');
  const extension={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[reference.mime];
  res.setHeader('Content-Type',reference.mime);res.setHeader('Content-Disposition',`attachment; filename="address-evidence.${extension}"`);
  res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  return res.status(200).send(Buffer.concat(chunks));
 }catch{return fail(502,'Private file access is temporarily unavailable.');}
};
