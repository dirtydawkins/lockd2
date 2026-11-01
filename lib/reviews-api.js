const configuration=require('../api/supabase-config');
const {endpoint,uuid,text}=require('./private-rpc');
const privateOperations=endpoint((method,q,b)=>{
 if(method==='GET'){if(q.view==='opportunities')return {rpc:'my_lockd_review_opportunities'};if(q.view==='mine')return {rpc:'my_lockd_reviews'};if(q.view==='queue')return {rpc:'lockd_review_queue'};return null;}
 if(b.action==='submit'&&uuid.test(b.bookingId||'')&&Number.isInteger(b.rating)&&b.rating>=1&&b.rating<=5&&text(b.body,3000,10)&&b.dimensions&&typeof b.dimensions==='object'&&!Array.isArray(b.dimensions))return {rpc:'submit_lockd_review',args:{p_booking:b.bookingId,p_rating:b.rating,p_body:b.body,p_dimensions:b.dimensions}};
 if(['respond','report','appeal'].includes(b.action)&&uuid.test(b.reviewId||'')&&text(b.body,b.action==='respond'?2000:1000,b.action==='respond'?5:10))return {rpc:{respond:'respond_lockd_review',report:'report_lockd_review',appeal:'appeal_lockd_review'}[b.action],args:{p_review:b.reviewId,[b.action==='respond'?'p_body':'p_reason']:b.body}};
 if(b.action==='moderate'&&uuid.test(b.reviewId||'')&&['review','response'].includes(b.target)&&['published','hidden'].includes(b.status)&&text(b.reason,2000,10))return {rpc:'moderate_lockd_review',args:{p_review:b.reviewId,p_target:b.target,p_status:b.status,p_reason:b.reason}};
 return null;
});
module.exports=async(req,res)=>{
 if(req.method!=='GET'||!['public','capabilities'].includes(req.query?.view))return privateOperations(req,res);
 const send=(code,value)=>{res.setHeader('Cache-Control','no-store');return res.status(code).json(value);};
 const config=configuration();if(!config)return send(503,{message:'Reviews are unavailable right now.'});
 const q=req.query,page=Number(q.page||0),capability=q.view==='capabilities';
 if(!capability&&(!uuid.test(q.listingId||'')||!Number.isInteger(page)||page<0||page>1000))return send(400,{message:'Choose a rental to see its reviews.'});
 try{const response=await fetch(config.url+'/rest/v1/rpc/'+(capability?'lockd_reviews_capabilities':'lockd_public_listing_reviews'),{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify(capability?{}:{p_listing:q.listingId,p_page:page}),signal:AbortSignal.timeout(10000)}),result=await response.json();
  if(!response.ok){if(capability&&response.status===404&&result.code==='PGRST202')return send(200,{item:{enabled:false,configured:false}});return send(503,{message:'Reviews are unavailable right now.'});}
  return send(200,{item:result});
 }catch{return send(502,{message:'Reviews could not be loaded. Please try again.'});}
};
