import {uploadForm} from './document-upload.mjs';
import {mountVerificationWorkflow} from './verification-workflow.mjs';
import {privateRequest,storageRequest,node,action,label,status} from './private-client.mjs';
const output=document.querySelector('#verification-status'),content=document.querySelector('#verification-content');
let capabilities=null,cases=[],creatingKey=null;
let accountId=null;
function request(service,query={},body){if(!accountId)throw Error('Open your account to continue.');return privateRequest(service,query,body,accountId);}
const methodNotes={utility:'Electricity, water or another utility bill. A different account-holder name can be explained.',tenancy:'Use your tenancy agreement, or explain an informal rental arrangement.',student:'A hostel allocation, accommodation letter or institutional confirmation can support your review.',landlord:'Explain who can confirm your residence. LOCKD will not contact them without an agreed, consent-based process.',family:'A bill in a family member’s name can support your review with an explanation of the connection.',other:'Explain your arrangement. A reviewer can consider alternative evidence under the rental’s rules.'};
const pretty=value=>String(value||'').replaceAll('_',' ');
const methodNames={utility:'Utility bill',tenancy:'Tenancy agreement',student:'Student accommodation',landlord:'Landlord or institution confirmation',family:'Family household',other:'Other supporting evidence'};
function report(error){status(output,error.message||'Please try again.',true);}
function field(name,value=''){const input=node('input');input.name=name;input.maxLength=400;input.value=value;return label(pretty(name),input);}
async function refresh(){
 cases=await request('documents');render();
 if(document.querySelector('#address-admin').hidden===false) await reviews();
}
function render(){
 const container=document.querySelector('#address-cases');container.replaceChildren();
 if(!cases.length) container.append(node('p','No address evidence submitted yet.'));
 for(const item of cases){
  const card=node('article',undefined,{class:'evidence-item'});
  card.append(node('h3',methodNames[item.method]||pretty(item.method)),node('p',pretty(item.state),{class:'evidence-state'}),node('p',item.declared_address));
  if(item.review_reason)card.append(node('p',item.review_reason));
  const docs=item.documents||[];
  for(const doc of docs)card.append(node('p',`Document: ${pretty(doc.state)}. Issuer not independently verified.`));
  if(['draft','more_evidence'].includes(item.state) && capabilities.uploadsEnabled){
   card.append(uploadForm(item,request,refresh,output));
  }
  if(['draft','needs_confirmation','more_evidence'].includes(item.state)){
   const form=node('form',undefined,{class:'account-form'}),message=node('p','',{role:'status'});
   const extracted=docs.find(doc=>doc.fields)?.fields||{};
   form.append(node('h4','Confirm the supporting details'),node('p','Correct any reading errors. Your changes are recorded separately from the original extraction.'));
   const controls=[];
   for(const name of (item.method==='utility'?['account_holder','service_address','issue_date','due_date','billing_period']:['account_holder','service_address','issue_date'])){
    const value=item.corrected_fields?.[name] ?? extracted[name]?.value ?? (name==='service_address'?item.declared_address:'');
    const wrapper=field(name,value);form.append(wrapper);controls.push(wrapper.querySelector('input'));
    if(extracted[name])form.append(node('small',`Source page ${extracted[name].page}; ${extracted[name].extraction==='tesseract'?'OCR reading':'embedded text'}. Please check it.`));
   }
   const submit=node('button','Submit for review',{type:'submit',class:'button button-dark'});form.append(submit,message);
   form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{
    const fields=Object.fromEntries(controls.filter(input=>input.value.trim()).map(input=>[input.name,input.value.trim()]));
    await request('documents',{}, {action:'submit',caseId:item.id,version:item.version,fields});status(output,'Submitted for review. You can follow its progress here.');await refresh();
   }catch(error){status(message,error.message,true);}finally{submit.disabled=false;}});card.append(form);
  }
  if(!['withdrawn','expired'].includes(item.state)){
   if(item.state==='declined'&&!item.appeal_used){
    const form=node('form',undefined,{class:'account-form'}),reason=node('textarea',undefined,{rows:'3',required:'',minlength:'10',maxlength:'2000'}),message=node('p','',{role:'status'});
    form.append(node('h4','Ask for another review'),label('What would you like the reviewer to consider?',reason),node('button','Request another review',{type:'submit',class:'button button-light'}),message);
    form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('documents',{}, {action:'appeal',caseId:item.id,reason:reason.value});await refresh();status(output,'Your request is awaiting another reviewer.');}catch(error){status(message,error.message,true);}finally{button.disabled=false;}});card.append(form);
   }
   const consent=node('details');consent.append(node('summary','Withdraw this submission'));
   consent.append(node('p','Withdraw processing consent and request deletion of the supporting documents. An address approval based on this submission will be revoked. Required operational audit metadata may be retained.'));
   consent.append(action('Confirm withdrawal',async()=>{try{await request('documents',{}, {action:'withdraw',caseId:item.id});await refresh();status(output,'Submission withdrawn. Document deletion is pending the retention worker.');}catch(error){report(error);}}));card.append(consent);
  }
  container.append(card);
 }
}
async function reviews(){
 const queue=await request('documents',{view:'reviews'}),target=document.querySelector('#address-review-queue');target.replaceChildren();
 if(!queue.length)target.append(node('p','No address submissions awaiting review.'));
 for(const item of queue)target.append(action(`${methodNames[item.method]||pretty(item.method)} · ${new Date(item.created_at).toLocaleDateString()}`,async()=>{
  try{
   const detail=await request('documents',{view:'review',id:item.id}),panel=document.querySelector('#address-review-detail');panel.replaceChildren();
   panel.append(node('h3',`Submission ${item.id.slice(0,8)}`),node('p',detail.case.declared_address),node('p',detail.case.explanation));
   for(const doc of detail.documents){
    panel.append(node('h4',`Document · ${pretty(doc.state)}`));
    if(doc.state==='screened')panel.append(action('Download original privately',async()=>{
     try{const session=await window.LockdAccount.getSession();const response=await fetch('/api/documents?view=file&id='+encodeURIComponent(doc.id),{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});if(!response.ok)throw Error('The private original is not available.');const blob=await response.blob(),url=URL.createObjectURL(blob),link=node('a','',{href:url,download:'address-evidence'});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){report(error);}
    }));
    if(doc.analysis){
     panel.append(node('p',`Screening ${doc.analysis.version}. Issuer: ${pretty(doc.analysis.issuer_status)}. No trained forgery model.`));
     const extracted=node('dl');for(const [key,value]of Object.entries(doc.analysis.fields||{})){extracted.append(node('dt',pretty(key)),node('dd',`${value.value} · page ${value.page} · region ${(value.bbox||[]).map(v=>Number(v).toFixed(2)).join(', ')}`));}panel.append(extracted);
     for(const finding of doc.analysis.findings||[])panel.append(node('p',`${pretty(finding.code)}. ${finding.limitation||'Human review required.'}`,{class:'evidence-finding'}));
     for(const limitation of doc.analysis.limitations||[])panel.append(node('small',limitation));
    }
   }
   panel.append(node('h4','Customer corrections'),node('pre',JSON.stringify(detail.corrections,null,2)));
   const form=node('form',undefined,{class:'account-form'}),select=node('select'),reason=node('textarea',undefined,{required:'',minlength:'10',maxlength:'2000',rows:'4'}),message=node('p','',{role:'status'});
   for(const value of ['more_evidence','accepted','declined'])select.append(node('option',pretty(value),{value}));
   form.append(label('Evidence decision',select),label('Reason and supporting provenance',reason),node('p','Acceptance attests to corroborated address evidence only. Do not infer issuer authentication from a readable document.'),node('button','Record decision',{type:'submit',class:'button button-dark'}),message);
   form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request('documents',{}, {action:'review',caseId:item.id,version:detail.case.version,decision:select.value,reason:reason.value});panel.replaceChildren(node('p','Review recorded.'));await refresh();}catch(error){status(message,error.message,true);}finally{button.disabled=false;}});
   panel.append(form,node('h4','Audit history'));for(const entry of detail.audit)panel.append(node('p',`${pretty(entry.event)} · ${new Date(entry.created_at).toLocaleString()}`));
  }catch(error){report(error);}
 }));
}
document.querySelector('#address-form select').addEventListener('change',event=>{document.querySelector('#method-note').textContent=methodNotes[event.target.value];});
document.querySelector('#method-note').textContent=methodNotes.utility;
document.querySelector('#address-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),message=form.querySelector('[role=status]');button.disabled=true;
 try{const data=new FormData(form);creatingKey ||=crypto.randomUUID();await request('documents',{}, {action:'create',method:data.get('method'),address:data.get('address'),explanation:data.get('explanation'),consent:capabilities.consentVersion,requestKey:creatingKey});creatingKey=null;form.reset();document.querySelector('#method-note').textContent=methodNotes.utility;status(message,'Draft saved to your account. Add evidence or request a review below.');await refresh();}
 catch(error){status(message,error.message,true);}finally{button.disabled=false;}
});
document.querySelector('#refresh-evidence').addEventListener('click',()=>refresh().catch(report));
window.addEventListener('lockd:auth-change',event=>{if(accountId&&event.detail?.user?.id!==accountId){accountId=null;content.hidden=true;cases=[];document.querySelector('#address-cases').replaceChildren();document.querySelector('#address-admin').replaceChildren();document.querySelector('#address-form').reset();status(output,'Your account changed. Reload this page to continue.');}});
try{
 const session=await window.LockdAccount.getSession();
 accountId=session?.user?.id||null;
 if(!session){output.replaceChildren(node('a','Sign in to continue',{href:window.LockdAccount.authLink({returnTo:'/verification.html'})}));}
 else{capabilities=await request('documents',{view:'capabilities'});document.querySelector('#document-upload-note').textContent=capabilities.uploadsEnabled?`PDF or image, up to 2 MB. Supporting data is scheduled for deletion after ${capabilities.retentionDays} days or withdrawal, subject to the privacy notice.`:'Private document uploads are not enabled yet.';content.hidden=false;document.querySelector('#address-admin').hidden=session.user?.app_metadata?.role!=='admin';await refresh();if(capabilities.submissionsEnabled===false){for(const element of document.querySelector('#address-form').elements)element.disabled=true;status(output,'Address submissions are getting ready. Please check back later.');}else{status(output,'Your address evidence is private to you and authorized reviewers.');}}
}catch(error){report(error);}
void mountVerificationWorkflow().catch(report);
