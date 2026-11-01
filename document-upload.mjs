import {node,label,status,storageRequest} from './private-client.mjs';
const photos=new Set(['image/jpeg','image/png','image/webp']);
export function fileMime(bytes){
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
 if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 if(String.fromCharCode(...bytes.slice(0,5))==='%PDF-')return 'application/pdf';
 return null;
}
async function prepare(file,photoOnly){
 if(!file||file.size<16||file.size>2097152)throw Error('Choose a file up to 2 MB.');
 const mime=fileMime(new Uint8Array(await file.slice(0,16).arrayBuffer()));
 if(!mime||photoOnly&&!photos.has(mime))throw Error(photoOnly?'Choose a JPG, PNG or WebP photo. PDF bills are not accepted.':'Choose a PDF, JPG, PNG or WebP file.');
 if(!photos.has(mime))return {file,mime};
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>12000000)throw Error('Choose a photo smaller than 12 megapixels.');
  if(!photoOnly)return {file,mime};
  // Re-encode the actual photograph, preserving orientation and pixels, omitting EXIF/GPS.
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  canvas.getContext('2d').drawImage(bitmap,0,0);
  const clean=await new Promise(resolve=>canvas.toBlob(resolve,mime,.95));
  if(!clean||clean.size>2097152)throw Error('Choose a smaller photo, up to 2 MB.');
  return {file:clean,mime:clean.type};
 }finally{bitmap.close();}
}
export function uploadForm(item,request,refresh,output){
 const photoOnly=item.method==='utility',form=node('form',undefined,{class:'account-form'}),message=node('p','',{role:'status'});
 const input=node('input',undefined,{type:'file',accept:photoOnly?'image/jpeg,image/png,image/webp':'.pdf,.jpg,.jpeg,.png,.webp'});
 const camera=node('input',undefined,{type:'file',accept:'image/jpeg,image/png,image/webp',capture:'environment',hidden:''});
 const preview=node('img',undefined,{class:'photo-upload-preview',alt:'Your selected photo',hidden:''}),progress=node('progress',undefined,{max:'100',value:'0',class:'photo-upload-progress',hidden:'','aria-label':'Upload progress'});
 const controls=node('div',undefined,{class:'photo-upload-actions'}),take=node('button','Take a photo',{type:'button',class:'text-button'}),replace=node('button','Choose another file',{type:'button',class:'text-button'}),submit=node('button','Upload privately',{type:'submit',class:'button button-light'});
 let chosen=null,url=null;
 const clear=()=>{if(url)URL.revokeObjectURL(url);url=null;chosen=null;preview.hidden=true;preview.removeAttribute('src');};
 async function select(file){clear();submit.disabled=true;try{chosen=await prepare(file,photoOnly);if(photos.has(chosen.mime)){url=URL.createObjectURL(chosen.file);preview.src=url;preview.hidden=false;}status(message,photoOnly?'Check that the name, address and dates are readable.':'Ready to upload.');}catch(error){status(message,error.message,true);}finally{submit.disabled=!chosen;}}
 input.addEventListener('change',()=>void select(input.files[0]));camera.addEventListener('change',()=>void select(camera.files[0]));
 take.addEventListener('click',()=>camera.click());replace.addEventListener('click',()=>input.click());
 controls.append(take,replace);submit.disabled=true;
 form.append(label(photoOnly?'Utility bill photo · JPG, PNG or WebP, up to 2 MB':'Supporting file · PDF or image, up to 2 MB',input),camera,preview,controls,progress,submit,message);
 form.addEventListener('submit',async event=>{event.preventDefault();if(!chosen)return;submit.disabled=true;input.disabled=true;progress.hidden=false;progress.value=0;
  try{const reservation=await request('documents',{}, {action:'reserve',caseId:item.id,mime:chosen.mime,bytes:chosen.file.size});status(message,'Uploading…');
   await storageRequest(reservation.bucket,reservation.path,{method:'POST',data:chosen.file,mime:chosen.mime,onProgress:percent=>{progress.value=percent;}});
   await request('documents',{}, {action:'queue',documentId:reservation.id});clear();status(output,'File received. We’ll check it before the review.');await refresh();
  }catch(error){status(message,error.message,true);}finally{input.disabled=false;submit.disabled=!chosen;progress.hidden=true;}
 });
 const observer=new MutationObserver(()=>{if(!form.isConnected){clear();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
 return form;
}
