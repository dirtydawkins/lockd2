import {placePicker} from './place-picker.mjs';
import {attachWording} from './listing-wording.mjs';
const form=document.querySelector('#owner-listing-form');
if(form){
 const get=id=>document.getElementById(id),basics=form.querySelector('.owner-form-section'),existing=[...form.querySelectorAll('.owner-form-section')];
 const panel=(title)=>{const section=document.createElement('div');section.className='owner-form-section';const heading=document.createElement('h4');heading.textContent=title;heading.tabIndex=-1;section.append(heading);return section;};
 const first=panel('What would you like to list?'),area=panel('Where will renters find it?'),details=panel('Tell renters about it.'),review=panel('Review your listing.');
 const firstGrid=document.createElement('div');firstGrid.className='owner-form-grid';firstGrid.append(get('listing-category').closest('label'),get('listing-title').closest('label'));first.append(firstGrid);
 area.append(get('owner-location-picker'));
 details.append(get('listing-summary').closest('label'),get('listing-description').closest('label'),get('owner-category-fields'));
 attachWording(form, get('listing-description').closest('label'));
 const photos=existing[2],price=existing[1];photos.querySelector('h4').textContent='Add your photos.';price.querySelector('h4').textContent='Set your price and dates.';
 review.innerHTML='<h4 tabindex="-1">Ready to share?</h4><p class="owner-help">Check the details renters will see. You can edit or pause your listing later.</p><dl class="owner-review-list"></dl>';
 const panels=[first,area,details,photos,price,review],footer=form.querySelector('.owner-form-footer');basics.remove();for(const item of panels)footer.before(item);
 const progress=document.createElement('div');progress.className='owner-wizard-progress';progress.innerHTML='<p aria-live="polite"></p><progress max="6" value="1" aria-label="Listing progress"></progress>';form.prepend(progress);
 const nav=document.createElement('div');nav.className='owner-wizard-nav';const back=document.createElement('button'),next=document.createElement('button');back.type=next.type='button';back.className='owner-text-link';next.className='button button-dark';back.textContent='Back';next.textContent='Continue';nav.append(back,next);footer.before(nav);
 const publish=form.querySelector('[value="publish"]'),preview=get('owner-preview-open');let step=0;
 function summary(){const dl=review.querySelector('dl');dl.replaceChildren();for(const [term,value]of [['Category',get('listing-category').selectedOptions[0]?.textContent],['Title',get('listing-title').value],['Area',get('listing-location').value],['Rate',get('listing-price').value?`KSh ${Number(get('listing-price').value).toLocaleString('en-KE')} / ${get('listing-price-unit').value}`:'Not set'],['Dates',[get('availability-start').value,get('availability-end').value].filter(Boolean).join(' — ')||'Not set'],['Photos',String(get('owner-photo-list').children.length)]]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=term;dd.textContent=value||'Not set';row.append(dt,dd);dl.append(row);}}
 function show(index,focus=false){step=Math.max(0,Math.min(index,5));panels.forEach((item,i)=>item.hidden=i!==step);back.hidden=step===0;next.hidden=step===5;publish.hidden=step!==5;preview.hidden=step!==5;progress.querySelector('p').textContent=`Step ${step+1} of 6`;progress.querySelector('progress').value=step+1;if(step===5)summary();if(focus)panels[step].querySelector('h4')?.focus({preventScroll:false});}
 next.addEventListener('click',()=>{const invalid=[...panels[step].querySelectorAll('input,select,textarea')].find(input=>!input.checkValidity());if(invalid){invalid.reportValidity();return;}
  let message='';if(step===0&&get('listing-title').value.trim().length<2)message='Add a clear listing title.';
  if(step===1&&!get('listing-place-id').value)message='Find your town or neighbourhood and choose a result.';
  if(step===2&&get('listing-description').value.trim().length<30)message='Add a description of at least 30 characters.';
  if(step===3&&!get('owner-photo-list').children.length)message='Add a photo of what you are listing.';
  if(step===4&&(!(Number(get('listing-price').value)>0)||!get('availability-start').value||!get('availability-end').value||get('availability-end').value<=get('availability-start').value))message='Add your rate and a valid available date range.';
  get('owner-listing-status').textContent=message;if(!message)show(step+1,true);
 });back.addEventListener('click',()=>show(step-1,true));
 placePicker({input:get('listing-place-search'),button:get('listing-place-search-button'),results:get('listing-place-results'),message:get('listing-place-message'),onInvalidate:()=>{get('listing-place-id').value='';get('listing-location').value='';get('listing-latitude').value='';get('listing-longitude').value='';},onSelect:item=>{get('listing-place-id').value=item.id;get('listing-location').value=item.label;get('listing-latitude').value=item.latitude;get('listing-longitude').value=item.longitude;form.dispatchEvent(new Event('change',{bubbles:true}));}});
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.defaultPrevented&&step<5&&!['TEXTAREA','BUTTON'].includes(event.target.tagName)){event.preventDefault();next.click();}});
 form.addEventListener('reset',()=>show(0));window.addEventListener('lockd:listing-restored',()=>show(0));show(0);
}
