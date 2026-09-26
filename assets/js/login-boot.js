/* Login page boot. Loaded synchronously in <head>, before Firebase.
 *
 * Firebase + App Check take a moment to download. Without this, a submit in
 * that window fell through to a native form submit, which just reloaded the
 * page, so people had to log in two or three times. Here every submit is
 * captured immediately; if Firebase isn't ready yet it is queued and run as
 * soon as the page's module calls ntcLogin.ready(handler).
 */
(function () {
  'use strict';
  var WAIT_MS = 20000;
  var state = window.ntcLogin = { handler: null, queued: null, timer: 0 };

  function setBusy(form, busy) {
    var btn = form.querySelector('.login-btn');
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = busy;
    btn.textContent = busy ? 'Signing in…' : btn.dataset.label;
  }

  function showError(form, msg) {
    var el = form.querySelector('.login-error');
    if (el) el.textContent = msg;
  }

  state.setBusy = setBusy;
  state.showError = showError;

  state.ready = function (handler) {
    state.handler = handler;
    var form = state.queued;
    if (!form) return;
    state.queued = null;
    clearTimeout(state.timer);
    handler(form);
  };

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains('login-form')) return;
    e.preventDefault();
    if (state.handler) { state.handler(form); return; }
    if (state.queued) return;
    state.queued = form;
    showError(form, '');
    setBusy(form, true);
    state.timer = setTimeout(function () {
      if (state.queued !== form) return;
      state.queued = null;
      setBusy(form, false);
      showError(form, 'Still connecting. Check your internet connection and try again.');
    }, WAIT_MS);
  });

  // Pressing Back into a login page can restore it from the browser's
  // back/forward cache without running any scripts, so a signed-in user saw an
  // empty form and thought they had been logged out. Reload so the page's
  // "already signed in? go to the dashboard" check runs again.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.location.reload();
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.toggle-password');
    if (!btn) return;
    var input = btn.parentNode.querySelector('input');
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
})();
