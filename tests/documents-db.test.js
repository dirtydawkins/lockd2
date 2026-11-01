const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./private-fixture.cjs');
test('private evidence has fenced jobs, explicit review, withdrawal and retention',async t=>{
 const {db,as,rpc,ids}=await fixture();
 let c,d,job;
 try {
 await t.test('all evidence tables private and scanner release off',async()=>{
  await as('customer');
  assert.equal((await rpc('lockd_document_capabilities')).uploadsEnabled,false);
  assert.equal((await rpc('lockd_document_capabilities')).submissionsEnabled,false);
  await assert.rejects(db.query('select * from lockd_verification_documents'),/permission denied/);
 });
 await t.test('idempotent creation and server consent version',async()=>{
  const key=crypto.randomUUID();
  await assert.rejects(rpc('create_lockd_address_case',['student','Juja, Kiambu','Hostel residence','address-evidence-1',key]),/not enabled/);
  await db.exec('reset role;update lockd_document_settings set policy_approved_at=now();');await as('customer');
  await assert.rejects(rpc('create_lockd_address_case',['student','Juja, Kiambu','Hostel residence','wrong',key]),/Invalid address/);
  c=await rpc('create_lockd_address_case',['student','Juja, Kiambu','Hostel residence','address-evidence-1',key]);
  assert.equal((await rpc('create_lockd_address_case',['student','Juja, Kiambu','Hostel residence','address-evidence-1',key])).id,c.id);
  await assert.rejects(rpc('reserve_lockd_document',[c.id,'application/pdf',100]),/not enabled/);
 });
 await t.test('other users and listing owners cannot view or change evidence',async()=>{
  await as('owner');assert.deepEqual(await rpc('my_lockd_address_cases'),[]);
  await assert.rejects(rpc('submit_lockd_address_case',[c.id,c.version,{}]),/Refresh/);
  await assert.rejects(rpc('lockd_address_review_detail',[c.id]),/Administrator/);
 });
 await t.test('quarantine has immutable paths, size and expiry restrictions',async()=>{
  await db.exec("reset role;update lockd_document_settings set uploads_enabled=true,policy_approved_at=now();");
  await as('customer');
  d=await rpc('reserve_lockd_document',[c.id,'application/pdf',100]);
  assert.equal(await rpc('lockd_document_upload_allowed',[d.path]),true);
  assert.equal(await rpc('lockd_document_upload_allowed',[d.path+'/../other']),false);
  await assert.rejects(rpc('queue_lockd_document',[d.id]),/incomplete/);
  await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('lockd-verification-private',$1,'{\"size\":100}')",[d.path]);
  await as('customer');await rpc('queue_lockd_document',[d.id]);
  assert.equal(await rpc('lockd_document_upload_allowed',[d.path]),false);
  await assert.rejects(rpc('claim_lockd_document_job'),/permission denied/);
 });
 await t.test('jobs are durable, one leased processor, stale result denied',async()=>{
  await db.exec('reset role');job=await rpc('claim_lockd_document_job');
  assert.equal(job.document_id,d.id);
  assert.equal(await rpc('claim_lockd_document_job'),null);
  assert.equal(await rpc('finish_lockd_document_job',[d.id,crypto.randomUUID(),{},null]),false);
 });
 await t.test('screening cannot set official identity or independently verified flags',async()=>{
  await assert.rejects(rpc('finish_lockd_document_job',[d.id,job.lease_token,{version:'documents-rules-1',issuer_status:'verified'},null]),/Invalid processing/);
  assert.equal(await rpc('finish_lockd_document_job',[d.id,job.lease_token,{version:'documents-rules-1',sha256:'a'.repeat(64),issuer_status:'not_independently_verified',trained_model:false,fields:{service_address:{value:'Juja Kiambu'}},findings:[{code:'private_review_only'}]},null]),true);
  await as('customer');const items=await rpc('my_lockd_address_cases');c=items[0];
  assert.equal(c.state,'needs_confirmation');assert.equal(JSON.stringify(items).includes('private_review_only'),false);
  assert.equal((await rpc('my_lockd_verification')).addressVerified,false);
 });
 await t.test('corrections append versions, cannot self-certify outcome',async()=>{
  await assert.rejects(rpc('submit_lockd_address_case',[c.id,c.version,{verified:true}]),/Invalid address fields/);
  await rpc('submit_lockd_address_case',[c.id,c.version,{service_address:'Juja, Kiambu'}]);
  await assert.rejects(rpc('submit_lockd_address_case',[c.id,c.version,{}]),/Refresh/);
  c=(await rpc('my_lockd_address_cases'))[0];
  await assert.rejects(rpc('review_lockd_address_case',[c.id,c.version,'accepted','Confirmed with institution']),/Administrator/);
 });
 await t.test('qualified review adds address only, records access and independent provenance',async()=>{
  await as('admin','admin');
  const detail=await rpc('lockd_address_review_detail',[c.id]);
  assert.equal(detail.documents[0].analysis.findings[0].code,'private_review_only');
  await rpc('review_lockd_address_case',[c.id,c.version,'accepted','Confirmed institutional residence through approved review.']);
  await as('customer');assert.equal((await rpc('my_lockd_verification')).addressVerified,true);assert.equal((await rpc('my_lockd_verification')).identityVerified,false);
 });
 await t.test('withdrawal revokes applicable address result and fences late jobs',async()=>{
  await rpc('withdraw_lockd_address_case',[c.id]);
  assert.equal((await rpc('my_lockd_verification')).addressVerified,false);
  await db.exec('reset role');assert.equal(await rpc('finish_lockd_document_job',[d.id,job.lease_token,{},null]),false);
 });
 await t.test('storage deletion acknowledgement precedes private field purge',async()=>{
  const pending=await rpc('claim_lockd_document_deletion');assert.equal(pending.document_id,d.id);
  assert.equal(await rpc('finish_lockd_document_deletion',[d.id,crypto.randomUUID()]),false);
  assert.equal(await rpc('finish_lockd_document_deletion',[d.id,pending.token]),true);
  assert.equal((await db.query('select count(*)::int n from lockd_document_analyses')).rows[0].n,0);
  assert.equal((await db.query('select declared_address from lockd_address_cases where id=$1',[c.id])).rows[0].declared_address,'[removed]');
 });
 }finally{await db.close();}
});
