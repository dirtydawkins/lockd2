import {node,action} from './private-client.mjs';
const titles={account_holder:'Name on the document',service_address:'Physical address',postal_address:'Postal address',account_reference:'Account ending',meter_reference:'Meter ending',issue_date:'Date issued',due_date:'Due date',statement_start:'Statement starts',statement_end:'Statement ends',institution:'Bank or provider',currency:'Currency',amount_due:'Amount due',document_reference:'Document reference',billing_period:'Billing period',opening_balance:'Opening balance',closing_balance:'Closing balance'};
const text=value=>String(value??'Not shown');
export const fieldTitle=key=>titles[key]||key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export function fieldDetails(fields){
 const details=node('dl',undefined,{class:'evidence-details'});
 for(const [key,field]of Object.entries(fields||{})){
  if(!field||typeof field!=='object')continue;
  const value=node('dd',text(field.value));
  if(Number.isInteger(field.page)&&field.page>0)value.append(node('small',`Page ${field.page}`));
  if(field.conflicts?.length)value.append(node('small','More than one value appears. Check the original.'));
  details.append(node('dt',fieldTitle(key)),value);
 }
 return details;
}
const findings={incomplete_page_sequence:'Some statement pages may be missing.',running_balance_mismatch:'Some balances don’t add up. Check the original statement.',future_issue_date:'The issue date appears to be in the future.',due_before_issue:'The due date appears before the issue date.',no_readable_text:'The text could not be read clearly.',address_not_extracted:'A physical address could not be read.',unrecognized_document_type:'Check that this is the requested document type.'};
export function reviewEvidence(doc,onError){
 const panel=node('section',undefined,{class:'evidence-review'}),analysis=doc.analysis||{};
 panel.append(fieldDetails(analysis.fields));
 const summary=analysis.financial?.summary;
 if(summary){
  panel.append(node('h4','Statement summary'));
  const details=node('dl',undefined,{class:'evidence-details'}),currency=/^[A-Z]{3}$/.test(summary.currency||'')?summary.currency:'';
  for(const [key,title]of [['total_incoming','Money received'],['total_outgoing','Money sent'],['net_transaction_flow','Net flow'],['average_monthly_inflows','Average monthly receipts'],['average_monthly_outflows','Average monthly spending']])if(summary[key]!=null)details.append(node('dt',title),node('dd',`${currency} ${summary[key]}`.trim()));
  if(Number.isInteger(summary.coverage_days))details.append(node('dt','Statement coverage'),node('dd',`${summary.coverage_days} days`));
  panel.append(details,node('p','Statement figures are supporting evidence. They are not proof of income, affordability or creditworthiness.'));
 }
 const observations=[...(analysis.findings||[]).map(f=>f.code),...(analysis.financial?.signals||[])];
 if(observations.length){const list=node('ul');for(const code of [...new Set(observations)].slice(0,30))list.append(node('li',findings[code]||fieldTitle(code)));panel.append(node('h4','Points to check'),list);}
 const comparisons=analysis.cross_document?.comparisons||[];
 if(comparisons.length){const list=node('ul');for(const item of comparisons)list.append(node('li',`${fieldTitle(item.field)}: ${['normalized_text_agrees','exact_match','strong_match'].includes(item.state)?'the wording agrees across the evidence.':'check the differences against both originals.'}`));panel.append(node('h4','Across your evidence'),list,node('p','Differences can come from initials, spelling or shared household documents. They do not prove fraud.'));}
 panel.append(action('Download original',async()=>{try{
  const session=await window.LockdAccount.getSession();if(!session)throw Error('Sign in to continue.');
  const response=await fetch('/api/documents?view=file&id='+encodeURIComponent(doc.id),{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'});
  if(!response.ok||(await window.LockdAccount.getSession())?.user?.id!==session.user.id)throw Error('The original is unavailable. Refresh and try again.');
  const url=URL.createObjectURL(await response.blob()),link=node('a','',{href:url,download:'verification-evidence'});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){onError(error.message);}}));
 return panel;
}
export function correctionDetails(corrections){
 const section=node('section');
 if(!corrections?.length){section.append(node('p','No corrections were submitted.'));return section;}
 for(const item of corrections){const details=node('dl',undefined,{class:'evidence-details'});section.append(node('h4',new Date(item.created_at).toLocaleDateString()));for(const [key,value]of Object.entries(item.fields||{}))details.append(node('dt',fieldTitle(key)),node('dd',text(value)));section.append(details);}
 return section;
}
