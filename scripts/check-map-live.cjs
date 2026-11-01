// Actual public services only. No fixture records, seeded inventory, sessions or mocked responses.
const assert=require('node:assert/strict');
const origin=process.env.LOCKD_CHECK_ORIGIN||'https://lockd2.vercel.app';
let passed=0;
async function read(path,options){const response=await fetch(origin+path,options);return{status:response.status,data:await response.json()};}
function check(name,run){run();passed++;console.log('PASS '+name);}
(async()=>{
 const bounds='south=-80&west=-180&north=80&east=180';
 const map=await read('/api/listings?view=map&'+bounds);
 check('Actual map query returns the public catalogue contract',()=>{assert.equal(map.status,200);assert.ok(Array.isArray(map.data.items));assert.equal(typeof map.data.hasMore,'boolean');assert.equal(map.data.availabilityVerified,false);for(const item of map.data.items){assert.ok(item.id);assert.equal(Number((item.latitude*100).toFixed(7))%1,0);assert.equal(Number((item.longitude*100).toFixed(7))%1,0);assert.ok(!Object.hasOwn(item,'owner_id'));assert.ok(!Object.hasOwn(item,'private_address'));}});
 const invalid=await read('/api/listings?view=map&south=91&west=-180&north=80&east=180');
 check('Invalid map bounds are rejected by the real endpoint',()=>assert.equal(invalid.status,400));
 const dates=await read('/api/listings?view=map&'+bounds+'&startDate=2010-01-01&endDate=2010-01-02');
 check('Past date searches are rejected',()=>assert.equal(dates.status,400));
 const prices=await read('/api/listings?view=map&'+bounds+'&minPrice=1');
 check('Map price filters require a currency',()=>assert.equal(prices.status,400));
 const place=await read('/api/listings?view=places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'Nairobi, Kenya'})});
 check('Genuine place lookup returns server-sourced Nairobi',()=>{assert.equal(place.status,200);assert.ok(place.data.items.some(item=>item.country==='KE'&&item.label.includes('Nairobi')));});
 const selected=place.data.items.find(item=>item.country==='KE'&&item.label.includes('Nairobi'));
 const restore=await read('/api/listings?view=places&id='+selected.id);
 check('Selected real place can be restored from its stable reference',()=>{assert.equal(restore.status,200);assert.deepEqual(restore.data.item,selected);});
 const nearby=await read('/api/nearby',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:selected.latitude,longitude:selected.longitude,radiusKm:10})});
 check('Nearby PostGIS search works for the actual selected place',()=>{assert.equal(nearby.status,200);assert.ok(Array.isArray(nearby.data.items));assert.equal(typeof nearby.data.hasMore,'boolean');});
 const config=await read('/api/config');const supabase=config.data.supabase;const headers={apikey:supabase.publishableKey,'Content-Type':'application/json'};
 for(const field of ['location_geom','location_place_id']){const response=await fetch(supabase.url+'/rest/v1/lockd_listings?select='+field+'&limit=1',{headers});check('Public cannot read private listing column '+field,()=>assert.ok([401,403].includes(response.status)));}
 for(const table of ['lockd_listing_private_locations','lockd_place_search_cache','lockd_geocoding_budget']){const response=await fetch(supabase.url+'/rest/v1/'+table+'?select=*&limit=1',{headers});check('Public cannot read '+table,()=>assert.ok([401,403].includes(response.status)));}
 const denied=await fetch(supabase.url+'/functions/v1/lockd-places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'Nairobi, Kenya'})});
 check('Place function denies requests without the project key',()=>assert.equal(denied.status,401));
 console.log(`${passed} live checks passed. Publication, booking and marker interactions require genuine inventory and were not simulated.`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
