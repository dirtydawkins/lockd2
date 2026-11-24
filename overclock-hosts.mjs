const account = window.LockdAccount;
const form = document.querySelector('#host-form');
const specs = form.elements.specs;
const list = document.querySelector('#host-list');
const status = document.querySelector('#host-status');
const signin = document.querySelector('#host-signin');
const draftKey = 'lockd:pc-report';
let generation = 0;

if (location.hash.startsWith('#pc-specs=')) {
  const report = new URLSearchParams(location.hash.slice(1)).get('pc-specs') || '';
  specs.value = report.slice(0, 1000);
  try { sessionStorage.setItem(draftKey, specs.value); } catch {}
  history.replaceState(null, '', location.pathname + location.search + '#list-pc');
  document.querySelector('#list-pc').scrollIntoView();
} else {
  try { specs.value = sessionStorage.getItem(draftKey) || ''; } catch {}
}

async function refresh() {
  const current = ++generation;
  form.hidden = signin.hidden = true;
  list.replaceChildren();
  try {
    const session = await account.getSession();
    if (current !== generation) return;
    if (!session?.user) { signin.hidden = false; return; }
    form.hidden = false;
    const rows = await account.listComputers();
    if (current !== generation) return;
    for (const pc of rows) {
      const details = document.createElement('details');
      const name = document.createElement('summary');
      name.textContent = pc.name;
      const report = document.createElement('p');
      report.className = 'pc-report';
      report.textContent = pc.reported_specs;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-button';
      remove.textContent = 'Remove registration';
      remove.onclick = async () => {
        if (!confirm('Remove this PC from your registered computers?')) return;
        remove.disabled = true;
        try { await account.removeComputer(pc.id); await refresh(); }
        catch { status.textContent = 'Couldn’t remove the PC. Try again.'; remove.disabled = false; }
      };
      details.append(name, report, remove);
      list.append(details);
    }
  } catch { if (current === generation) status.textContent = 'Couldn’t load your computers. Reload to try again.'; }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const current = generation;
  const submit = form.querySelector('button[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  status.textContent = 'Saving…';
  try {
    await account.registerComputer(form.elements.pcName.value.trim(), specs.value.trim());
    if (generation !== current) return;
    try { sessionStorage.removeItem(draftKey); } catch {}
    form.reset();
    status.textContent = 'PC registered. Remote rentals require a separate host check.';
    await refresh();
  } catch { if (current === generation) status.textContent = 'Couldn’t save this PC. Check your details and try again.'; }
  finally { submit.disabled = false; }
});
window.addEventListener('lockd:auth-change', () => { status.textContent = ''; void refresh(); });
void refresh();
