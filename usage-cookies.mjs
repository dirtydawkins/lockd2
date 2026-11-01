// First-party, consent-gated cookies only. No external analytics, URL history or search text.
const names=['lockd_visitor','lockd_session','lockd_usage'];let active=false;
export function readCookie(name){try{const entry=document.cookie.split('; ').find(item=>item.startsWith(name+'='));return entry?decodeURIComponent(entry.slice(name.length+1)):'';}catch{return '';}}
export function writeCookie(name,value,seconds){document.cookie=name+'='+encodeURIComponent(value)+'; Path=/; SameSite=Lax; Max-Age='+seconds+(location.protocol==='https:'?'; Secure':'');}
function usage(){try{const value=JSON.parse(readCookie('lockd_usage')||'{}');return{visits:Number.isSafeInteger(value.visits)?Math.max(0,value.visits):0,pages:Number.isSafeInteger(value.pages)?Math.max(0,value.pages):0,searches:Number.isSafeInteger(value.searches)?Math.max(0,value.searches):0};}catch{return{visits:0,pages:0,searches:0};}}
function consented(){try{const choice=JSON.parse(readCookie('lockd_consent')||'null');return choice?.version===2&&choice.optional===true;}catch{return false;}}
function count(type){if(!active||!consented())return;const value=usage();value[type]=Math.min(1000000,value[type]+1);writeCookie('lockd_usage',JSON.stringify(value),7776000);}
const sensitive=/auth|account|owner|book|checkout|payment|verification|messages/i.test(location.pathname);
export function startUsage(){if(active||sensitive||!consented())return;active=true;try{if(!readCookie('lockd_visitor'))writeCookie('lockd_visitor',crypto.randomUUID(),7776000);if(!readCookie('lockd_session')){writeCookie('lockd_session',crypto.randomUUID(),1800);count('visits');}else writeCookie('lockd_session',readCookie('lockd_session'),1800);count('pages');}catch{active=false;}}
export function stopUsage(){active=false;for(const name of names)writeCookie(name,'',0);}
document.addEventListener('submit',event=>{if(event.target.matches('#idea-search-form,#discovery-filters,form[role="search"]'))count('searches');},true);
