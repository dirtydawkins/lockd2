import {node,action,status} from './private-client.mjs';
const params=new URLSearchParams(location.search),lister=params.get('lister'),kind=params.get('kind'),query=params.get('q')||'';
const main=document.querySelector('main');
async function read(url){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await response.json();if(!response.ok)throw Error(data.message||'This search could not be completed.');return data;}
function card(item){const el=node('article',undefined,{class:'lister-card'}),link=node('a',undefined,{href:'lister.html?lister='+encodeURIComponent(item.slug)});
 link.append(node('span',item.name.slice(0,1).toUpperCase(),{class:'lister-initial','aria-hidden':'true'}),node('h3',item.name),node('p',item.bio),node('span',`${item.listing_count} ${item.listing_count===1?'rental or experience':'rentals and experiences'}`,{class:'lister-count'}));el.append(link);return el;}
async function directory(){
 if(!main||(!['all','lister'].includes(kind)))return;
 const section=node('section',undefined,{class:'lister-directory','aria-labelledby':'lister-results-title'}),heading=node('h2','Listers',{id:'lister-results-title'}),notice=node('p','Searching listers…',{role:'status'}),grid=node('div',undefined,{class:'lister-grid'});section.append(heading,notice,grid);main.append(section);
 const hostOnly=kind==='lister';
 if(hostOnly){document.querySelector('#catalogue-title').textContent='Find a lister.';document.querySelector('#catalogue-description').textContent='People offering rentals and experiences on LOCKD.';for(const selector of ['#listing-grid','#catalogue-status','#load-more','.catalogue-controls','#vehicle-filters']){const el=document.querySelector(selector);if(el)el.hidden=true;}
  const search=node('form',undefined,{class:'lister-search',role:'search'}),input=node('input',undefined,{name:'q',type:'search',value:query,'aria-label':'Search lister names',placeholder:'Search lister names'});search.append(input,node('button','Search listers',{class:'button button-burgundy'}));search.addEventListener('submit',event=>{event.preventDefault();const url=new URL(location.href);url.searchParams.set('q',input.value.trim());url.searchParams.delete('page');location.assign(url);});section.insertBefore(search,notice);
 }
 let page=0;const next=action('More listers',()=>load(true),'button button-light');next.hidden=true;section.append(next);
 async function load(append=false){try{const current=append?page+1:0,data=await read('/api/listings?'+new URLSearchParams({view:'listers',q:query,page:String(current)}));if(!data.configured){if(hostOnly)status(notice,'Lister search is unavailable right now. Please try again later.');else section.hidden=true;return;}page=current;if(!append)grid.replaceChildren();grid.append(...data.items.map(card));next.hidden=!data.hasMore;notice.textContent=grid.children.length?'':'No listers matched your search. Try another name.';if(!hostOnly&&!grid.children.length)section.hidden=true;}catch(error){status(notice,error.message,true);if(!hostOnly)section.hidden=true;}}
 await load();
}
async function profile(){
 const root=document.querySelector('#lister-profile');if(!root)return;
 try{const data=await read('/api/listings?'+new URLSearchParams({view:'lister',lister:lister||'',page:'0'}));
  if(!data.configured)throw Error('Lister profiles are unavailable right now.');if(!data.item){root.replaceChildren(node('h1','Lister profile unavailable.'),node('p','This lister has no public rentals or experiences to show.'));return;}
  const profile=data.item;document.title=profile.name+' · LOCKD';root.replaceChildren(node('p','LISTER',{class:'eyebrow'}),node('h1',profile.name),node('p',profile.bio,{class:'catalogue-lede'}),node('p','Choose a rental or experience to view details or message this lister.'));
  const grid=node('div',undefined,{class:'listing-grid'}),notice=node('p','Loading rentals…',{role:'status'});root.append(notice,grid);let page=0;
  const more=action('More rentals',async()=>{page++;await load();},'button button-light');more.hidden=true;root.append(more);
  async function load(){const value=page?(await read('/api/listings?'+new URLSearchParams({view:'lister',lister,page:String(page)}))).item:profile;if(!value)throw Error('This lister profile changed. Refresh the page.');const ids=value.listingIds||[];more.hidden=ids.length<=24;if(!ids.length){notice.textContent='No public rentals or experiences to show.';return;}
   const listings=await read('/api/listings?ids='+ids.slice(0,24).join(','));for(const listing of listings.items){const el=node('article',undefined,{class:'listing-card'}),link=node('a',undefined,{href:'rental.html?slug='+encodeURIComponent(listing.slug)});if(listing.images?.[0]){const img=node('img',undefined,{src:listing.images[0],alt:listing.image_alt||listing.title,loading:'lazy',width:'736',height:'600',class:'lister-listing-photo'});window.LockdImages?.configure(img,listing,0);link.append(img);}link.append(node('h3',listing.title),node('p',listing.location_label||''));if(listing.price_amount!==null&&listing.currency)link.append(node('p',`${listing.currency} ${Number(listing.price_amount).toLocaleString('en-KE')} / ${listing.price_unit}`));el.append(link);
    const contact=node('a','Message lister',{class:'text-button',href:'messages.html?listing='+encodeURIComponent(listing.id),'aria-label':'Message the lister about '+listing.title});
    el.append(contact);grid.append(el);}notice.textContent='';}
  await load();
 }catch(error){root.replaceChildren(node('h1','Lister profile unavailable.'),node('p',error.message),node('a','Explore rentals',{href:'rentals.html'}));}
}
await Promise.all([directory(),profile()]);
