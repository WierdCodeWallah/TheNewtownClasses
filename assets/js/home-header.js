(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const menuButton = header.querySelector('.site-menu-toggle');
  const nav = header.querySelector('.site-nav');
  const loginButton = header.querySelector('.site-login-toggle');
  const logins = header.querySelector('.site-login-links');
  const desktop = matchMedia('(min-width: 1100px)');
  const setLogin = open => {
    loginButton.setAttribute('aria-expanded', String(open));
    logins.hidden = !open;
  };
  const setMenu = open => {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', `${open ? 'Close' : 'Open'} navigation menu`);
    nav.classList.toggle('is-open', open);
    if (!open) setLogin(false);
  };
  menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  loginButton.addEventListener('click', () => setLogin(logins.hidden));
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setMenu(false);
  });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!logins.hidden) { setLogin(false); loginButton.focus(); }
    else if (nav.classList.contains('is-open')) { setMenu(false); menuButton.focus(); }
  });
  header.addEventListener('focusout', event => {
    if (event.relatedTarget && !header.contains(event.relatedTarget)) setMenu(false);
  });
  desktop.addEventListener('change', () => {
    const wasInsideMenu = nav.contains(document.activeElement);
    setMenu(false);
    if (!desktop.matches && wasInsideMenu) menuButton.focus();
  });
})();
