import {node,action,status} from './private-client.mjs';
const feed=document.querySelector('#discover-feed');
let sdkPromise;
async function loadRenderer(){
 if(!document.querySelector('link[data-maplibre]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/assets/vendor/maplibre/maplibre-gl.css';css.dataset.maplibre='';document.head.append(css);}
 if(!sdkPromise)sdkPromise=import('/assets/vendor/maplibre/maplibre-gl.mjs').catch(error=>{sdkPromise=null;throw error;});
 return sdkPromise;
}
async function boot(){
 if(!feed||!window.LockdDiscovery)return;
 const config=await window.LockdAccount.getConfig();if(config.maps?.enabled===false)return;
 const controls=node('div',undefined,{class:'discovery-views',role:'group','aria-label':'Browse rentals'});
 const list=action('List',()=>switchView(false),'discovery-view'),mapButton=action('Map',()=>switchView(true),'discovery-view');
 list.setAttribute('aria-pressed','true');mapButton.setAttribute('aria-pressed','false');controls.append(list,mapButton);
 document.querySelector('.discovery-location-bar').append(controls);
 const filterForm=document.querySelector('#discovery-filters'),drawer=node('details',undefined,{class:'discovery-filter-drawer'}),filterLabel=node('summary','Filters');
 filterForm.before(drawer);drawer.append(filterLabel,filterForm);const wide=window.matchMedia('(min-width:761px)');drawer.open=wide.matches;
 wide.addEventListener('change',event=>{drawer.open=event.matches;if(!event.matches&&drawer.contains(document.activeElement))filterLabel.focus();});
 const section=node('section',undefined,{class:'discovery-map',hidden:'','aria-label':'Explore rentals and experiences on the map'});
 const toolbar=node('div',undefined,{class:'discovery-map-toolbar'}),near=action('Near me',()=>window.LockdDiscovery.requestLocation(),'text-button');
 toolbar.append(node('p','Explore this area'),near);
 const canvas=node('div',undefined,{class:'discovery-map-canvas',role:'region','aria-label':'Map of rentals and experiences'});
 const notice=node('p','',{class:'discovery-map-status',role:'status'}),selection=node('div',undefined,{class:'discovery-map-selection'});
 const more=action('More places',()=>load(true),'button button-light');more.hidden=true;
 const retry=action('Try again',()=>{if(map&&!loaded){map.remove();map=null;}return map?load():open();},'text-button');retry.hidden=true;
 section.append(toolbar,canvas,notice,retry,more,selection);document.querySelector('#discovery-feed-status').before(section);
 let map,renderer,active=false,loaded=false,page=0,run=0,controller,debounce,markers=[],records=[],areaSignature='';
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 function state(){return window.LockdDiscovery.getState();}
 function clearMarkers(){markers.forEach(marker=>marker.remove());markers=[];selection.replaceChildren();}
 function tell(message,error=false){status(notice,message,error);retry.hidden=!error;}
 function switchView(show){active=show;feed.dataset.discoveryView=show?'map':'list';section.hidden=!show;list.setAttribute('aria-pressed',String(!show));mapButton.setAttribute('aria-pressed',String(show));document.querySelector('#discovery-feed-status').hidden=show;
  if(show){if(map){map.resize();const area=state().location,signature=JSON.stringify(area);if(signature!==areaSignature&&area&&Number.isFinite(area.latitude)&&Number.isFinite(area.longitude)){areaSignature=signature;map.jumpTo({center:[area.longitude,area.latitude],zoom:area.mode==='approximate'?10:12});}if(loaded)void load();}else void open();}else{controller?.abort();run++;}}
 async function open(){
  if(map)return;mapButton.disabled=true;tell('Opening the map…');
  try{renderer=await loadRenderer();renderer.setWorkerUrl('/assets/vendor/maplibre/maplibre-gl-worker.mjs');renderer.setWorkerCount(2);
   const area=state().location,point=area&&Number.isFinite(area.latitude)&&Number.isFinite(area.longitude);
   map=new renderer.Map({container:canvas,style:'https://tiles.openfreemap.org/styles/positron',center:point?[area.longitude,area.latitude]:[0,20],zoom:point?(area.mode==='approximate'?10:12):1.4,maxZoom:17,minZoom:1,cooperativeGestures:true,attributionControl:{compact:true}});
   map.addControl(new renderer.NavigationControl({showCompass:false}),'top-right');
   areaSignature=JSON.stringify(area);map.once('load',()=>{const latest=state().location;if(latest&&Number.isFinite(latest.latitude)&&Number.isFinite(latest.longitude))map.jumpTo({center:[latest.longitude,latest.latitude],zoom:latest.mode==='approximate'?10:12});areaSignature=JSON.stringify(latest);loaded=true;for(const layer of map.getStyle().layers||[])if(layer.type==='background')map.setPaintProperty(layer.id,'background-color','#F7F4EF');void load();});
   map.on('moveend',()=>{if(active&&loaded){clearTimeout(debounce);debounce=setTimeout(()=>void load(),350);}});
   map.on('error',()=>{if(!loaded)tell('The map could not be loaded. You can still browse the list.',true);});
   canvas.addEventListener('webglcontextlost',()=>{loaded=false;tell('The map paused on this device. Try again or browse the list.',true);});
  }catch(error){tell('The map could not be opened. Try again or browse the list.',true);}finally{mapButton.disabled=false;}
 }
 function price(item){if(item.price_amount===null||!Number.isFinite(Number(item.price_amount)))return item.category==='experience'?'Experience':item.category==='stay'?'Stay':'Rental';
  return `${item.currency==='KES'?'KSh':item.currency} ${Number(item.price_amount).toLocaleString('en-KE')}${item.price_unit?' / '+item.price_unit:''}`;}
 function showSelection(items){selection.replaceChildren(...items.map((item,index)=>window.LockdDiscovery.createCard(item,index)));}
 function draw(){clearMarkers();const groups=new Map();for(const item of records){const key=item.latitude+','+item.longitude;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  for(const items of groups.values()){const first=items[0],button=node('button',items.length>1?`${items.length} places`:price(first),{type:'button',class:'map-price-pin','aria-label':items.length>1?`View ${items.length} rentals and experiences in this area`:`View ${first.title}, ${price(first)}`});
   button.addEventListener('click',event=>{canvas.querySelectorAll('.map-price-pin').forEach(el=>el.setAttribute('aria-pressed','false'));button.setAttribute('aria-pressed','true');showSelection(items);if(event.detail===0)selection.querySelector('a')?.focus({preventScroll:true});});
   markers.push(new renderer.Marker({element:button,anchor:'bottom'}).setLngLat([first.longitude,first.latitude]).addTo(map));
  }
 }
 async function load(append=false){
  if(!active||!loaded)return;const token=++run;controller?.abort();controller=new AbortController();retry.hidden=true;
  if(!append){clearMarkers();records=[];page=0;}more.hidden=true;section.setAttribute('aria-busy','true');tell('Finding places in this area…');
  const filters=state().filters,bounds=map.getBounds(),next=append?page+1:0;
  if(Boolean(filters.startDate)!==Boolean(filters.endDate)){tell('Choose both dates, or clear them to browse.');section.removeAttribute('aria-busy');return;}
  if(filters.startDate&&(map.getZoom()<6||bounds.getNorth()-bounds.getSouth()>20||bounds.getEast()-bounds.getWest()>20)){tell('Zoom in to check your dates.');section.removeAttribute('aria-busy');return;}
  const wrap=n=>((n+180)%360+360)%360-180,width=bounds.getEast()-bounds.getWest();
  const params=new URLSearchParams({view:'map',south:String(Math.max(-90,bounds.getSouth())),north:String(Math.min(90,bounds.getNorth())),west:String(width>=360?-180:wrap(bounds.getWest())),east:String(width>=360?180:wrap(bounds.getEast())),page:String(next)});
  for(const key of ['category','minPrice','maxPrice','startDate','endDate','quantity'])if(filters[key])params.set(key,filters[key]);
  if(filters.category==='stay'&&filters.guests)params.set('guests',filters.guests);if(filters.minPrice||filters.maxPrice)params.set('currency','KES');
  try{const response=await fetch('/api/listings?'+params,{cache:'no-store',signal:controller.signal}),data=await response.json();if(token!==run)return;if(!response.ok)throw Error(data.message||'These places could not be loaded.');
   page=next;const merged=new Map(records.map(item=>[item.id,item]));for(const item of data.items||[])if(Number.isFinite(item.latitude)&&Number.isFinite(item.longitude))merged.set(item.id,item);records=[...merged.values()];draw();
   more.hidden=!data.hasMore||page>=3;tell(records.length?`Showing ${records.length} ${records.length===1?'place':'places'} in this area.${data.availabilityVerified?' Dates checked.':''}${data.hasMore?' Move closer or load more to explore.':''}`:'No rentals or experiences in this area yet. Try another area.');
  }catch(error){if(token===run&&error.name!=='AbortError')tell(error.message||'The results could not be loaded. Please try again.',true);}finally{if(token===run)section.removeAttribute('aria-busy');}
 }
 window.addEventListener('lockd:discovery-change',event=>{if(!map||!active||!loaded)return;const area=event.detail?.location,signature=JSON.stringify(area);if(signature!==areaSignature){areaSignature=signature;if(area&&Number.isFinite(area.latitude)&&Number.isFinite(area.longitude)){map.easeTo({center:[area.longitude,area.latitude],zoom:area.mode==='approximate'?10:12,duration:reduced?0:300});return;}}
  clearTimeout(debounce);debounce=setTimeout(()=>void load(),200);
 });
 filterForm.addEventListener('change',()=>{const selected=Object.entries(state().filters).filter(([key,value])=>value&&!(key==='quantity'&&String(value)==='1'));filterLabel.textContent=selected.length?`Filters · ${selected.length}`:'Filters';if(active)filterForm.requestSubmit();});
 window.addEventListener('pageshow',()=>{if(active&&map){map.resize();void load();}});
 window.addEventListener('pagehide',()=>{controller?.abort();clearTimeout(debounce);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void boot().catch(()=>{}),{once:true});else void boot().catch(()=>{});
