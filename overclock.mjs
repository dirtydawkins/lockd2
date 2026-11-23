const account = window.LockdAccount;
const form = document.querySelector('#pilot-form');
const signIn = document.querySelector('#pilot-signin');
const retry = document.querySelector('#pilot-retry');
const withdraw = document.querySelector('#pilot-withdraw');
const track = document.querySelector('#pilot-track');
const submit = form.querySelector('[type=submit]');
const status = document.querySelector('#pilot-status');

let saved = null;
let accountId = null;
let revision = 0;
let busy = false;

async function request(method, expectedId, body) {
  const session = await account.getSession();
  if (session?.user?.id !== expectedId) throw new Error('Your account changed. Reload to continue.');
  const response = await fetch('/api/bookings?view=overclock-pilot', {
    method,
    headers: { Authorization: 'Bearer ' + session.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(12000)
  }).catch(() => { throw new Error('Couldn’t reach LOCKD. Try again.'); });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.message || 'Pilot requests are unavailable right now.');
    error.status = response.status;
    throw error;
  }
  return result.item;
}

function renderRequest(item, message) {
  saved = item;
  track.value = saved?.track || 'studio';
  submit.textContent = saved ? 'Save preference' : 'Request access';
  withdraw.hidden = !saved;
  form.hidden = false;
  status.textContent = message;
}

async function load() {
  const current = ++revision;
  form.hidden = signIn.hidden = retry.hidden = true;
  status.textContent = 'Checking your account…';
  try {
    const session = await account.getSession();
    if (current !== revision) return;
    accountId = session?.user?.id || null;
    if (!accountId) {
      status.textContent = '';
      signIn.hidden = false;
      return;
    }
    const item = await request('GET', accountId);
    if (current === revision) renderRequest(item, item ? 'Your pilot request is saved.' : '');
  } catch (error) {
    if (current !== revision) return;
    status.textContent = error.message || 'We couldn’t load your request.';
    signIn.hidden = error.status !== 401;
    retry.hidden = error.status === 401;
  }
}

async function change(method) {
  if (busy) return;
  busy = true;
  const current = revision;
  submit.disabled = withdraw.disabled = track.disabled = true;
  status.textContent = method === 'DELETE' ? 'Withdrawing…' : 'Saving…';
  try {
    const item = await request(method, accountId, method === 'POST' ? { track: track.value } : undefined);
    if (current === revision) renderRequest(item, item ? 'Your pilot request is saved.' : 'Your request was withdrawn.');
  } catch (error) {
    if (current === revision) status.textContent = error.message || 'Please try again.';
  } finally {
    busy = false;
    submit.disabled = withdraw.disabled = track.disabled = false;
  }
}

form.addEventListener('submit', event => { event.preventDefault(); void change('POST'); });
withdraw.addEventListener('click', () => void change('DELETE'));
retry.addEventListener('click', () => void load());
window.addEventListener('lockd:auth-change', event => {
  if ((event.detail?.user?.id || null) !== accountId) void load();
});
void load();
