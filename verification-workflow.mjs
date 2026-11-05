// Capability-gated foundation: no financial collection or setup UI for ordinary visitors.
import {privateRequest,node,label,action,status} from './private-client.mjs';
import {uploadForm} from './document-upload.mjs';
import {fieldTitle,fieldDetails,reviewEvidence,correctionDetails} from './verification-review.mjs';
const names={identity:'Identity',address:'Address',financial:'Financial evidence',credit:'Credit check',fraud:'Safety review',student:'Student evidence'};
const states={awaiting_upload:'Add your evidence',processing:'Checking your file',needs_confirmation:'Check the details',under_review:'Awaiting review',additional_information:'More information needed',verified:'Review complete',unable_to_verify:'Couldn’t verify',rejected:'Review decision',expired:'Expired',revoked:'No longer valid',withdrawn:'Withdrawn'};
export async function mountVerificationWorkflow(){
 const session=await window.LockdAccount.getSession();if(!session)return;
 const userId=session.user.id,request=(query={},body)=>privateRequest('documents',{module:'verification',...query},body,userId);
 let config;try{config=await request({view:'capabilities'});}catch{return;}
 if(!config.enabled)return;
 const root=node('section',undefined,{class:'trust-section','aria-labelledby':'rental-verification-title'}),message=node('p','',{role:'status'}),list=node('div');
 root.append(node('h2','Your verification',{id:'rental-verification-title'}),message,list);
 document.querySelector('#verification-content').hidden=false;
 document.querySelector('#main').append(root);
 const bookingId=new URL(location.href).searchParams.get('booking');let requirements,key=null;
 async function refresh(){
  const items=await request();list.replaceChildren();
  if(!items.length)list.append(node('p','No submissions yet.'));
  for(const item of items){
   const card=node('article',undefined,{class:'evidence-item'});
   card.append(node('h3',item.required_checks.map(check=>names[check]||'Review').join(' · ')),node('p',states[item.state]||'Review in progress'),node('p',item.purpose));
   if(item.review_reason)card.append(node('p',item.review_reason));
   if(config.uploadsEnabled&&['awaiting_upload','additional_information','needs_confirmation'].includes(item.state)){
    const kinds=[...(item.required_checks.includes('address')?['utility','tenancy','student','family','landlord','other']:[]),...(item.financial_method?[item.financial_method]:[])];
    const kind=node('select');for(const value of kinds)kind.append(node('option',value==='mpesa'?'M-Pesa statement':value==='bank'?'Bank statement':value==='utility'?'Utility bill photo':value==='family'?'Family household evidence':value[0].toUpperCase()+value.slice(1),{value}));
    const upload=node('div');
    const replace=()=>{const chosenKind=kind.value;upload.replaceChildren(uploadForm({id:item.id,method:chosenKind},(_service,query,body)=>request(query,{...body,...(body.action==='reserve'?{kind:chosenKind}:{})}),refresh,message));};
    kind.addEventListener('change',replace);card.append(label('Supporting document',kind),upload);replace();
   }
   for(const doc of item.documents||[]){
    card.append(node('h4',doc.kind==='mpesa'?'M-Pesa statement':doc.kind==='bank'?'Bank statement':'Address evidence'));
    if(doc.passwordNeeded){
     const unlock=node('form',undefined,{class:'account-form'}),password=node('input',undefined,{type:'password',autocomplete:'off',required:'',maxlength:'256'}),button=node('button','Unlock statement',{type:'submit',class:'button button-light'});
     unlock.append(node('p','This statement needs its file password. We use it once to read the file and don’t save it.'),label('Statement password',password),button);
     unlock.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;const value=password.value;password.value='';try{const result=await privateRequest('documents',{module:'verification',view:'unlock'},{documentId:doc.id,password:value},userId,{timeoutMs:60000});await refresh();status(message,result.state==='screened'?'Statement read. Check the details before submitting.':result.state==='password_required'?'The file is still locked. Check its password and try again.':'Refresh to check the statement’s progress.',result.state!=='screened');}catch(error){status(message,error.message,true);}finally{button.disabled=false;}});
     card.append(unlock);continue;
    }
    if(doc.state!=='screened'){card.append(node('p',doc.state==='processing'?'Checking your file.':'We couldn’t read this file. You can add another copy or ask for help.'));continue;}
    card.append(fieldDetails(doc.fields));
    if(doc.summary&&/^[A-Z]{3}$/.test(doc.summary.currency||'')){const summary=doc.summary,unit=summary.currency;
     for(const [key,title]of [['total_incoming','Money received'],['total_outgoing','Money sent'],['net_transaction_flow','Net flow']])if(summary[key]!==null)card.append(node('p',`${title}: ${unit} ${summary[key]}`));
     card.append(node('p','These figures describe the statement, not your income or a credit score.'));
    }
   }
   if(['needs_confirmation','additional_information'].includes(item.state)){
    const form=node('form',undefined,{class:'account-form'}),controls=[];
    form.append(node('h4','Check your details'),node('p','Correct any reading errors. The original reading is kept for review.'));
    const fields=new Map((item.documents||[]).flatMap(doc=>Object.entries(doc.fields||{})));
    for(const [name,field]of fields){if(!['account_holder','service_address','issue_date','due_date','billing_period','statement_start','statement_end','currency','institution'].includes(name))continue;const input=node('input',undefined,{name,maxlength:'1000'});input.value=field.value;form.append(label(fieldTitle(name),input));controls.push(input);}
    form.append(node('button','Send for review',{type:'submit',class:'button button-dark'}));
    form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await request({}, {action:'submit',caseId:item.id,version:item.version,fields:Object.fromEntries(controls.map(input=>[input.name,input.value.trim()]))});await refresh();status(message,'Submitted for review.');}catch(error){status(message,error.message,true);}finally{button.disabled=false;}});card.append(form);
   }
   if(['rejected','unable_to_verify'].includes(item.state)&&!item.appeal_used){
    const form=node('form',undefined,{class:'account-form'}),reason=node('textarea',undefined,{required:'',minlength:'10',maxlength:'2000',rows:'3'});
    form.append(label('What should another reviewer consider?',reason),node('button','Ask for another review',{type:'submit',class:'button button-light'}));
    form.addEventListener('submit',async event=>{event.preventDefault();try{await request({}, {action:'transition',caseId:item.id,version:item.version,transition:'appeal',reason:reason.value});await refresh();}catch(error){status(message,error.message,true);}});card.append(form);
   }
   if(!['withdrawn','expired'].includes(item.state)){const withdraw=node('details');withdraw.append(node('summary','Withdraw submission'),node('p','Stop processing and request deletion of these documents. Required security records may be retained.'),action('Confirm withdrawal',async()=>{try{await request({}, {action:'transition',caseId:item.id,version:item.version,transition:'withdraw'});await refresh();}catch(error){status(message,error.message,true);}}));card.append(withdraw);}
   list.append(card);
  }
 }
 root.append(action('Refresh',()=>refresh().catch(error=>status(message,error.message,true))));
 try{requirements=await request({view:'requirements',...(bookingId?{bookingId}:{})});}catch(error){status(message,error.message,true);}
 if(requirements?.checks?.length){
  const form=node('form',undefined,{class:'account-form'}),method=node('select'),address=node('textarea',undefined,{maxlength:'1000',rows:'3'}),consent=node('input',undefined,{type:'checkbox',required:''}),credit=node('input',undefined,{type:'checkbox'});
  form.append(node('p',requirements.purpose));
  if(requirements.checks.includes('financial')){method.append(node('option','Choose a statement',{value:''}),node('option','M-Pesa statement',{value:'mpesa'}),node('option','Bank statement',{value:'bank'}));method.required=true;form.append(label('Choose one financial method',method));}
  if(requirements.checks.includes('address')){address.required=true;address.minLength=5;form.append(label('Physical address',address));}
  form.append(node('p',`Documents are private to you and authorized reviewers. They are scheduled for deletion after ${config.retentionDays} days or withdrawal. Reading a document does not prove that it is authentic.`),label('I agree to processing this evidence for the review described above.',consent),node('a','Privacy notice',{href:'privacy.html#address-evidence'}));
  if(requirements.creditAllowed)form.append(label('I separately agree to the credit check described for this reservation.',credit));
  form.append(node('button','Continue',{type:'submit',class:'button button-dark'}));
  form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{key||=crypto.randomUUID();await request({}, {action:'create',bookingId:bookingId||undefined,method:method.value||undefined,address:address.value,consent:config.consentVersion,creditConsent:credit.checked,requestKey:key});key=null;form.reset();await refresh();}catch(error){status(message,error.message,true);}finally{button.disabled=false;}});root.prepend(form);
 }
 await refresh();
 if(config.reviewer){
  const admin=node('section',undefined,{class:'trust-section'});admin.append(node('h2','Verification reviews'));root.append(admin);
  const queue=await request({view:'reviews'});if(!queue.length)admin.append(node('p','No submissions awaiting review.'));
  for(const item of queue)admin.append(action('Open submission · '+new Date(item.created_at).toLocaleDateString(),async()=>{
   const detail=await request({view:'review',id:item.id}),panel=node('article',undefined,{class:'evidence-item'}),form=node('form',undefined,{class:'account-form'}),decision=node('select'),reason=node('textarea',undefined,{required:'',minlength:'10',maxlength:'2000',rows:'3'});
   for(const value of ['additional_information','verified','unable_to_verify','rejected'])decision.append(node('option',states[value],{value}));
   panel.append(node('h3','Review evidence'),node('p',detail.case.purpose));
   for(const doc of detail.documents){panel.append(node('h4',doc.kind==='mpesa'?'M-Pesa statement':doc.kind==='bank'?'Bank statement':'Supporting evidence'),reviewEvidence(doc,text=>status(message,text,true)));}
   panel.append(node('h4','Customer corrections'),correctionDetails(detail.corrections));
   form.append(label('Decision',decision),label('Reason and supporting evidence',reason),node('button','Record review',{type:'submit',class:'button button-dark'}));
   form.addEventListener('submit',async event=>{event.preventDefault();try{await request({}, {action:'transition',caseId:item.id,version:detail.case.version,transition:decision.value,reason:reason.value});panel.replaceChildren(node('p','Review recorded.'));await refresh();}catch(error){status(message,error.message,true);}});panel.append(form);admin.append(panel);
  }));
 }
 window.addEventListener('lockd:auth-change',event=>{if(event.detail?.user?.id!==userId)root.remove();});
}
