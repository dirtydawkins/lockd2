const {test}=require('node:test'),assert=require('node:assert/strict');
test('OpenPGP v6 signed ciphertext interoperates and rejects tampering and replay',async t=>{
 const pgp=await import('openpgp'),m=await import('../messaging-crypto.mjs');
 const a=await m.newIdentity('synthetic-a','synthetic passphrase 111'),b=await m.newIdentity('synthetic-b','synthetic passphrase 222'),c=await m.newIdentity('synthetic-c','synthetic passphrase 333');
 const ak=await m.unlock(a,'synthetic passphrase 111'),bk=await m.unlock(b,'synthetic passphrase 222'),ck=await m.unlock(c,'synthetic passphrase 333');
 const ap=await m.readPublic(a.publicKey,a.fingerprint),bp=await m.readPublic(b.publicKey,b.fingerprint),cp=await m.readPublic(c.publicKey,c.fingerprint);
 const payload={protocol:m.PROTOCOL,conversationId:crypto.randomUUID(),clientId:crypto.randomUUID(),senderDevice:crypto.randomUUID(),recipientDevice:crypto.randomUUID(),text:'Synthetic confidential message'};
 const ciphertext=await m.encryptMessage(payload,ak,[ap,bp]);
 const row={conversation_id:payload.conversationId,client_id:payload.clientId,sender_device:payload.senderDevice,recipient_device:payload.recipientDevice,ciphertext};
 await t.test('encrypted private key needs passphrase and v6 fingerprints are exact',async()=>{
  await assert.rejects(m.unlock(a,'wrong passphrase'));
  assert.equal(a.fingerprint.length,64);assert.equal((await pgp.readPrivateKey({armoredKey:a.privateKey})).isDecrypted(),false);
  await assert.rejects(m.readPublic(a.publicKey,b.fingerprint),/fingerprint/);
 });
 await t.test('recipient and sender can decrypt their signed history',async()=>{
  assert.equal((await m.decryptMessage(row,bk,ap)).text,payload.text);
  assert.equal((await m.decryptMessage(row,ak,ap)).text,payload.text);
  assert.equal(ciphertext.includes(payload.text),false);
 });
 await t.test('independent Node OpenPGP consumer verifies browser-bundle output',async()=>{
  const key=await pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:b.privateKey}),passphrase:'synthetic passphrase 222'});
  const result=await pgp.decrypt({message:await pgp.readMessage({armoredMessage:ciphertext}),decryptionKeys:key,verificationKeys:await pgp.readKey({armoredKey:a.publicKey}),expectSigned:true});
  await result.signatures[0].verified;assert.equal(JSON.parse(result.data).text,payload.text);
 });
 await t.test('non-recipient and substituted sender cannot decrypt or authenticate',async()=>{
  await assert.rejects(m.decryptMessage(row,ck,ap));
  await assert.rejects(m.decryptMessage(row,bk,cp));
 });
 await t.test('replay into another conversation or client ID rejected',async()=>{
  await assert.rejects(m.decryptMessage({...row,conversation_id:crypto.randomUUID()},bk,ap),/context/);
  await assert.rejects(m.decryptMessage({...row,client_id:crypto.randomUUID()},bk,ap),/context/);
  await assert.rejects(m.decryptMessage({...row,sender_device:crypto.randomUUID()},bk,ap),/context/);
 });
 await t.test('unsigned data is refused',async()=>{
  const unsigned=await pgp.encrypt({message:await pgp.createMessage({text:JSON.stringify(payload)}),encryptionKeys:await pgp.readKey({armoredKey:b.publicKey})});
  await assert.rejects(m.decryptMessage({...row,ciphertext:unsigned},bk,ap));
 });
 await t.test('key changes require explicit matching pin',()=>{
  assert.throws(()=>m.assertPinned(undefined,a.fingerprint));assert.throws(()=>m.assertPinned(a.fingerprint,b.fingerprint));m.assertPinned(a.fingerprint,a.fingerprint);
 });
 await t.test('attachment bytes are encrypted, signed and bound to a digest',async()=>{
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5dQAAAAASUVORK5CYII=','base64'));
  const attachment=await m.encryptAttachment(png,ak,[ap,bp]);
  assert.deepEqual(await m.decryptAttachment(attachment.ciphertext,attachment,bk,ap),png);
  await assert.rejects(m.decryptAttachment(attachment.ciphertext,{...attachment,sha256:'0'.repeat(64)},bk,ap),/integrity/);
  await assert.rejects(m.decryptAttachment(attachment.ciphertext,attachment,bk,cp));
  assert.throws(()=>m.attachmentType(new Uint8Array(Buffer.from('<html>executable content</html>'))),/not allowed/);
  assert.throws(()=>m.attachmentType(new Uint8Array(2097153)),/2 MB/);
 });
 await t.test('report uses a separate investigator key without disclosing other history',async()=>{
  const evidence=await m.encryptEvidence({selected:[payload.text]},bk,cp);
  const result=await pgp.decrypt({message:await pgp.readMessage({armoredMessage:evidence}),decryptionKeys:await pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:c.privateKey}),passphrase:'synthetic passphrase 333'}),verificationKeys:await pgp.readKey({armoredKey:b.publicKey}),expectSigned:true});
  await result.signatures[0].verified;assert.deepEqual(JSON.parse(result.data),{selected:[payload.text]});
  await assert.rejects(pgp.decrypt({message:await pgp.readMessage({armoredMessage:evidence}),decryptionKeys:await pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:a.privateKey}),passphrase:'synthetic passphrase 111'})}));
 });
});
