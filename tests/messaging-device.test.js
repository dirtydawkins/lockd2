const {test}=require('node:test'),assert=require('node:assert/strict');
require('fake-indexeddb/auto');
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('automatic account-bound device keys stay local and need no separate sign-in',async t=>{
 const oldFetch=global.fetch,oldWindow=global.window,oldLocation=global.location;
 t.after(()=>{global.fetch=oldFetch;global.window=oldWindow;global.location=oldLocation;});
 let signedIn=user,enabled=true,devices=[],posted=[];
 global.window={crypto:global.crypto,LockdAccount:{getSession:async()=>signedIn?{user:{id:signedIn},access_token:'fixture_'+signedIn}:null}};
 global.location={origin:'https://lockd2.vercel.app'};
 global.fetch=async(url,options)=>{
  const parsed=new URL(url,'https://lockd2.vercel.app'),view=parsed.searchParams.get('view');
  if(view==='capabilities')return Response.json({item:{enabled}});
  if(view==='devices')return Response.json({item:devices.filter(d=>d.user_id===signedIn)});
  const body=JSON.parse(options.body);posted.push(body);
  if(body.action==='registerDevice'){
   let device=devices.find(d=>d.user_id===signedIn&&!d.revoked_at);
   if(!device){device={id:crypto.randomUUID(),user_id:signedIn,public_key:body.publicKey,fingerprint:body.fingerprint,revoked_at:null};devices.push(device);}
   assert.equal(device.fingerprint,body.fingerprint);return Response.json({item:device});
  }
  if(body.action==='revokeDevice'){devices.find(d=>d.id===body.id).revoked_at=new Date().toISOString();return Response.json({item:null});}
  throw Error('Unexpected fixture request');
 };
 const store=await import('../messaging-store.mjs'),device=await import('../messaging-device.mjs'),cryptoLayer=await import('../messaging-crypto.mjs');
 let first;
 await t.test('unconfigured foundations create no local or server identity',async()=>{
  enabled=false;assert.equal((await device.ensureMessageDevice()).state,'disabled');assert.equal(posted.length,0);assert.equal(await store.openDevice(user),null);enabled=true;
 });
 await t.test('existing LOCKD session automatically prepares elliptic-curve identity',async()=>{
  first=await device.ensureMessageDevice();assert.equal(first.state,'ready');assert.equal(first.userId,user);assert.equal(first.identity.fingerprint.length,64);
  assert.equal(posted.length,1);assert.equal(posted[0].action,'registerDevice');
  assert.deepEqual(Object.keys(posted[0]).sort(),['action','fingerprint','publicKey']);
  assert.equal(JSON.stringify(posted).includes('PRIVATE KEY'),false);
 });
 await t.test('at-rest wrapping key is non-extractable and stored bytes hide private material',async()=>{
  const record=await store.stored(user,'device:v2'),local=await store.openDevice(user);
  assert.equal(record.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',record.key));
  assert.equal(Buffer.from(record.ciphertext).includes(Buffer.from(local.secret)),false);
  assert.equal(Buffer.from(record.ciphertext).includes(Buffer.from('PRIVATE KEY')),false);
 });
 await t.test('fresh opening restores the same identity without creating another account or key',async()=>{
  const registrations=posted.length;
  const restored=await device.ensureMessageDevice();assert.equal(posted.length,registrations);assert.equal(restored.identity.fingerprint,first.identity.fingerprint);assert.equal(devices.length,1);
 });
 await t.test('wrapping is bound to the authenticated account, not a public account identifier',async()=>{
  const record=await store.stored(user,'device:v2');await store.stored(other,'device:v2',record);
  await assert.rejects(store.openDevice(other));await store.stored(other,'device:v2',null);
 });
 await t.test('concurrent device persistence selects one identity without overwriting its private key',async()=>{
  const candidate={identity:first.identity,secret:'a'.repeat(64)},alternate={identity:first.identity,secret:'b'.repeat(64)};
  const [a,b]=await Promise.all([store.sealDevice(other,candidate),store.sealDevice(other,alternate)]);assert.equal(a.secret,b.secret);
  await store.stored(other,'device:v2',null);
 });
 await t.test('encrypted device transfer is signed, recipient-bound, expiring and one-use',async()=>{
  const link=await device.createConnectionRequest(user),encrypted=await device.connectAnotherDevice(user,link);
  assert.equal(encrypted.includes('PRIVATE KEY'),false);
  const connected=await device.acceptConnection(user,encrypted);assert.equal(connected.identity.fingerprint,first.identity.fingerprint);
  await assert.rejects(device.acceptConnection(user,encrypted),/new connection request/);
  await assert.rejects(device.connectAnotherDevice(user,{...link,userId:other}),/another account/);
  await assert.rejects(device.connectAnotherDevice(user,{...link,expiresAt:Date.now()-1}),/expired/);
 });
 await t.test('AES message session keys are fresh for repeated identical content',async()=>{
  const pgp=await import('openpgp'),publicKey=await cryptoLayer.readPublic(first.identity.publicKey,first.identity.fingerprint);
  const payload={protocol:cryptoLayer.PROTOCOL,conversationId:'fixture',clientId:'fixture',senderDevice:'fixture',recipientDevice:'fixture',text:'Controlled test only'};
  const a=await cryptoLayer.encryptMessage(payload,first.privateKey,[publicKey]),b=await cryptoLayer.encryptMessage(payload,first.privateKey,[publicKey]);
  const local=await store.openDevice(user),key=await pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:local.identity.privateKey}),passphrase:local.secret});
  const ka=await pgp.decryptSessionKeys({message:await pgp.readMessage({armoredMessage:a}),decryptionKeys:key}),kb=await pgp.decryptSessionKeys({message:await pgp.readMessage({armoredMessage:b}),decryptionKeys:key});
  const packet=(await pgp.readMessage({armoredMessage:a})).packets.findPacket(pgp.enums.packet.symEncryptedIntegrityProtectedData);
  assert.equal(packet.version,2);assert.equal(packet.cipherAlgorithm,pgp.enums.symmetric.aes256);assert.equal(packet.aeadAlgorithm,pgp.enums.aead.gcm);
  assert.equal(ka[0].data.length,32);assert.notDeepEqual(ka[0].data,kb[0].data);
 });
 await t.test('revocation clears local access and next authorization rotates the identity',async()=>{
  await device.removeMessageDevice(user,first.device.id);assert.equal(await store.openDevice(user),null);
  const replacement=await device.ensureMessageDevice();assert.notEqual(replacement.identity.fingerprint,first.identity.fingerprint);
 });
});
