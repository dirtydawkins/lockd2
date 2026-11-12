(() => {
  const menu = document.querySelector('.site-account-menu');
  if (!menu) return;
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
