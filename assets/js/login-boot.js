/* Login page boot. Loaded synchronously in <head>, before Firebase.
 *
 * Firebase + App Check take a moment to download. Without this, a submit in
 * that window fell through to a native form submit, which just reloaded the
 * page, so people had to log in two or three times. Here every submit is
 * captured immediately; if Firebase isn't ready yet it is queued and run as
 * soon as the page's module calls ntcLogin.ready(handler).
 *
 * It also owns the full-screen "launch" screen shown from the moment Login is
 * pressed until the dashboard replaces the page (ntcLogin.stage() moves it
 * through its steps). Dashboards show the same screen while they load, so
 * signing in reads as one continuous transition.
 */
(function () {
  'use strict';
  var WAIT_MS = 20000;
  var state = window.ntcLogin = { handler: null, queued: null, timer: 0 };
  var STEPS = ['Signing you in', 'Checking your profile', 'Opening your dashboard'];

  var launch = null, stepTimer = 0, previousOverflow, returnFocus, loginContent;

  function buildLaunch() {
    if (launch) return launch;
    var role = document.body.getAttribute('data-login') || 'student';
    launch = document.createElement('div');
    launch.className = 'ntc-launch';
    launch.setAttribute('aria-hidden', 'true');
    launch.innerHTML =
      '<div class="ntc-launch-brand"><span class="ntc-auth-brand-icon" aria-hidden="true">✧</span>THE NEWTOWN CLASSES</div>' +
      '<div class="ntc-launch-in"><div class="ntc-auth-kicker"></div>' +
      '<div class="ntc-launch-mark" aria-hidden="true"><i class="ntc-auth-satellite"></i><span class="ntc-launch-icon">' +
      '<svg viewBox="0 0 48 48" fill="none"><path d="m24 6 5 13 13 5-13 5-5 13-5-13L6 24l13-5Z" fill="currentColor"/>' +
      '<path d="M38 5v8m-4-4h8M8 35v6m-3-3h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>' +
      '<h2 class="ntc-launch-title"></h2><p class="ntc-launch-step" role="status" aria-live="polite" aria-atomic="true"></p>' +
      '<div class="ntc-launch-dots" aria-hidden="true"><i>Sign in</i><i>Your profile</i><i>All set</i></div></div>' +
      '<div class="ntc-auth-foot">A little closer to your next big idea.</div>';
    launch.querySelector('.ntc-auth-kicker').textContent =
      role === 'admin' ? 'Admin portal' : role === 'teacher' ? 'Teacher portal' : 'Student portal';
    launch.querySelector('.ntc-launch-title').textContent =
      role === 'admin' ? 'Command Center' : role === 'teacher' ? 'Teacher Studio' : 'Your Learning Space';
    document.body.appendChild(launch);
    return launch;
  }

  // Move the launch screen to step n (0–2), with an optional custom message.
  function stage(n, text) {
    var el = buildLaunch();
    clearTimeout(stepTimer);
    if (!el.classList.contains('on')) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      returnFocus = document.activeElement;
      // Dismiss the phone keyboard before the full-screen transition opens.
      if (returnFocus && returnFocus.blur) returnFocus.blur();
      loginContent = document.querySelector('.login-wrapper');
      if (loginContent) { loginContent.dataset.ntcWasInert = String(loginContent.inert); loginContent.inert = true; }
    }
    el.removeAttribute('aria-hidden');
    var step = el.querySelector('.ntc-launch-step');
    var label = (text || STEPS[n] || STEPS[0]) + '…';
    if (step.textContent !== label) {
      step.classList.add('swap');
      stepTimer = setTimeout(function () { step.textContent = label; step.classList.remove('swap'); }, step.textContent ? 140 : 0);
    } else step.classList.remove('swap');
    var dots = el.querySelectorAll('.ntc-launch-dots i');
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = i < n ? 'done' : i === n ? 'now' : '';
    }
    el.offsetWidth; // let the fade-in start from opacity 0
    el.classList.add('on');
  }

  function hideLaunch() {
    clearTimeout(stepTimer);
    if (launch && launch.classList.contains('on')) {
      launch.classList.remove('on');
      launch.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = previousOverflow;
      if (loginContent) { loginContent.inert = loginContent.dataset.ntcWasInert === 'true'; delete loginContent.dataset.ntcWasInert; }
      if (returnFocus && returnFocus.focus && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
    }
  }

  function setBusy(form, busy) {
    var btn = form.querySelector('.login-btn');
    if (btn) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = busy;
      btn.textContent = busy ? 'Signing in…' : btn.dataset.label;
    }
    if (busy) stage(0); else hideLaunch();
  }

  function showError(form, msg) {
    var el = form.querySelector('.login-error');
    if (el) el.textContent = msg;
    if (!msg) return;
    hideLaunch();
    var card = form.closest('.login-card') || form;
    card.classList.remove('ntc-shake');
    card.offsetWidth;
    card.classList.add('ntc-shake');
    if (navigator.vibrate && !matchMedia('(prefers-reduced-motion: reduce)').matches) { try { navigator.vibrate(40); } catch (_) {} }
  }

  state.setBusy = setBusy;
  state.showError = showError;
  state.stage = stage;
  state.hide = hideLaunch;

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
    if (navigator.onLine === false) {
      showError(form, "You're offline. Connect to the internet and try again.");
      return;
    }
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
  // empty form (or a stuck launch screen) and thought they had been logged
  // out. Reload so the page's "already signed in?" check runs again.
  // Arriving from a portal's "Sign out": confirm it worked.
  function signedOutNote() {
    var flag = null;
    try { flag = sessionStorage.getItem('ntc:signed-out'); sessionStorage.removeItem('ntc:signed-out'); } catch (_) {}
    if (!flag) return;
    var toast = document.createElement('div');
    toast.className = 'ntc-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = "You've signed out. See you soon!";
    document.body.appendChild(toast);
    requestAnimationFrame(function () { requestAnimationFrame(function () { toast.classList.add('on'); }); });
    setTimeout(function () { toast.classList.remove('on'); setTimeout(function () { toast.remove(); }, 400); }, 3200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', signedOutNote); else signedOutNote();

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
