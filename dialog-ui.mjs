// Native dialog focus containment with restrained transitions and light dismissal.
export function dialogUI(dialog,{position=()=>{},focus=()=>dialog.querySelector('button'),onOpen=()=>{}}={}){
 let trigger,timer,dragStart=null;
 const close=()=>{if(!dialog.open)return;clearTimeout(timer);dialog.classList.add('is-closing');timer=setTimeout(()=>dialog.close(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:200);};
 const open=anchor=>{if(document.querySelector('dialog[open]')&&!dialog.open)return false;clearTimeout(timer);dialog.classList.remove('is-closing');trigger=anchor instanceof HTMLElement?anchor:document.activeElement;if(!dialog.open)dialog.showModal();position(trigger);onOpen();focus()?.focus({preventScroll:true});return true;};
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
 dialog.addEventListener('close',()=>{clearTimeout(timer);dialog.classList.remove('is-closing');dialog.style.removeProperty('--sheet-drag');requestAnimationFrame(()=>{const target=trigger?.isConnected&&trigger.getClientRects().length?trigger:document.querySelector('.menu-toggle,.cookie-preferences-link');target?.focus({preventScroll:true});});});
 dialog.querySelectorAll('[data-dialog-close]').forEach(button=>button.addEventListener('click',close));
 const grip=dialog.querySelector('[data-sheet-grip]');
 grip?.addEventListener('pointerdown',event=>{if(!matchMedia('(max-width:760px)').matches)return;dragStart=event.clientY;grip.setPointerCapture(event.pointerId);dialog.classList.add('is-dragging');});
 grip?.addEventListener('pointermove',event=>{if(dragStart!==null)dialog.style.setProperty('--sheet-drag',Math.max(0,event.clientY-dragStart)+'px');});
 function endDrag(event){if(dragStart===null)return;const distance=event.clientY-dragStart;dragStart=null;dialog.classList.remove('is-dragging');dialog.style.removeProperty('--sheet-drag');if(distance>65)close();}
 grip?.addEventListener('pointerup',endDrag);grip?.addEventListener('pointercancel',()=>{dragStart=null;dialog.classList.remove('is-dragging');dialog.style.removeProperty('--sheet-drag');});
 const resize=()=>{if(dialog.open)position(trigger);};window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
 if('ResizeObserver'in window)new ResizeObserver(resize).observe(dialog);
 return{open,close};
}
