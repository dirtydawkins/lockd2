const configuration = require('../api/supabase-config');
const {uuid} = require('./private-rpc');
module.exports = async function checkout(req,res) {
 const send=(code,data)=>{res.setHeader('Cache-Control','private, no-store');return res.status(code).json(data);};
 if(!['GET','POST'].includes(req.method))return send(405,{message:'Method not allowed.'});
 const config=configuration(), token=req.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{32,4096})$/i)?.[1];
 if(!token)return send(401,{message:'Sign in to view your reservation.'});
 if(!config)return send(503,{message:'Your reservation could not be loaded right now.'});
 let body=req.body||{};
 try{if(typeof body==='string'){if(Buffer.byteLength(body)>2048)throw Error();body=JSON.parse(body);}if(!body||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>2048)throw Error();}catch{return send(400,{message:'Check your reservation details.'});}
 const id=req.method==='GET'?req.query.booking:body.bookingId;
 if(!uuid.test(id||''))return send(400,{message:'Choose a reservation from your account.'});
 if(req.method==='POST'&&(!['start','verify'].includes(body.action)||body.action==='start'&&!uuid.test(body.requestKey||'')))return send(400,{message:'Check your reservation details.'});
 const headers={...config.headers,'Content-Type':'application/json',Authorization:'Bearer '+token};
 try{
  const identity=await fetch(config.url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(8000)});
  if(!identity.ok)return identity.status===401||identity.status===403
   ?send(401,{message:'Your session has expired. Sign in again.'})
   :send(503,{message:'Your account could not be checked right now. Please try again.'});
  const user=await identity.json();
  const response=await fetch(config.url+'/rest/v1/rpc/my_lockd_checkout',{method:'POST',headers,body:JSON.stringify({p_booking_id:id}),signal:AbortSignal.timeout(8000)});
  const item=await response.json();
  if(!response.ok||item?.booking?.id!==id)return send(404,{message:'This reservation could not be found in your account.'});
  if(req.method==='GET')return send(200,{item});
  if(!user.email_confirmed_at||!user.email)return send(403,{message:'Verify your email before continuing.'});
  if(body.action==='start'&&!item.canPay)return send(409,{message:'This reservation is not ready for payment. Check its latest status.'});
  if(body.action==='verify'&&!/^lockd_pay_(test|live)_[a-f0-9]{32}$/.test(item.attempt?.reference||''))return send(200,{item:{state:'unchanged'}});
  const secret=process.env.LOCKD_INTELLIGENCE_SECRET;let base;
  try{base=new URL(process.env.LOCKD_INTELLIGENCE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.onrender.com')||base.username||base.password||base.search||base.hash)throw Error();}catch{return send(503,{message:'Payments are unavailable right now. Your reservation is still in your account.'});}
  if(!secret||secret.length<32)return send(503,{message:'Payments are unavailable right now.'});
  const result=await fetch(new URL('/v1/checkout/'+body.action,base.origin),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
   body:JSON.stringify({booking_id:id,customer_id:user.id,...(body.action==='start'?{email:user.email,request_key:body.requestKey}:{reference:item.attempt.reference})}),signal:AbortSignal.timeout(12000)});
  const data=await result.json();
  if(!result.ok)return send(503,{message:'Payment could not be checked right now. Return to this reservation before trying again.'});
  if(data.url&&!/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9_-]+$/.test(data.url))throw Error();
  return send(200,{item:{state:data.state,url:data.url||null}});
 }catch{return send(502,{message:'This is taking longer than usual. Check this reservation again before starting another payment.'});}
};
