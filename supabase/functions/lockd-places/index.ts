// Public locality lookup. All database writes use the Edge Function's built-in server credential.
// No raw IP, precise visitor position, street address, query text or provider credential is logged.
const send=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const url=Deno.env.get('SUPABASE_URL')||'',secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const publicKeys=Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}')).filter((key):key is string=>typeof key==='string');
const legacyPublicKey=Deno.env.get('SUPABASE_ANON_KEY');if(legacyPublicKey)publicKeys.push(legacyPublicKey);
async function db(path:string,method='GET',body?:unknown){
 const response=await fetch(url+'/rest/v1/'+path,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Place storage unavailable');return response.json();
}
function publicPlace(row:any){return{id:row.id,label:row.label,country:row.country_code,latitude:Math.round(row.latitude*100)/100,longitude:Math.round(row.longitude*100)/100};}
Deno.serve(async request=>{
 if(!publicKeys.includes(request.headers.get('apikey')||''))return send(401,{message:'Use LOCKD place search.'});
 if(request.method!=='POST')return send(405,{message:'Use place search.'});
 if(Number(request.headers.get('content-length')||0)>1024)return send(413,{message:'Search is too long.'});
 const key=Deno.env.get('GEOAPIFY_API_KEY');if(!key||!url||!secret)return send(503,{message:'Places are unavailable.'});
 try{
  const raw=await request.text();if(raw.length>1024)return send(413,{message:'Search is too long.'});
  let input;try{input=JSON.parse(raw);}catch{return send(400,{message:'Enter a town or neighbourhood.'});}
  const query=typeof input.query==='string'?input.query.trim().replace(/\s+/g,' '):'';
  const reverse=input.reverse===true,latitude=input.latitude,longitude=input.longitude;
  if(reverse?(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180):(query.length<2||query.length>80||!/[\p{L}]/u.test(query)||!/^[\p{L} .,'’()&-]+$/u.test(query)))return send(400,{message:'Enter a town or neighbourhood.'});
  const coarseLat=Math.round(latitude*10)/10,coarseLon=Math.round(longitude*10)/10;
  const cacheKey=reverse?`city:${coarseLat},${coarseLon}`:query.toLocaleLowerCase('en');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cacheKey)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const cached=await db('lockd_place_search_cache?query_hash=eq.'+hash+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=place_ids');
  if(cached.length){const ids=cached[0].place_ids;if(!ids.length)return send(200,{items:[]});const rows=await db('lockd_places?id=in.('+ids.join(',')+')&select=id,label,country_code,latitude,longitude');return send(200,{items:ids.map((id:string)=>rows.find((row:any)=>row.id===id)).filter(Boolean).map(publicPlace)});}
  if(await db('rpc/lockd_claim_place_lookup','POST',{})!==true)return send(429,{message:'Please try again shortly.'});
  const endpoint=new URL('https://api.geoapify.com/v1/geocode/'+(reverse?'reverse':'search'));endpoint.search=new URLSearchParams({...reverse?{lat:String(coarseLat),lon:String(coarseLon),type:'city'}:{text:query,type:'locality'},format:'json',lang:'en',limit:reverse?'1':'6',apiKey:key}).toString();
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(9000)});if(!response.ok)return send(503,{message:'Places are unavailable.'});
  const result=await response.json();if(!Array.isArray(result.results))return send(503,{message:'Places are unavailable.'});
  const valid=result.results.filter((p:any)=>typeof p.place_id==='string'&&p.place_id.length<=1024&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180&&/^[a-z]{2}$/i.test(p.country_code||'')&&!p.housenumber&&!p.street&&['city','suburb','district','county','state','village','town','municipality','locality','neighbourhood','quarter','hamlet'].includes(p.result_type));
  const places=valid.map((p:any)=>({provider:'geoapify',provider_id:p.place_id,label:String(p.formatted||[p.city||p.name,p.state,p.country].filter(Boolean).join(', ')).slice(0,160),country_code:p.country_code.toUpperCase(),latitude:p.lat,longitude:p.lon,verified_at:new Date().toISOString()}));
  const unique=[...new Map(places.map((p:any)=>[p.provider_id,p])).values()];
  const saved=unique.length?await db('lockd_places?on_conflict=provider_id','POST',unique):[];
  await db('lockd_place_search_cache?on_conflict=query_hash','POST',{query_hash:hash,place_ids:saved.map((p:any)=>p.id),expires_at:new Date(Date.now()+30*86400000).toISOString()});
  return send(200,{items:saved.map(publicPlace)});
 }catch{return send(503,{message:'Places are unavailable.'});}
});
