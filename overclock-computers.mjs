const message = document.querySelector('#pc-search-status');
const results = document.querySelector('#pc-search-results');
const near = document.querySelector('#pc-nearby');
let revision = 0;

function savedArea() {
  try {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('lockd_area='));
    const area = cookie && JSON.parse(decodeURIComponent(cookie.slice(11)));
    if (area?.anywhere) return '';
    return area?.id || localStorage.getItem('lockd:selected-place:v1') || '';
  } catch { return ''; }
}

async function json(path, options) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error();
  return response.json();
}

async function browse(coords, current) {
  try {
    const data = coords ? await json('/api/nearby', { method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({category:'laptop', latitude:coords.latitude, longitude:coords.longitude, radiusKm:100}) })
      : await json('/api/listings?category=laptop');
    if (current !== revision) return;
    const fragment = document.createDocumentFragment();
    for (const pc of data.items.slice(0,6)) {
      const link = document.createElement('a');
      const url = new URL('rental.html', location.href);
      url.searchParams.set('slug',pc.slug);
      url.searchParams.set('returnTo','/overclock.html#computers');
      link.href = url.href;
      const title = document.createElement('strong');
      title.textContent = pc.title;
      const facts = document.createElement('span');
      facts.textContent = [pc.attributes?.specifications,pc.location_label,
        coords && Number.isFinite(pc.distance_km) ? pc.distance_km.toFixed(1)+' km' : '',
        pc.price_amount != null ? pc.currency+' '+Number(pc.price_amount).toLocaleString()+' / '+pc.price_unit : ''].filter(Boolean).join(' · ');
      link.append(title,facts);
      fragment.append(link);
    }
    results.replaceChildren(fragment);
    message.textContent = data.items.length ? (coords ? 'Closest computers first.' : 'Recently listed computers.') :
      (coords ? 'No computer rentals within 100 km of this area.' : 'No computers listed for collection or delivery yet.');
  } catch { if (current === revision) { results.replaceChildren(); message.textContent = 'Computer listings couldn’t load. Try the full catalogue.'; } }
}

near.onclick = () => {
  const current = ++revision;
  if (!navigator.geolocation) { message.textContent = 'Location is unavailable. You can browse the full catalogue.'; return; }
  message.textContent = 'Finding computers near you…';
  navigator.geolocation.getCurrentPosition(position => {
    if (current === revision) void browse({latitude:+position.coords.latitude.toFixed(2),longitude:+position.coords.longitude.toFixed(2)},current);
  }, () => { if (current === revision) message.textContent = 'Location is unavailable. You can still browse computers.'; }, {timeout:8000,maximumAge:300000});
};

async function start() {
  const current = ++revision;
  const id = savedArea();
  let coords = null;
  if (/^[\da-f-]{36}$/i.test(id)) {
    try { coords = (await json('/api/listings?view=places&id='+encodeURIComponent(id))).item; } catch {}
  }
  if (current === revision) await browse(coords,current);
}
void start();
