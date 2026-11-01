// One landing search. Existing listings remain the source for rentals and experiences.
const form=document.querySelector('#idea-search-form');
if(form){
 const scopes=document.createElement('fieldset');scopes.className='search-scopes';
 const legend=document.createElement('legend');legend.className='visually-hidden';legend.textContent='Search for';scopes.append(legend);
 for(const [value,text] of [['all','All'],['rental','Rentals'],['experience','Experiences'],['lister','Listers']]){
  const label=document.createElement('label'),radio=document.createElement('input');radio.type='radio';radio.name='searchKind';radio.value=value;radio.checked=value==='all';
  label.append(radio,document.createTextNode(text));if(value==='lister'){label.hidden=true;label.dataset.listerScope='';}scopes.append(label);
 }
 form.before(scopes);
 const category=document.querySelector('#idea-category');
 scopes.addEventListener('change',()=>{const kind=scopes.querySelector(':checked').value;category.disabled=kind==='lister'||kind==='experience';document.querySelector('#idea-location').disabled=kind==='lister';if(kind==='experience')category.value='experience';else if(category.value==='experience')category.value='';document.querySelector('label[for="idea-search"]').textContent=kind==='lister'?'Who are you looking for?':'What are you looking for?';document.querySelector('#idea-search').dispatchEvent(new Event('input'));});
 form.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();const target=new URL('rentals.html',location.href),kind=scopes.querySelector(':checked').value;
  const query=document.querySelector('#idea-search').value.trim(),place=document.querySelector('#idea-location').value.trim();
  if(query)target.searchParams.set('q',query);if(place&&kind!=='lister')target.searchParams.set('location',place);
  if(kind==='experience')target.searchParams.set('category','experience');else if(kind!=='lister'&&category.value)target.searchParams.set('category',category.value);
  target.searchParams.set('kind',kind);location.assign(target.href);
 },true);
 fetch('/api/listings?view=listers',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{if(data?.configured&&data.items?.length)scopes.querySelector('[data-lister-scope]').hidden=false;}).catch(()=>{});
}
