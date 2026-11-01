// Established OpenPGP wire format; no proprietary cipher or server-side private key.
// This application integration still requires independent cryptographic review.
import * as pgp from './vendor/openpgp-6.3.2.min.mjs';

const config={v6Keys:true,aeadProtect:true,preferredAEADAlgorithm:pgp.enums.aead.gcm,
  preferredSymmetricAlgorithm:pgp.enums.symmetric.aes256,maxDecompressedMessageSize:3*1024*1024};
export const PROTOCOL='openpgp-rfc9580-v1';
export async function newIdentity(userId,passphrase) {
  if(typeof passphrase!=='string' || passphrase.length<16) throw Error('Private message access could not be prepared.');
  const keys=await pgp.generateKey({type:'curve25519',userIDs:[{name:`LOCKD ${userId}`}],passphrase,format:'armored',config});
  const publicKey=await pgp.readKey({armoredKey:keys.publicKey});
  return {publicKey:keys.publicKey,privateKey:keys.privateKey,fingerprint:publicKey.getFingerprint(),protocol:PROTOCOL};
}
export async function readPublic(armored,fingerprint) {
  if(typeof armored!=='string' || armored.length>20000 || !/^[a-f0-9]{64}$/.test(fingerprint||'')) throw Error('Invalid messaging identity.');
  const key=await pgp.readKey({armoredKey:armored});
  if(key.getFingerprint()!==fingerprint || key.isPrivate() || key.keyPacket.version!==6) throw Error('Messaging identity does not match its fingerprint.');
  await key.verifyPrimaryKey();
  return key;
}
export async function unlock(identity,passphrase) {
  const key=await pgp.decryptKey({privateKey:await pgp.readPrivateKey({armoredKey:identity.privateKey}),passphrase,config});
  if(key.getFingerprint()!==identity.fingerprint) throw Error('Messaging identity does not match.');
  return key;
}
export async function encryptMessage(payload,privateKey,recipients) {
  if(payload.protocol!==PROTOCOL || typeof payload.text!=='string' || payload.text.length>8000) throw Error('Invalid message.');
  const encrypted=await pgp.encrypt({message:await pgp.createMessage({text:JSON.stringify(payload)}),encryptionKeys:recipients,signingKeys:privateKey,format:'armored',config});
  if(encrypted.length>65536) throw Error('Message is too large.');
  return encrypted;
}
export async function decryptMessage(row,privateKey,senderKey) {
  if(typeof row.ciphertext!=='string' || row.ciphertext.length>65536) throw Error('Invalid encrypted message.');
  const result=await pgp.decrypt({message:await pgp.readMessage({armoredMessage:row.ciphertext}),decryptionKeys:privateKey,verificationKeys:senderKey,expectSigned:true,config});
  if(result.signatures.length!==1) throw Error('Message signature could not be verified.');
  await result.signatures[0].verified;
  if(typeof result.data!=='string' || result.data.length>16000) throw Error('Message exceeds its limit.');
  const payload=JSON.parse(result.data);
  if(payload.protocol!==PROTOCOL || payload.conversationId!==row.conversation_id || payload.clientId!==row.client_id || payload.senderDevice!==row.sender_device || payload.recipientDevice!==row.recipient_device || typeof payload.text!=='string' || payload.text.length>8000)
    throw Error('Message context or identity could not be verified.');
  return payload;
}
export async function encryptEvidence(payload,privateKey,investigator) {
  const encrypted=await pgp.encrypt({message:await pgp.createMessage({text:JSON.stringify(payload)}),encryptionKeys:investigator,signingKeys:privateKey,format:'armored',config});
  if(encrypted.length>262144) throw Error('Choose fewer messages for this report.');
  return encrypted;
}
export async function hash(value) {
  const bytes=typeof value==='string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function assertPinned(stored,current) {
  if(!stored || stored!==current) throw Error('Compare and verify this contact’s current fingerprint before continuing.');
}
export function attachmentType(bytes) {
  if(!(bytes instanceof Uint8Array) || bytes.length<16 || bytes.length>2097152)throw Error('Choose an image or PDF up to 2 MB.');
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  if(String.fromCharCode(...bytes.slice(0,5))==='%PDF-')return 'application/pdf';
  throw Error('Executable files, HTML and unsupported attachments are not allowed.');
}
export async function encryptAttachment(bytes,privateKey,recipients) {
  const mime=attachmentType(bytes);
  const ciphertext=await pgp.encrypt({message:await pgp.createMessage({binary:bytes}),encryptionKeys:recipients,signingKeys:privateKey,format:'binary',config});
  if(ciphertext.length>2200000)throw Error('The encrypted attachment is too large.');
  return {ciphertext,mime,bytes:bytes.length,sha256:await hash(ciphertext)};
}
export async function decryptAttachment(ciphertext,metadata,privateKey,senderKey) {
  if(ciphertext.length>2200000 || await hash(ciphertext)!==metadata.sha256)throw Error('Attachment integrity could not be verified.');
  const result=await pgp.decrypt({message:await pgp.readMessage({binaryMessage:ciphertext}),decryptionKeys:privateKey,verificationKeys:senderKey,expectSigned:true,format:'binary',config});
  if(result.signatures.length!==1)throw Error('Attachment signature could not be verified.');
  await result.signatures[0].verified;
  if(result.data.length!==metadata.bytes || attachmentType(result.data)!==metadata.mime)throw Error('Attachment format does not match.');
  return result.data;
}
export async function decryptEvidence(ciphertext,privateKey,reporterKey) {
  if(typeof ciphertext!=='string'||ciphertext.length>262144)throw Error('Invalid evidence.');
  const result=await pgp.decrypt({message:await pgp.readMessage({armoredMessage:ciphertext}),decryptionKeys:privateKey,verificationKeys:reporterKey,expectSigned:true,config});
  if(result.signatures.length!==1)throw Error('Report signature could not be verified.');
  await result.signatures[0].verified;
  return JSON.parse(result.data);
}
