export async function privateRequest(service,query={},body,expectedUserId=null) {
  const session=await window.LockdAccount.getSession();
  if(!session) throw Error('Sign in to continue.');
  const callerId=expectedUserId||session.user.id;
  if(expectedUserId&&session.user?.id!==expectedUserId)throw Error('Your account changed. Reopen messages to continue.');
  const response=await fetch(`/api/${service}?${new URLSearchParams(query)}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>({}));
  if((await window.LockdAccount.getSession())?.user?.id!==callerId)throw Error('Your account changed. Reload this page to continue.');
  if(!response.ok) throw Error(result.message || 'This action could not be completed. Please retry.');
  return result.item;
}
export async function storageRequest(bucket,path,{method='GET',data,mime='application/octet-stream'}={}) {
  if(!/^[a-z0-9-]+$/.test(bucket) || !/^[a-f0-9/-]+$/.test(path)) throw Error('Invalid storage reference.');
  const [session,config]=await Promise.all([window.LockdAccount.getSession(),window.LockdAccount.getConfig()]);
  if(!session) throw Error('Sign in to continue.');
  const response=await fetch(`${config.supabase.url}/storage/v1/object/${bucket}/${path}`,{method,headers:{apikey:config.supabase.publishableKey,Authorization:`Bearer ${session.access_token}`,...(data?{'Content-Type':mime,'x-upsert':'false'}:{})},body:data,cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw Error('The private file could not be transferred. Please retry.');
  return response;
}
export function node(tag,text,attributes={}) {
  const element=document.createElement(tag);
  if(text!==undefined) element.textContent=text;
  for(const [name,value] of Object.entries(attributes)) element.setAttribute(name,value);
  return element;
}
export function action(text,handler,className='text-button') {
  const button=node('button',text,{type:'button',class:className});
  button.addEventListener('click',async()=>{button.disabled=true;try{await handler();}finally{button.disabled=false;}});
  return button;
}
export function status(element,text,error=false) { element.textContent=text;element.dataset.kind=error?'error':'info'; }
export function label(text,input) {const el=node('label',undefined,{class:'account-field'});el.append(node('span',text),input);return el;}
