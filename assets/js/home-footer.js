/* Start compact on phones; keep the native, keyboard-accessible disclosure controls. */
(() => {
  const groups = document.querySelectorAll('.site-footer .footer-group');
  const phone = window.matchMedia('(max-width: 600px)');
  const syncLayout = () => groups.forEach(group => { group.open = !phone.matches; });
  syncLayout();
  phone.addEventListener('change', syncLayout);
})();
