const {test}=require('node:test'),assert=require('node:assert/strict');
const documents=require('../api/documents'),messages=require('../api/messages'),file=require('../lib/document-file');
const id='11111111-1111-4111-8111-111111111111';
function setup(t){const env={...process.env},original=fetch;t.after(()=>{process.env=env;global.fetch=original;});process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';}
async function call(handler,{method='GET',body,query={},token=true,headers={}}={}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.data=value;return this;},send(value){this.binary=value;return this;}};
 await handler({method,body,query,headers:{...(token?{authorization:'Bearer '+'x'.repeat(40)}:{}),...headers}},res);return res;
}
test('documents and messaging require authentication, including read-only metadata',async t=>{setup(t);global.fetch=()=>{throw Error('Unexpected network');};for(const handler of [documents,messages])assert.equal((await call(handler,{token:false})).code,401);});
test('document API forwards only supported user fields, never verification claims',async t=>{
 setup(t);let forwarded;global.fetch=async(url,options)=>{if(url.endsWith('/user'))return {ok:true};forwarded={url,...options};return {ok:true,json:async()=>({id})};};
 const response=await call(documents,{method:'POST',body:{action:'create',method:'student',address:'Synthetic student residence',explanation:'',consent:'address-evidence-1',requestKey:id,userId:'forged',verified:true,role:'admin'}});
 assert.equal(response.code,200);assert.equal(response.headers['Cache-Control'],'private, no-store');
 assert.deepEqual(JSON.parse(forwarded.body),{p_method:'student',p_address:'Synthetic student residence',p_explanation:'',p_consent:'address-evidence-1',p_request_key:id});
 assert.equal(forwarded.headers.Authorization,'Bearer '+'x'.repeat(40));
});
test('message API binds ciphertext operations and ignores sender/receipt claims',async t=>{
 setup(t);let args;global.fetch=async(url,options)=>{if(url.endsWith('/user'))return {ok:true};args=JSON.parse(options.body);return {ok:true,json:async()=>({id})};};
 const response=await call(messages,{method:'POST',body:{action:'send',conversationId:id,clientId:id,senderDevice:id,recipientDevice:id,ciphertext:'-----BEGIN PGP MESSAGE-----'+'x'.repeat(120),senderId:'forged',read:true,delivered:true}});
 assert.equal(response.code,200);assert.deepEqual(Object.keys(args).sort(),['p_attachment_ids','p_ciphertext','p_client_id','p_conversation_id','p_recipient_device','p_sender_device']);
});
test('invalid cursors, opaque IDs and oversized private bodies fail before database calls',async t=>{
 setup(t);global.fetch=()=>{throw Error('Unexpected network');};
 assert.equal((await call(messages,{query:{view:'history',conversationId:id,before:'1;drop'}})).code,400);
 assert.equal((await call(documents,{method:'POST',body:'bad json'})).code,400);
 assert.equal((await call(documents,{method:'POST',headers:{'content-length':'9000'}})).code,413);
 assert.equal((await call(messages,{method:'POST',body:{action:'acknowledge',id,read:'true'}})).code,400);
});
test('private provider/database failures are safe errors, never false empty results',async t=>{
 setup(t);global.fetch=async url=>url.endsWith('/user')?{ok:true}:{ok:false,status:403,json:async()=>({message:'secret address / token / internal SQL'})};
 const result=await call(documents);assert.equal(result.code,400);assert.equal(JSON.stringify(result.data).includes('secret address'),false);
 global.fetch=async()=>({ok:false,status:401});assert.equal((await call(messages)).code,401);
});
test('private original downloads require configuration and audited server authorization',async t=>{
 setup(t);delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert.equal((await call(file,{query:{id}})).code,503);
 assert.equal((await call(documents,{query:{view:'file',id}})).code,503,'the shared document function dispatches private downloads');
 process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-server-key-'+'x'.repeat(40);let accessed=false;
 global.fetch=async url=>{if(url.endsWith('/user'))return {ok:true};if(url.includes('/rpc/'))return {ok:false,status:403};accessed=true;throw Error('No storage access allowed');};
 assert.equal((await call(file,{query:{id}})).code,404);assert.equal(accessed,false);
});
test('file proxy rejects unsafe storage paths and bounds streamed bytes',async t=>{
 setup(t);process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-server-key-'+'x'.repeat(40);let unsafe=true;
 global.fetch=async url=>{if(url.endsWith('/user'))return {ok:true};if(url.includes('/rpc/'))return {ok:true,json:async()=>({path:unsafe?'../../other':`${id}/${id}/${id}`,mime:'image/png',bytes:100})};return new Response(new Uint8Array(2097153));};
 assert.equal((await call(file,{query:{id}})).code,502);unsafe=false;assert.equal((await call(file,{query:{id}})).code,502);
});
