// Shared real-place selection. Searches run only on an explicit action, never each keystroke.
export function placePicker({input,button,results,message,onSelect,onInvalidate=()=>{}}){
 let request,sequence=0;
 input.addEventListener('input',()=>{sequence++;request?.abort();button.disabled=false;results.replaceChildren();onInvalidate();});
 async function search(){
  const query=input.value.trim();const token=++sequence;request?.abort();request=new AbortController();results.replaceChildren();
  if(query.length<2){message.textContent='Enter a town or neighbourhood.';input.focus();return;}
  button.disabled=true;message.textContent='Finding places…';
  try{const response=await fetch('/api/listings?view=places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query}),signal:request.signal});const data=await response.json();if(token!==sequence)return;if(!response.ok)throw Error(data.message||'Places could not be loaded. Please try again.');
   for(const item of data.items||[]){const option=document.createElement('button');option.type='button';option.className='place-choice';option.textContent=item.label;option.addEventListener('click',()=>{sequence++;input.value=item.label;results.replaceChildren();message.textContent='';onSelect(item);});results.append(option);}
   message.textContent=results.children.length?'Choose a place below.':'No places found. Try a nearby town or add the country name.';
  }catch(error){if(token===sequence&&error.name!=='AbortError')message.textContent=error.message||'Places could not be loaded. Please try again.';}finally{if(token===sequence)button.disabled=false;}
 }
 button.addEventListener('click',()=>void search());input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void search();}});
 return {search};
}
