// Account-authorized elliptic-curve identity. Private keys never leave the device unencrypted.
import {privateRequest as request} from './private-client.mjs';
import {newIdentity,readPublic,unlock,encryptEvidence,decryptEvidence,PROTOCOL} from './messaging-crypto.mjs';
import {stored,openDevice,sealDevice} from './messaging-store.mjs';
const pending=new Map();
function randomSecret(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
async function createLocal(userId,slot='device:v2'){
 const secret=randomSecret(),identity=await newIdentity(userId,secret);
 return await sealDevice(userId,{identity,secret},{slot});
}
export async function ensureMessageDevice(){
 const session=await window.LockdAccount.getSession();if(!session)return {state:'signed_out'};
 const userId=session.user.id;if(pending.has(userId))return pending.get(userId);
 const operation=(async()=>{
  const capabilities=await request('messages',{view:'capabilities'},undefined,userId);
  if(!capabilities.enabled)return {state:'disabled',capabilities,userId};
  const devices=await request('messages',{view:'devices'},undefined,userId),active=devices.find(d=>!d.revoked_at);
  let local=await openDevice(userId);
  if(active&&(!local||active.fingerprint!==local.identity.fingerprint))return {state:'another_device',active,capabilities,userId};
  if(!active&&local&&devices.some(d=>d.fingerprint===local.identity.fingerprint&&d.revoked_at)){await stored(userId,'device:v2',null);local=null;}
  local ||=await createLocal(userId);
  await readPublic(local.identity.publicKey,local.identity.fingerprint);
  const privateKey=await unlock(local.identity,local.secret);
  const device=await request('messages',{}, {action:'registerDevice',publicKey:local.identity.publicKey,fingerprint:local.identity.fingerprint},userId);
  return {state:'ready',identity:local.identity,privateKey,device,capabilities,userId};
 })();
 pending.set(userId,operation);
 try{return await operation;}finally{pending.delete(userId);}
}
export async function createConnectionRequest(userId){
 // Transfer keys are ephemeral and never published as a replacement messaging identity.
 await stored(userId,'link:v2',null);
 const local=await createLocal(userId,'link:v2'),requestId=crypto.randomUUID(),expiresAt=Date.now()+10*60*1000;
 const data={format:'lockd-device-link-v1',userId,requestId,origin:location.origin,publicKey:local.identity.publicKey,fingerprint:local.identity.fingerprint,expiresAt};
 await stored(userId,'link-request:v2',data);return data;
}
export async function connectAnotherDevice(userId,link){
 if(link?.format!=='lockd-device-link-v1'||link.userId!==userId||link.origin!==location.origin||!Number.isFinite(link.expiresAt)||link.expiresAt<=Date.now()||link.expiresAt>Date.now()+10*60*1000||!/^[a-f0-9-]{36}$/.test(link.requestId||''))throw Error('This connection request expired or belongs to another account.');
 const local=await openDevice(userId);if(!local)throw Error('Open your messages on this browser first.');
 const session=await window.LockdAccount.getSession();if(session?.user?.id!==userId)throw Error('Your account changed. Reopen messages to continue.');
 const recipient=await readPublic(link.publicKey,link.fingerprint),key=await unlock(local.identity,local.secret);
 return await encryptEvidence({format:'lockd-device-transfer-v1',userId,requestId:link.requestId,recipientFingerprint:link.fingerprint,expiresAt:link.expiresAt,identity:local.identity,secret:local.secret},key,recipient);
}
export async function acceptConnection(userId,armored){
 const [link,transfer]=await Promise.all([stored(userId,'link-request:v2'),openDevice(userId,'link:v2')]);
 if(!link||!transfer||link.expiresAt<=Date.now())throw Error('Create a new connection request on this browser first.');
 const devices=await request('messages',{view:'devices'},undefined,userId),active=devices.find(d=>!d.revoked_at);
 if(!active)throw Error('The original message access is no longer active.');
 const publicKey=await readPublic(active.public_key,active.fingerprint),privateKey=await unlock(transfer.identity,transfer.secret);
 const value=await decryptEvidence(armored,privateKey,publicKey);
 if(value.format!=='lockd-device-transfer-v1'||value.userId!==userId||value.requestId!==link.requestId||value.recipientFingerprint!==link.fingerprint||value.expiresAt!==link.expiresAt||value.expiresAt<=Date.now()||value.identity?.protocol!==PROTOCOL||value.identity.fingerprint!==active.fingerprint||typeof value.secret!=='string'||value.secret.length!==64)throw Error('The connection file does not match this browser and account.');
 await readPublic(value.identity.publicKey,value.identity.fingerprint);await unlock(value.identity,value.secret);
 await sealDevice(userId,{identity:value.identity,secret:value.secret},{replace:true});
 await stored(userId,'link:v2',null);await stored(userId,'link-request:v2',null);
 return await ensureMessageDevice();
}
export async function removeMessageDevice(userId,deviceId){
 await request('messages',{}, {action:'revokeDevice',id:deviceId},userId);
 await stored(userId,'device:v2',null);
}
