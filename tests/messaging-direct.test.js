const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-fixture.cjs');

test('a renter can message a published listing and receive an encrypted lister reply',async t=>{
  const {db,as,rpc,ids}=await fixture();
  t.after(()=>db.close());
  const crypto=await import('../messaging-crypto.mjs');
  await db.exec("reset role;update lockd_messaging_settings set enabled=true,security_reviewed_at=now(),retention_policy_version='test'");
  async function device(account){
    await as(account);
    const secret=globalThis.crypto.randomUUID();
    const identity=await crypto.newIdentity(account,secret);
    const registered=await rpc('register_lockd_message_device',[identity.publicKey,identity.fingerprint]);
    return {account,id:registered.id,key:await crypto.unlock(identity,secret),publicKey:await crypto.readPublic(identity.publicKey,identity.fingerprint)};
  }
  const renter=await device('customer');
  const thread=await rpc('open_lockd_conversation',[ids.listing,null]);
  const lister=await device('owner');
  async function exchange(from,to,text){
    await as(from.account);
    const clientId=globalThis.crypto.randomUUID();
    const payload={protocol:crypto.PROTOCOL,conversationId:thread,clientId,senderDevice:from.id,recipientDevice:to.id,text};
    const ciphertext=await crypto.encryptMessage(payload,from.key,[from.publicKey,to.publicKey]);
    const sent=await rpc('send_lockd_ciphertext',[thread,clientId,from.id,to.id,ciphertext]);
    await as(to.account);
    assert.ok((await rpc('my_lockd_conversations')).some(row=>row.id===thread));
    const received=(await rpc('lockd_message_history',[thread,null])).find(row=>row.id===sent.id);
    assert.equal((await crypto.decryptMessage(received,to.key,from.publicKey)).text,text);
    await rpc('acknowledge_lockd_message',[sent.id,true]);
  }
  await exchange(renter,lister,'Is pickup available?');
  await exchange(lister,renter,'Yes, we can arrange pickup.');
  await as('stranger');
  await assert.rejects(rpc('lockd_message_history',[thread,null]),/unavailable/);
});
