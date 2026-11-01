// Isolated local integration fixture. Never shipped to Vercel; no production data or credentials.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,ids}=require('./private-fixture.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {db,as,rpc}=await fixture();const cryptoLayer=await import('../messaging-crypto.mjs');
 const peerIdentity=await cryptoLayer.newIdentity(ids.owner,'synthetic-owner-phrase-ONLY'),peerPrivate=await cryptoLayer.unlock(peerIdentity,'synthetic-owner-phrase-ONLY');
 await db.exec("update lockd_messaging_settings set enabled=true,security_reviewed_at=now(),retention_policy_version='local-synthetic-test';");
 await as('owner');const peer=await rpc('register_lockd_message_device',[peerIdentity.publicKey,peerIdentity.fingerprint]);
 await as('customer');const conversation=await rpc('open_lockd_conversation',[ids.listing,null]);
 console.log('Local synthetic conversation:',conversation);console.log('Synthetic peer fingerprint:',peerIdentity.fingerprint);
 let queue=Promise.resolve();
 process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';
 global.fetch=async(url,options)=>{
  if(!url.startsWith('https://fixture.supabase.co/'))throw Error('External network disabled');
  const who=Object.keys(ids).find(k=>options.headers.Authorization==='Bearer fixture_'+k+'_'+'x'.repeat(40));
  if(!who)return {ok:false,status:401,json:async()=>({})};
  if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:ids[who],app_metadata:{role:who==='admin'?'admin':'customer'}})};
  const name=url.split('/rpc/')[1];if(!/^[a-z_]+$/.test(name||''))throw Error('Invalid fixture request');
  const body=JSON.parse(options.body||'{}'),entries=Object.entries(body);
  const operation=queue.catch(()=>{}).then(async()=>{
   await as(who,who==='admin'?'admin':'customer');
   try {const result=await db.query(`select ${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) item`,entries.map(([,value])=>value));return {ok:true,json:async()=>result.rows[0].item};}
   catch(error){return {ok:false,status:400,json:async()=>({message:error.message})};}
  });queue=operation;return operation;
 };
 const handlers={messages:require('../api/messages'),documents:require('../api/documents')};
 http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:8775');
  if(url.pathname==='/account-service.js'){
   res.setHeader('Content-Type','text/javascript');res.end(`(()=>{const role=new URL(location.href).searchParams.get('fixtureRole')||'customer';const ids=${JSON.stringify(ids)};window.LockdAccount={getSession:async()=>({access_token:'fixture_'+role+'_'+'x'.repeat(40),user:{id:ids[role],app_metadata:{role:role==='admin'?'admin':'customer'}}}),getConfig:async()=>({supabase:{url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'},messagingRealtimeEnabled:false}),authLink:()=>'/account.html'};})();`);return;
  }
  if(url.pathname==='/__reply'){
   const operation=queue.catch(()=>{}).then(async()=>{
    await as('owner');const devices=await rpc('lockd_conversation_devices',[conversation]),customer=devices.find(d=>d.user_id===ids.customer&&!d.revoked_at);
    if(!customer)throw Error('Set up the synthetic customer device first.');
    const clientId=crypto.randomUUID(),payload={protocol:cryptoLayer.PROTOCOL,conversationId:conversation,clientId,senderDevice:peer.id,recipientDevice:customer.id,text:'Pickup details received. We can coordinate here once the reservation is approved.'};
    const ciphertext=await cryptoLayer.encryptMessage(payload,peerPrivate,[await cryptoLayer.readPublic(customer.public_key,customer.fingerprint),await cryptoLayer.readPublic(peer.public_key,peer.fingerprint)]);
    return await rpc('send_lockd_ciphertext',[conversation,clientId,peer.id,customer.id,ciphertext]);
   });queue=operation;
   try{await operation;res.end('Synthetic encrypted reply persisted.');}catch(error){res.statusCode=400;res.end(error.message);}return;
  }
  if(url.pathname==='/__ciphertext-check'){
   const operation=queue.catch(()=>{}).then(async()=>{await db.exec('reset role');return (await db.query('select ciphertext from lockd_encrypted_messages')).rows.every(row=>!row.ciphertext.includes('Pickup')&&!row.ciphertext.includes('Hello'));});queue=operation;
   res.end(JSON.stringify({ciphertextOnly:await operation}));return;
  }
  if(url.pathname.startsWith('/api/')){
   const handler=handlers[url.pathname.slice(5)];if(!handler){res.statusCode=404;res.end();return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>310000){res.statusCode=413;res.end();return;}}
   const shim={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return this;}};
   await handler({method:req.method,headers:req.headers,query:Object.fromEntries(url.searchParams),body},shim);return;
  }
  try{
   const target=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/messages.html':url.pathname));
   if(!target.startsWith(root+path.sep)||target.includes(path.sep+'.'))throw Error('Invalid path');
   const data=await fs.readFile(target),mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.jpeg':'image/jpeg','.jpg':'image/jpeg'}[path.extname(target)]||'application/octet-stream';
   res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');res.end(data);
  }catch{res.statusCode=404;res.end('Not found');}
 }).listen(8775,'127.0.0.1',()=>console.log('Private local fixture http://127.0.0.1:8775/messages.html'));
})().catch(error=>{console.error(error);process.exitCode=1;});
