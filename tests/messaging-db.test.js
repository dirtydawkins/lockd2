const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./private-fixture.cjs');
test('ciphertext transport isolates participants, receipts and voluntarily disclosed reports',async t=>{
 const {db,as,rpc,ids}=await fixture();let own,other,conversation,message;
 const cipher='-----BEGIN PGP MESSAGE-----\n'+'x'.repeat(120)+'\n-----END PGP MESSAGE-----';
 try{
 await t.test('disabled until explicit reviewed release',async()=>{
  await as('customer');assert.equal((await rpc('lockd_messaging_capabilities')).enabled,false);
  await assert.rejects(rpc('open_lockd_conversation',[ids.listing,null]),/not enabled/);
  await db.exec("reset role;update lockd_messaging_settings set enabled=true,security_reviewed_at=now(),retention_policy_version='synthetic-fixture';");
 });
 await t.test('one active device per identity, never a private key column',async()=>{
  await as('customer');own=await rpc('register_lockd_message_device',['-----BEGIN PGP PUBLIC KEY BLOCK-----\n'+'a'.repeat(100),'a'.repeat(64)]);
  await assert.rejects(rpc('register_lockd_message_device',['-----BEGIN PGP PUBLIC KEY BLOCK-----\n'+'b'.repeat(100),'b'.repeat(64)]),/active messaging device/);
  await as('owner');other=await rpc('register_lockd_message_device',['-----BEGIN PGP PUBLIC KEY BLOCK-----\n'+'c'.repeat(100),'c'.repeat(64)]);
 });
 await t.test('listing-derived parties, idempotent threads and no self-thread',async()=>{
  await assert.rejects(rpc('open_lockd_conversation',[ids.listing,null]),/unavailable/);
  await as('customer');conversation=await rpc('open_lockd_conversation',[ids.listing,null]);assert.equal(await rpc('open_lockd_conversation',[ids.listing,null]),conversation);
  assert.equal((await rpc('lockd_conversation_devices',[conversation])).length,2);
 });
 await t.test('outsiders cannot discover keys, inbox, history or ciphertext',async()=>{
  await as('stranger');assert.deepEqual(await rpc('my_lockd_conversations'),[]);
  await assert.rejects(rpc('lockd_conversation_devices',[conversation]),/unavailable/);
  await assert.rejects(rpc('lockd_message_history',[conversation,null]),/unavailable/);
 });
 await t.test('server binds authenticated sender, device, context and duplicate key',async()=>{
  await as('customer');const client=crypto.randomUUID();
  await assert.rejects(rpc('send_lockd_ciphertext',[conversation,client,other.id,own.id,cipher]),/Verify/);
  message=await rpc('send_lockd_ciphertext',[conversation,client,own.id,other.id,cipher]);
  assert.equal((await rpc('send_lockd_ciphertext',[conversation,client,own.id,other.id,cipher])).id,message.id);
  await assert.rejects(rpc('send_lockd_ciphertext',[conversation,client,own.id,other.id,cipher+'a']),/differs/);
  const history=await rpc('lockd_message_history',[conversation,null]);assert.equal(history[0].delivered_at,null);assert.equal(history[0].read_at,null);
 });
 await t.test('sender cannot acknowledge delivery; only recipient does',async()=>{
  await assert.rejects(rpc('acknowledge_lockd_message',[message.id,true]),/unavailable/);
  await as('owner');await rpc('acknowledge_lockd_message',[message.id,false]);
  let h=await rpc('lockd_message_history',[conversation,null]);assert.ok(h[0].delivered_at);assert.equal(h[0].read_at,null);
  await rpc('acknowledge_lockd_message',[message.id,true]);h=await rpc('lockd_message_history',[conversation,null]);assert.ok(h[0].read_at);
 });
 await t.test('administration does not grant access to ordinary messages',async()=>{
  await as('admin','admin');assert.equal((await db.query('select * from lockd_encrypted_messages')).rows.length,0);
  await assert.rejects(rpc('lockd_message_history',[conversation,null]),/unavailable/);
 });
 await t.test('blocking prevents future writes without erasing existing history',async()=>{
  await as('owner');await rpc('block_lockd_participant',[conversation,true]);
  await as('customer');await assert.rejects(rpc('send_lockd_ciphertext',[conversation,crypto.randomUUID(),own.id,other.id,cipher]),/unavailable/);
  assert.equal((await rpc('lockd_message_history',[conversation,null])).length,1);
  await as('owner');await rpc('block_lockd_participant',[conversation,false]);
 });
 await t.test('encrypted attachments are private until an authorized send commits them',async()=>{
  await as('customer');const id=crypto.randomUUID();const file=await rpc('reserve_lockd_chat_attachment',[conversation,id,500]);
  assert.equal(await rpc('lockd_chat_file_access',[file.path,true]),true);
  assert.equal(await rpc('lockd_chat_file_access',[file.path,false]),false);
  await assert.rejects(rpc('send_lockd_ciphertext',[conversation,crypto.randomUUID(),own.id,other.id,cipher,[id]]),/incomplete/);
  await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('lockd-chat-private',$1,'{\"size\":500}')",[file.path]);
  await as('customer');await rpc('send_lockd_ciphertext',[conversation,crypto.randomUUID(),own.id,other.id,cipher,[id]]);
  assert.equal(await rpc('lockd_chat_file_access',[file.path,true]),false);
  await as('owner');assert.equal(await rpc('lockd_chat_file_access',[file.path,false]),true);
  await as('admin','admin');assert.equal(await rpc('lockd_chat_file_access',[file.path,false]),false);
 });
 await t.test('reporting refuses unconfigured investigator and unrelated message IDs',async()=>{
  await as('customer');const args=[conversation,crypto.randomUUID(),'fraud',[message.id],cipher,'d'.repeat(64),require('node:crypto').createHash('sha256').update(cipher).digest('hex'),own.id];
  await assert.rejects(rpc('report_lockd_messages',args),/not configured/);
  await db.exec("reset role;update lockd_messaging_settings set investigator_key='synthetic public fixture',investigator_fingerprint='"+'d'.repeat(64)+"';");
  await as('customer');await assert.rejects(rpc('report_lockd_messages',[...args.slice(0,3),[crypto.randomUUID()],...args.slice(4)]),/Choose messages/);
  const report=await rpc('report_lockd_messages',args);assert.equal(await rpc('report_lockd_messages',args),report);
  await assert.rejects(rpc('lockd_message_report_evidence',[report]),/Administrator/);
  await as('admin','admin');const evidence=await rpc('lockd_message_report_evidence',[report]);assert.equal(evidence.report.encrypted_evidence,cipher);
  await rpc('review_lockd_message_report',[report,'dismissed','Insufficient independent evidence for an enforcement decision.']);
  assert.equal((await db.query('select * from lockd_encrypted_messages')).rows.length,0);
 });
 await t.test('revoked devices cannot send new messages',async()=>{
  await as('customer');await rpc('revoke_lockd_message_device',[own.id]);
  await assert.rejects(rpc('send_lockd_ciphertext',[conversation,crypto.randomUUID(),own.id,other.id,cipher]),/Verify/);
 });
 }finally{await db.close();}
});
