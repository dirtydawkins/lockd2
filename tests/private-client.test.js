const {test}=require('node:test'),assert=require('node:assert/strict');

test('private requests reject account changes before dispatch and after an in-flight response',async t=>{
 const originalWindow=global.window,originalFetch=global.fetch;
 t.after(()=>{global.window=originalWindow;global.fetch=originalFetch;});
 let user='customer-a',calls=0;
 global.window={LockdAccount:{getSession:async()=>user?{user:{id:user},access_token:'controlled-test-token'}:null}};
 const {privateRequest}=await import('../private-client.mjs');
 global.fetch=async()=>{calls++;return Response.json({item:{enabled:true}});};
 await assert.rejects(privateRequest('messages',{},undefined,'customer-b'),/account changed/);assert.equal(calls,0);
 assert.deepEqual(await privateRequest('messages',{},undefined,'customer-a'),{enabled:true});
 let release;global.fetch=async()=>new Promise(resolve=>{release=()=>resolve(Response.json({item:{private:'customer-a'}}));});
 const pending=privateRequest('messages',{},undefined,'customer-a');
 await new Promise(resolve=>setImmediate(resolve));user='customer-b';release();
 await assert.rejects(pending,/account changed/);
 user=null;await assert.rejects(privateRequest('messages'),/Sign in/);
});
