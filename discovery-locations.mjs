import {placePicker} from './place-picker.mjs';
const input=document.querySelector('#manual-location-input');
if(input){
 const form=document.querySelector('#manual-location-form');form.addEventListener('submit',event=>event.preventDefault());
 placePicker({input,button:document.querySelector('#manual-location-search'),results:document.querySelector('#manual-place-results'),message:document.querySelector('#location-dialog-status'),onSelect:item=>{window.LockdDiscovery?.setArea(item,{save:true});document.querySelector('#location-dialog').close();}});
}
