// Display the current account's photo; never publish its private storage path.
let generation=0;
async function refresh(){
 const current=++generation,targets=[...document.querySelectorAll('[data-own-profile-photo]')];
 targets.forEach(target=>{target.hidden=true;target.replaceChildren();});
 try{const session=await window.LockdAccount.getSession();if(!session?.user||current!==generation)return;
  const profile=await window.LockdAccount.getProfile(session.user),url=await window.LockdAccount.profilePhotoUrl(profile,session.user.id);
  if(!url||current!==generation||(await window.LockdAccount.getSession())?.user?.id!==session.user.id)return;
  targets.forEach(target=>{const image=document.createElement('img');image.src=url;image.alt='';image.width=40;image.height=40;image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{target.hidden=true;target.replaceChildren();},{once:true});target.append(image);target.hidden=false;});
 }catch{/* Photo failure must not block account navigation or messaging. */}
}
window.addEventListener('lockd:auth-change',()=>void refresh());
window.addEventListener('lockd:profile-change',()=>void refresh());
void refresh();
