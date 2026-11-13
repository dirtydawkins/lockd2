(() => {
  const menu = document.querySelector('.site-account-menu');
  if (!menu) return;
  const primary = document.querySelector('#primary-nav');
  const primaryAction = document.querySelector('.header-cta');
  if (primary && primaryAction) {
    const target = new URL(primaryAction.href, location.href);
    for (const link of primary.querySelectorAll('a')) {
      const destination = new URL(link.href, location.href);
      if (destination.pathname === target.pathname && destination.search === target.search && destination.hash === target.hash) link.remove();
    }
  }
  if (primary && document.querySelector('.menu-toggle')) {
    const group = document.createElement('details');
    group.className = 'mobile-account-group';
    const label = document.createElement('summary');
    label.textContent = 'Account';
    group.append(label,menu.querySelector('nav').cloneNode(true));
    primary.querySelector('.mobile-settings-link')?.remove();
    primary.querySelector('a[href="account.html"]')?.remove();
    primary.append(group);
  }
  function updateAccountLinks(listing) {
    const mode = listing ? 'listing' : 'renting';
    for (const link of document.querySelectorAll('[data-account-messages]')) {
      link.href = 'messages.html?inbox=' + mode;
    }
    for (const link of document.querySelectorAll('[data-switch-workspace]')) {
      link.href = listing ? 'account.html#overview' : 'owners.html';
      link.textContent = listing ? 'Switch to renting' : 'Switch to listing';
    }
    for (const link of document.querySelectorAll('[data-settings-section]')) {
      link.href = (listing ? 'account.html?view=listing#' : 'account.html#') + link.dataset.settingsSection;
    }
    for (const link of document.querySelectorAll('a.mobile-settings-link')) {
      link.href = listing ? 'settings.html?view=listing' : 'settings.html';
    }
    const settingsHome = document.querySelector('[data-settings-home]');
    if (settingsHome) settingsHome.href = listing ? 'settings.html?view=listing' : 'settings.html';
    const settingsAccount = document.querySelector('[data-settings-account]');
    if (settingsAccount) settingsAccount.href = listing ? 'owners.html#owner-workspace' : 'account.html#overview';
    for (const shortcuts of document.querySelectorAll('[aria-label="Account shortcuts"]')) {
      const account = shortcuts.querySelector('a:first-child');
      if (account) {
        account.href = listing ? 'owners.html#owner-workspace' : 'account.html#overview';
      }
      const settings = shortcuts.querySelector('a[href^="settings.html"]');
      if (settings) settings.href = listing ? 'settings.html?view=listing' : 'settings.html';
    }
    for (const reservations of document.querySelectorAll('[aria-label="Account shortcuts"] a[href*="#bookings"]')) {
      reservations.href = listing ? 'account.html?view=listing#bookings' : 'account.html#bookings';
      reservations.textContent = listing ? 'Booking requests' : 'My reservations';
    }
  }
  const params = new URLSearchParams(location.search);
  updateAccountLinks(location.pathname.endsWith('/owners.html') || params.get('inbox') === 'listing' || params.get('view') === 'listing');
  document.addEventListener('lockd:workspace', event => updateAccountLinks(event.detail === 'listing'));
  const trigger = menu.querySelector('summary');
  document.addEventListener('pointerdown', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('focusin', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      trigger.focus();
      event.stopPropagation();
    }
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('a')) menu.open = false;
  });
})();
