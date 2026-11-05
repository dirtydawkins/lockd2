import {placePicker} from './place-picker.mjs';
import {dialogUI} from './dialog-ui.mjs';
const input=document.querySelector('#manual-location-input'),dialog=document.querySelector('#location-dialog');
if(input&&dialog){
 const form=document.querySelector('#manual-location-form'),results=document.querySelector('#manual-place-results'),message=document.querySelector('#location-dialog-status'),recent=document.querySelector('#recent-location-choices'),gps=document.querySelector('#use-current-location');
 form.addEventListener('submit',event=>event.preventDefault());
 function position(anchor){
  const viewport=window.visualViewport,height=viewport?.height||innerHeight;
  const set=(name,value)=>{if(dialog.style.getPropertyValue(name)!==value)dialog.style.setProperty(name,value);};
  set('--location-height',height+'px');set('--keyboard-bottom',Math.max(0,innerHeight-height-(viewport?.offsetTop||0))+'px');
  if(!matchMedia('(min-width:761px)').matches)return;
  const menu=document.querySelector('.menu-toggle');
  const target=anchor?.isConnected&&anchor.getClientRects().length?anchor:menu?.getClientRects().length?menu:document.querySelector('#open-location-picker');
  const r=target.getBoundingClientRect(),header=document.querySelector('.site-header')?.getBoundingClientRect();
  const safeTop=Math.max(16,header?.bottom>0?header.bottom+12:16),width=Math.min(460,innerWidth-32);
  const bottom=Math.max(safeTop,r.bottom+12),below=height-bottom-16,above=r.top-safeTop-12;
  const useBelow=below>=360||below>=above,maxHeight=Math.max(180,Math.min(620,useBelow?below:above,height-safeTop-16));
  const top=useBelow?Math.min(bottom,height-maxHeight-16):Math.max(safeTop,r.top-Math.min(dialog.scrollHeight||maxHeight,maxHeight)-12);
  set('--location-max-height',maxHeight+'px');set('--location-top',top+'px');
  set('--location-left',Math.max(16,Math.min(r.left,innerWidth-width-16))+'px');
 }

 async function choose(id){message.textContent='Finding this place…';try{const response=await fetch('/api/listings?view=places&id='+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(8000)}),data=await response.json();if(!response.ok||!data.item)throw Error();window.LockdDiscovery.setArea(data.item,{save:true});ui.close();}catch{message.textContent='That place could not be loaded. Please search again.';}}
 function showRecent(){recent.replaceChildren();let items=[];try{items=JSON.parse(localStorage.getItem('lockd:recent-places:v1')||'[]');}catch{}if(!Array.isArray(items))items=[];for(const item of items.slice(0,4)){if(typeof item.label!=='string'||!/^[0-9a-f-]{36}$/i.test(item.id||''))continue;const button=document.createElement('button');button.type='button';button.className='place-choice recent-place';button.textContent=item.label;button.addEventListener('click',()=>void choose(item.id));recent.append(button);}document.querySelector('#recent-locations').hidden=!recent.children.length||Boolean(input.value.trim());}
 const ui=dialogUI(dialog,{position,focus:()=>input,onOpen:()=>{document.querySelector('#primary-nav')?.classList.remove('is-open');document.querySelector('.menu-toggle')?.setAttribute('aria-expanded','false');message.textContent='';input.value='';results.replaceChildren();form.hidden=false;showRecent();}});
 window.LockdLocationPicker=ui;
 const picker=placePicker({input,button:document.querySelector('#manual-location-search'),results,message,autoSearch:true,onInvalidate:showRecent,onSelect:item=>{window.LockdDiscovery.setArea(item,{save:true});ui.close();}});
 dialog.addEventListener('close',()=>{picker.cancel();if(gps.disabled)window.LockdDiscovery.cancelLocationRequest();});
 document.querySelector('#location-anywhere').addEventListener('click',()=>{window.LockdDiscovery.clearArea();ui.close();});
 const searchField=document.querySelector('#idea-location');searchField.readOnly=true;searchField.placeholder='Anywhere';searchField.setAttribute('aria-haspopup','dialog');searchField.setAttribute('aria-controls','location-dialog');
 searchField.addEventListener('click',()=>ui.open(searchField));searchField.addEventListener('keydown',event=>{if(['Enter','ArrowDown',' '].includes(event.key)){event.preventDefault();ui.open(searchField);}});
 document.querySelectorAll('[data-location-trigger]').forEach(button=>button.addEventListener('click',()=>ui.open(button)));
 dialog.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;const options=[...dialog.querySelectorAll('#manual-place-results button,#recent-location-choices button')].filter(button=>!button.closest('[hidden]'));if(!options.length)return;const index=options.indexOf(document.activeElement);if(document.activeElement===input||index>=0){event.preventDefault();options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();}});
 try{gps.hidden=Boolean(localStorage.getItem('lockd:location-denied:v1'));}catch{}
 if(navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(permission=>{const sync=()=>{if(permission.state==='denied'){gps.hidden=true;try{localStorage.setItem('lockd:location-denied:v1','1');}catch{}}else if(permission.state==='granted'){gps.hidden=false;try{localStorage.removeItem('lockd:location-denied:v1');}catch{}}};sync();permission.addEventListener('change',sync);}).catch(()=>{});
}
