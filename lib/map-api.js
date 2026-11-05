const configuration=require('../api/supabase-config');
const {categories,isDate}=require('./discovery-input');
const {signImages}=require('../api/listing-images');
module.exports=async function mapSearch(req,res){
 const send=(code,data)=>{res.setHeader('Cache-Control','no-store');return res.status(code).json(data);};
 if(req.method!=='GET')return send(405,{message:'Use search to explore the map.'});
 const q=req.query||{},bounds=['south','west','north','east'].map(key=>typeof q[key]==='string'&&q[key].trim()?Number(q[key]):NaN);
 const [south,west,north,east]=bounds;
 if(bounds.some(n=>!Number.isFinite(n))||south< -90||north>90||south>=north||Math.abs(west)>180||Math.abs(east)>180||west===east)return send(400,{message:'Choose an area on the map.'});
 const category=q.category||'',term=q.q||'',page=Number(q.page||0),quantity=Number(q.quantity||1),guests=q.guests?Number(q.guests):null;
 const min=q.minPrice?Number(q.minPrice):null,max=q.maxPrice?Number(q.maxPrice):null,currency=q.currency||'',start=q.startDate||'',end=q.endDate||'';
 if((category&&!categories.has(category))||typeof term!=='string'||term.length>100||!Number.isInteger(page)||page<0||page>1000)return send(400,{message:'Check your search filters.'});
 if([min,max].some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100000000))||(min!==null&&max!==null&&min>max)||((min!==null||max!==null)&&!currency)||(currency&&!['KES','USD','EUR'].includes(currency)))return send(400,{message:'Choose a currency and valid price range.'});
 if(!Number.isInteger(quantity)||quantity<1||quantity>20||(guests!==null&&(!Number.isInteger(guests)||guests<1||guests>30)))return send(400,{message:'Check the quantity or guest count.'});
 if((start||end)&&(!isDate(start)||!isDate(end)||start<new Date().toISOString().slice(0,10)||end<=start||(Date.parse(end)-Date.parse(start))/86400000>366))return send(400,{message:'Choose a valid start and return date.'});
 if(start&&(north-south>20||(west<east?east-west:360-west+east)>20))return send(400,{message:'Zoom in to check your dates.'});
 const config=configuration();if(!config)return send(503,{message:'Map results are unavailable right now.'});
 try{
  const response=await fetch(config.url+'/rest/v1/rpc/search_lockd_map_listings',{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({p_south:south,p_west:west,p_north:north,p_east:east,p_category:category||null,p_q:term,p_min_price:min,p_max_price:max,p_currency:currency||null,p_start_date:start||null,p_end_date:end||null,p_quantity:quantity,p_guests:guests,p_page:page}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok||!Array.isArray(result.items))throw Error();
  const points=result.items;if(!points.length)return send(200,{items:[],hasMore:false,total:Number(result.total)||0,availabilityVerified:Boolean(start)});
  const ids=points.map(p=>p.listing_id).filter(id=>/^[0-9a-f-]{36}$/i.test(id));
  const params=new URLSearchParams({select:'id,slug,title,category,market_category,images,image_alt,location_label,price_amount,currency,price_unit,attributes,requires_approval,checkout_enabled',id:'in.('+ids.join(',')+')',listing_status:'eq.published',approval_status:'eq.approved'});
  const recordsResponse=await fetch(config.url+'/rest/v1/lockd_listings?'+params,{headers:config.headers,signal:AbortSignal.timeout(10000)});
  const records=await recordsResponse.json();if(!recordsResponse.ok||!Array.isArray(records))throw Error();
  const covers=await signImages(config,records.map(row=>row.images?.[0]));
  const byId=new Map(records.map((row,index)=>[row.id,{...row,images:[covers[index]].filter(Boolean)}]));
  const items=points.map(point=>{const row=byId.get(point.listing_id);return row?{...row,latitude:Number(point.latitude),longitude:Number(point.longitude)}:null;});
  return send(200,{items:items.filter(Boolean),hasMore:result.hasMore===true,total:Number(result.total)||0,availabilityVerified:Boolean(start)});
 }catch{return send(502,{message:'The map results could not be loaded. Please try again.'});}
};
