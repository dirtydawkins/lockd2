const configuration=require('../api/supabase-config');
module.exports=async(req,res)=>{
 const send=(code,data)=>{res.setHeader('Cache-Control','no-store');return res.status(code).json(data);};
 if(req.method!=='GET')return send(405,{message:'Use search to find listers.'});
 const config=configuration();if(!config)return send(503,{message:'Lister search is unavailable right now.'});
 const q=req.query||{},page=Number(q.page||0);
 if(!Number.isInteger(page)||page<0||page>1000||typeof(q.q||'')!=='string'||(q.q||'').length>100)return send(400,{message:'Choose a shorter search.'});
 const profile=['host','lister'].includes(q.view);if(profile&&!/^[a-z0-9][a-z0-9-]{2,49}$/.test(q.lister||q.host||''))return send(400,{message:'Choose a valid lister profile.'});
 try{
  const response=await fetch(`${config.url}/rest/v1/rpc/${profile?'lockd_public_host_listings':'search_lockd_public_hosts'}`,{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify(profile?{p_slug:q.lister||q.host,p_page:page}:{p_q:q.q||'',p_page:page}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok){if(response.status===404&&result.code==='PGRST202')return send(200,{configured:false});throw Error('Lister search unavailable');}
  if(profile)return send(200,{configured:true,item:result});
  if(!Array.isArray(result))throw Error('Invalid host result');
  return send(200,{configured:true,items:result.slice(0,20),hasMore:result.length>20,page});
 }catch{return send(502,{message:'Listers could not be loaded. Please try again.'});}
};
