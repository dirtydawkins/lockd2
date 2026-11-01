import {node} from './private-client.mjs';
const gallery=document.querySelector('.rental-gallery'),thumbs=document.querySelector('#rental-thumbnails');
if(gallery&&thumbs){
 const figure=gallery.querySelector('figure'),expand=node('button','View photos',{type:'button',class:'gallery-expand',hidden:''});figure.append(expand);
 const dialog=node('dialog',undefined,{class:'photo-viewer','aria-label':'Rental photographs'}),header=node('header'),close=node('button','Close',{type:'button'}),counter=node('span',''),image=node('img',undefined,{alt:''}),footer=node('footer'),previous=node('button','Previous',{type:'button'}),next=node('button','Next',{type:'button'});header.append(counter,close);footer.append(previous,next);dialog.append(header,image,footer);document.body.append(dialog);
 let index=0,start=null;
 function photos(){return [...thumbs.querySelectorAll('button img')].map(el=>el.src);}
 function show(value){const items=photos();if(!items.length)return;index=(value+items.length)%items.length;image.src=items[index];image.alt=gallery.querySelector('figure>img')?.alt||'Rental photograph';counter.textContent=`${index+1} of ${items.length}`;previous.hidden=next.hidden=items.length<2;}
 expand.addEventListener('click',()=>{index=[...thumbs.children].findIndex(el=>el.getAttribute('aria-current')==='true');show(Math.max(index,0));dialog.showModal();close.focus();});
 close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{image.removeAttribute('src');expand.focus();});previous.addEventListener('click',()=>show(index-1));next.addEventListener('click',()=>show(index+1));
 dialog.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();show(index+1);}if(event.key==='ArrowLeft'){event.preventDefault();show(index-1);}});
 function swipe(target,move){target.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')start={x:event.clientX,y:event.clientY};});target.addEventListener('pointerup',event=>{if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;start=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);});target.addEventListener('pointercancel',()=>start=null);}
 swipe(image,step=>show(index+step));swipe(figure,step=>{const buttons=[...thumbs.querySelectorAll('button')],current=buttons.findIndex(b=>b.getAttribute('aria-current')==='true');if(buttons.length>1)buttons[(current+step+buttons.length)%buttons.length].click();});
 new MutationObserver(()=>{expand.hidden=!photos().length;}).observe(thumbs,{childList:true});
}
