// Encrypted private key + ciphertext outbox only. No passphrases or plaintext history.
function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open('lockd-private-messaging',1);req.onupgradeneeded=()=>req.result.createObjectStore('records');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('Private device storage is unavailable.'));});}
export async function stored(userId,key,value){
 const db=await database();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('records',value===undefined?'readonly':'readwrite'),store=tx.objectStore('records');let result;
  const req=value===undefined?store.get(`${userId}:${key}`):value===null?store.delete(`${userId}:${key}`):store.put(value,`${userId}:${key}`);
  req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('Private device storage could not be updated.'));
 });}finally{db.close();}
}
const aad=userId=>new TextEncoder().encode('LOCKD message device v2:'+userId);
export async function openDevice(userId,slot='device:v2'){
 const record=await stored(userId,slot);if(!record)return null;
 if(record.version!==2||record.key?.extractable!==false||record.key?.algorithm?.name!=='AES-GCM'||record.iv?.byteLength!==12||record.ciphertext?.byteLength>60000)throw Error('This browser’s private message access could not be opened.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad(userId)},record.key,record.ciphertext);
 const value=JSON.parse(new TextDecoder().decode(plain));
 if(value.userId!==userId||typeof value.secret!=='string'||value.secret.length!==64||value.identity?.protocol!=='openpgp-rfc9580-v1')throw Error('Message access does not match this account.');
 return value;
}
export async function sealDevice(userId,value,{slot='device:v2',replace=false}={}){
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(userId)},key,new TextEncoder().encode(JSON.stringify({...value,userId})));
 const record={version:2,key,iv,ciphertext},db=await database();
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
  const write=replace?store.put(record,`${userId}:${slot}`):store.add(record,`${userId}:${slot}`);
  write.onerror=event=>{if(write.error?.name==='ConstraintError'){event.preventDefault();event.stopPropagation();}};
  tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Private message access could not be saved on this browser.'));
 });}finally{db.close();}
 // Concurrent tabs use the atomically selected identity, never overwrite one another's key.
 return await openDevice(userId,slot);
}
