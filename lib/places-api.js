const configuration=require('../api/supabase-config');
module.exports=async function places(req,res){
 const send=(code,data)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(code).json(data);};
 const config=configuration();if(!config)return send(503,{message:'Places could not be loaded. Please try again shortly.'});
 if(req.method==='GET'){
  const id=req.query?.id;if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return send(400,{message:'Choose a place again.'});
  try{const response=await fetch(config.url+'/rest/v1/rpc/get_lockd_place',{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({p_place_id:id}),signal:AbortSignal.timeout(8000)});const item=await response.json();if(!response.ok)throw Error();return send(item?200:404,{item});}catch{return send(503,{message:'Choose a place again.'});}
 }
 if(req.method!=='POST')return send(405,{message:'Search for a town or neighbourhood.'});
 if(Number(req.headers?.['content-length']||0)>1024)return send(413,{message:'Search for a shorter place name.'});
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return send(400,{message:'Enter a town or neighbourhood.'});}
 const query=typeof body?.query==='string'?body.query.trim().replace(/\s+/g,' '):'';
 if(query.length<2||query.length>80||!/[\p{L}]/u.test(query)||!/^[\p{L} .,'’()&-]+$/u.test(query))return send(400,{message:'Enter a town or neighbourhood, without a street address.'});
 try{
  const response=await fetch(config.url+'/functions/v1/lockd-places',{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)return send(response.status===429?429:503,{message:response.status===429?'Please wait a moment before searching again.':'Places could not be loaded. Please try again shortly.'});
  if(!Array.isArray(data.items))throw Error();
  return send(200,{items:data.items});
 }catch{return send(503,{message:'Places could not be loaded. Please try again shortly.'});}
};
