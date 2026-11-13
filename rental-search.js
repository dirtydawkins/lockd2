(() => {
  const natural = value => value.length >= 4 && value.length <= 240 && (
    value.trim().split(/\s+/).length >= 4 ||
    /\b(in|near|with|under|automatic|manual|electric|self.drive)\s+\S/i.test(value)
  );
  const pending = new WeakMap();
  async function interpret(form, fields, category, status, force = false) {
    pending.get(form)?.abort();
    const term = fields.q.value.trim();
    if (/\b(near me|nearby|around me)\b/i.test(term) && fields.location && !fields.location.value.trim()) {
      status.hidden = false;
      status.textContent = 'Choose a town or use your location to search nearby.';
      fields.location.focus();
      return false;
    }
    if (!natural(term) && !force) return true;
    const controller = new AbortController();
    pending.set(form, controller);
    const stop = () => controller.abort();
    const events = ['input', 'change', 'reset'];
    events.forEach(name => document.addEventListener(name, stop));
    window.addEventListener('popstate', stop);
    const before = location.href;
    status.hidden = false;
    status.textContent = 'Finding matches…';
    try {
      const response = await fetch('/api/listings?view=assist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term, category, intentOnly: true }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)])
      });
      if (!response.ok) throw Error();
      const { filters } = await response.json();
      if (controller.signal.aborted || before !== location.href) return false;
      for (const [key, value] of Object.entries(filters)) {
        const field = fields[key];
        if (['minPrice', 'maxPrice'].includes(key) && !fields.currency && filters.currency !== 'KES') continue;
        if (field && (key === 'q' || !field.value)) field.value = value;
      }
    } catch {
      if (controller.signal.aborted || before !== location.href) return false;
    } finally {
      events.forEach(name => document.removeEventListener(name, stop));
      window.removeEventListener('popstate', stop);
      if (pending.get(form) === controller) status.textContent = '';
    }
    return true;
  }
  window.LockdRentalSearch = { interpret, natural };
})();
