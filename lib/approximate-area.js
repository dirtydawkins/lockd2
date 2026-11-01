// Vercel supplies these headers. Do not collect/store the visitor's IP address.
module.exports = function approximateArea(req) {
  if (process.env.VERCEL !== '1') return null;
  const headers=req.headers||{},lat=headers['x-vercel-ip-latitude'],lng=headers['x-vercel-ip-longitude'];
  if(typeof lat!=='string'||typeof lng!=='string'||!lat.trim()||!lng.trim())return null;
  const latitude=Number(lat),longitude=Number(lng);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
  let city='';try{city=decodeURIComponent(headers['x-vercel-ip-city']||'').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,80);}catch{}
  const country=/^[A-Z]{2}$/.test(headers['x-vercel-ip-country']||'')?headers['x-vercel-ip-country']:'';
  return {latitude:Math.round(latitude*10)/10,longitude:Math.round(longitude*10)/10,label:city||country||'Your area',country};
};
