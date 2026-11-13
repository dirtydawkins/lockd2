const field = document.querySelector('#catalogue-location, #tech-location, #room-location');
if (field) {
  const options = document.createElement('datalist');
  options.id = 'search-place-suggestions';
  field.setAttribute('list', options.id);
  const control = document.createElement('div');
  control.className = 'search-locality';
  const near = document.createElement('button');
  near.type = 'button';
  near.className = 'text-button';
  near.textContent = 'Use my location';
  const notice = document.createElement('span');
  notice.setAttribute('role', 'status');
  control.append(options, near, notice);
  const label = field.closest('label');
  const labelText = label.querySelector('span')?.textContent || label.childNodes[0]?.textContent || 'Location';
  if (!field.hasAttribute('aria-label')) field.setAttribute('aria-label', labelText.trim());
  label.append(control);
  let sequence = 0, timer, request;
  function cancel() {
    sequence++;
    clearTimeout(timer);
    request?.abort();
    near.disabled = false;
    options.replaceChildren();
    notice.textContent = '';
  }
  async function places(body) {
    request = new AbortController();
    const response = await fetch('/api/listings?view=places', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)])
    });
    if (!response.ok) throw Error();
    return (await response.json()).items || [];
  }
  field.addEventListener('input', () => {
    cancel();
    const query = field.value.trim();
    if (query.length < 3 || query.length > 80) return;
    const current = sequence;
    timer = setTimeout(async () => {
      try {
        const items = await places({query});
        if (current !== sequence) return;
        for (const item of items) {
          const option = document.createElement('option');
          option.value = item.label;
          options.append(option);
        }
      } catch { /* Manual location entry remains available. */ }
    }, 500);
  });
  field.form.addEventListener('reset', cancel);
  near.hidden = !navigator.geolocation;
  near.addEventListener('click', () => {
    cancel();
    const current = sequence;
    near.disabled = true;
    notice.textContent = 'Finding your area…';
    const fail = () => {
      if (sequence !== current) return;
      near.disabled = false;
      notice.textContent = 'Enter a town or neighbourhood instead.';
    };
    navigator.geolocation.getCurrentPosition(async ({coords}) => {
      if (sequence !== current) return;
      try {
        const items = await places({reverse:true, latitude:Math.round(coords.latitude*10)/10, longitude:Math.round(coords.longitude*10)/10});
        if (sequence !== current) return;
        if (!items[0]?.label) return fail();
        field.value = items[0].label;
        near.disabled = false;
        notice.textContent = field.value;
        field.dispatchEvent(new Event('change', {bubbles:true}));
      } catch { fail(); }
    }, fail, {enableHighAccuracy:false, timeout:8000, maximumAge:300000});
  });
}
