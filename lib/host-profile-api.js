const {endpoint,text}=require('./private-rpc');
module.exports=endpoint((method,q,b)=>{
 if(method==='GET')return {rpc:'my_lockd_host_profile'};
 if(b.action==='save'&&/^[a-z0-9][a-z0-9-]{2,49}$/.test(b.slug||'')&&text(b.name,80,2)&&text(b.bio,600)&&typeof b.public==='boolean')return {rpc:'save_lockd_host_profile',args:{p_slug:b.slug,p_name:b.name,p_bio:b.bio,p_public:b.public}};
 return null;
});
