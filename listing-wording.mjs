// An optional editor within the existing listing form. Never submits the form.
export function attachWording(form, anchor) {
  const field = name => form.querySelector('#listing-' + name);
  const description = field('description'), intro = field('summary');
  const allowed = new Set('property_type room_type max_guests bedrooms beds bathrooms amenities brand model year vehicle_type seating_capacity transmission fuel_type service_mode product_type condition specifications included_accessories duration capacity included_services excluded_services'.split(' '));
  const context = () => {
    const facts = {};
    for (const el of form.querySelectorAll('[data-attribute]')) {
      if (allowed.has(el.dataset.attribute) && el.value.trim()) facts[el.dataset.attribute] = el.value.trim();
    }
    return { category: field('category').value, title: field('title').value, summary: intro.value, description: description.value, facts };
  };
  const box = document.createElement('div');
  box.className = 'listing-wording';
  box.innerHTML = '<button type="button" class="owner-text-link" data-suggest>Suggest wording</button><span class="owner-help">Uses AI and the public details you enter.</span><p role="status"></p><section hidden aria-label="Suggested wording"><h5>Suggested introduction</h5><p data-intro></p><h5>Suggested description</h5><p data-description></p><div><button type="button" class="button button-dark" data-apply>Use this wording</button> <button type="button" class="owner-text-link" data-dismiss>Dismiss</button></div></section><button hidden type="button" class="owner-text-link" data-undo>Undo</button>';
  anchor.after(box);
  const find = selector => box.querySelector(selector);
  const suggest = find('[data-suggest]'), preview = find('section'), status = find('[role="status"]'), undo = find('[data-undo]');
  let pending, original, proposed, stamp;
  const version = () => JSON.stringify([field('id').value, context()]);
  function clear() {
    pending?.abort(); pending = null; proposed = original = null; stamp = '';
    suggest.disabled = false; preview.hidden = undo.hidden = true; status.textContent = '';
  }
  form.addEventListener('input', clear);
  form.addEventListener('change', clear);
  form.addEventListener('reset', clear);
  window.addEventListener('lockd:listing-restored', clear);
  document.querySelector('#owner-signout')?.addEventListener('click', clear);
  suggest.addEventListener('click', async () => {
    clear();
    const data = context();
    if (!Object.keys(data.facts).length && (data.description + data.summary).trim().length < 12) {
      status.textContent = 'Add a few notes about what renters get, or fill in the details below.';
      description.focus(); return;
    }
    const controller = new AbortController();
    pending = controller; stamp = version(); suggest.disabled = true; status.textContent = 'Drafting a suggestion…';
    try {
      const session = await window.LockdAccount.getSession();
      if (controller.signal.aborted) return;
      if (!session?.access_token) throw new Error('Sign in again before requesting wording.');
      const res = await fetch('/api/owner-listings?view=wording', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Suggestions are unavailable. You can still write your listing.');
      if (controller.signal.aborted || stamp !== version()) return;
      proposed = result;
      find('[data-intro]').textContent = result.summary;
      find('[data-description]').textContent = result.description;
      preview.hidden = false; status.textContent = 'Check the details before using this wording.';
    } catch (e) {
      if (!controller.signal.aborted) status.textContent = e instanceof TypeError || e instanceof SyntaxError ? 'Couldn’t reach suggestions. You can keep writing.' : e.message;
    } finally {
      if (pending === controller) { pending = null; suggest.disabled = false; }
    }
  });
  function setCopy(value) {
    intro.value = value.summary; description.value = value.description;
    description.dispatchEvent(new Event('input', { bubbles: true }));
  }
  find('[data-dismiss]').addEventListener('click', () => { clear(); suggest.focus(); });
  find('[data-apply]').addEventListener('click', () => {
    if (!proposed || stamp !== version()) { clear(); return; }
    const before = { summary: intro.value, description: description.value };
    setCopy(proposed); original = before; stamp = version(); undo.hidden = false;
    status.textContent = 'Wording added. You can still edit it.'; undo.focus();
  });
  undo.addEventListener('click', () => {
    if (original && stamp === version()) setCopy(original);
    clear(); status.textContent = 'Original wording restored.'; description.focus();
  });
}
