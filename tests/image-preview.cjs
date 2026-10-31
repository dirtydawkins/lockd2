// Isolated visual fixtures, never production inventory. No accounts or payments.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const rows = [
  ['play','QA — PlayStation photo','playstation5-setup.jpeg'],
  ['phone','QA — Phone photo','iphone-pro-burgundy.jpeg'],
  ['laptop','QA — Computer photo','gaming-pc-purple-rgb.jpeg'],
  ['drive','QA — Vehicle photo','tesla-electric-sedan.jpeg'],
  ['stay','QA — Apartment photo','stay-loft-apartment.jpeg'],
].map(([category,title,photo],index)=>({
  id:`11111111-1111-4111-8111-${String(index+1).padStart(12,'0')}`,
  slug:`qa-image-${index}`,title,category,market_category:category,
  images:[`/assets/photos/${photo}`,'/assets/photos/gaming-pc-white-liquid-cooled.jpeg'],
  image_alt:title,summary:'Local visual fixture. Not a real rental.',description:'Synthetic record for image testing only.',
  price_amount:100,currency:'KES',price_unit:'day',location_label:'Local QA',
  requires_approval:true,checkout_enabled:false,listing_status:'published',approval_status:'approved',
  attributes:{brand:'QA',model:'Image layout test',condition:'good',image_presentation:[{focal_x:50,focal_y:50}]},
}));
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:8772');
  const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/api/config')return json({auth:{configured:false},bookingRequestsEnabled:false});
  if(url.pathname==='/image-lab.html') {
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
    return res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private component image QA</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/account.css"><link rel="stylesheet" href="/owners-market.css"><link rel="stylesheet" href="/image-presentation.css"><script src="/image-assets.js" defer></script><script src="/image-presentation.js" defer></script></head><body><main class="section-shell" style="padding-block:2rem"><h1 style="font-size:2rem">LOCAL COMPONENT QA</h1><p>Visual fixtures only. No authenticated account or real listing.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:1rem"><article class="account-saved-card" data-category="phone"><img src="/assets/photos/iphone-pro-burgundy.jpeg" alt="Supplied phone photo"><div class="account-saved-copy"><h2 style="font-size:1.3rem">Saved card</h2></div></article><article class="owner-listing-card" data-category="drive"><img src="/assets/photos/tesla-electric-sedan.jpeg" alt="Supplied car photo"><div class="owner-listing-card-copy">Owner card</div></article><div class="owner-photo"><img src="/assets/photos/gaming-pc-purple-rgb.jpeg" alt="Supplied computer photo"><p>Upload preview</p></div><div class="owner-preview-content"><img src="/assets/photos/playstation5-setup.jpeg" alt="Supplied console photo"><p>Listing preview</p></div></div></main></body></html>`);
  }
  if(url.pathname==='/api/listings') {
    if(url.searchParams.has('slug'))return json({item:rows.find(r=>r.slug===url.searchParams.get('slug'))});
    let items=rows;
    if(url.searchParams.get('market')==='tech') items=items.filter(r=>!['drive','stay'].includes(r.category));
    if(url.searchParams.get('category'))items=items.filter(r=>r.category===url.searchParams.get('category'));
    return json({items,total:items.length,hasMore:false});
  }
  if(url.pathname.startsWith('/api/'))return json({message:'Unavailable in visual QA.'},503);
  const rel=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1));
  const file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)||rel.startsWith('tests/')||!['.html','.js','.css','.svg','.jpeg','.webp','.png'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  try {
    let data=await fs.readFile(file);
    if(path.extname(file)==='.html')data=Buffer.from(data.toString().replace('<main ', '<aside role="note" style="padding:.5rem 1rem;background:#541d28;color:#fff;font:12px/1.5 sans-serif">LOCAL IMAGE QA — synthetic records, no real rentals or payments.</aside><main '));
    res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.jpeg':'image/jpeg','.webp':'image/webp','.png':'image/png'}[path.extname(file)],'Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end();}
}).listen(8772,'127.0.0.1',()=>console.log('Image QA: http://127.0.0.1:8772/tech.html'));
