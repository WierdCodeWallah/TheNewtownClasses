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

  var CSS =
    '.ntc-launch{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;' +
      'background:radial-gradient(120% 80% at 50% 0%,#3d3576 0%,#25214c 45%,#15132b 100%);color:#f1eefc;' +
      'font-family:"DM Sans",system-ui,-apple-system,sans-serif;opacity:0;visibility:hidden;' +
      'transition:opacity .22s ease,visibility 0s linear .22s;-webkit-tap-highlight-color:transparent}' +
    '.ntc-launch.on{opacity:1;visibility:visible;transition:opacity .22s ease}' +
    '.ntc-launch-in{display:flex;flex-direction:column;align-items:center;gap:22px;padding:24px;text-align:center;' +
      'transform:translateY(8px) scale(.98);transition:transform .35s cubic-bezier(.2,.8,.2,1)}' +
    '.ntc-launch.on .ntc-launch-in{transform:none}' +
    '.ntc-launch-mark{position:relative;width:96px;height:96px;display:grid;place-items:center}' +
    '.ntc-launch-mark::before{content:"";position:absolute;inset:0;border-radius:50%;' +
      'background:conic-gradient(from 0deg,transparent 0 25%,#a78bfa 60%,#b5eae6 85%,transparent);' +
      '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));' +
      'mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));' +
      'animation:ntc-launch-spin 1s linear infinite}' +
    '.ntc-launch-mark::after{content:"";position:absolute;inset:14px;border-radius:50%;background:#ffffff0d;' +
      'box-shadow:0 0 0 1px #ffffff14,0 0 40px #a78bfa40;animation:ntc-launch-pulse 1.8s ease-in-out infinite}' +
    '.ntc-launch-icon{position:relative;z-index:1;font-size:34px;line-height:1}' +
    '.ntc-launch-title{font:700 20px/1.2 Syne,"DM Sans",system-ui,sans-serif;letter-spacing:-.3px}' +
    '.ntc-launch-step{min-height:20px;font-size:14px;color:#c4bee6;transition:opacity .18s ease}' +
    '.ntc-launch-step.swap{opacity:0}' +
    '.ntc-launch-dots{display:flex;gap:8px}' +
    '.ntc-launch-dots i{width:28px;height:4px;border-radius:4px;background:#ffffff1f;overflow:hidden;position:relative}' +
    '.ntc-launch-dots i::after{content:"";position:absolute;inset:0;background:#b5eae6;transform:scaleX(0);' +
      'transform-origin:left;transition:transform .45s cubic-bezier(.2,.8,.2,1)}' +
    '.ntc-launch-dots i.done::after{transform:none}' +
    '.ntc-launch-dots i.now::after{animation:ntc-launch-fill 1.6s ease-in-out infinite}' +
    '.ntc-launch-brand{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));left:0;right:0;' +
      'text-align:center;font-size:11px;letter-spacing:2px;color:#8d87b5}' +
    '@keyframes ntc-launch-spin{to{transform:rotate(360deg)}}' +
    '@keyframes ntc-launch-pulse{50%{transform:scale(1.06);opacity:.75}}' +
    '@keyframes ntc-launch-fill{0%{transform:scaleX(0)}60%{transform:scaleX(.85)}100%{transform:scaleX(.85);opacity:.4}}' +
    '@keyframes ntc-shake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}' +
    '.ntc-shake{animation:ntc-shake .38s ease}' +
    '.ntc-toast{position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));z-index:2147482500;transform:translate(-50%,-140%);' +
      'background:#25214c;color:#f1eefc;padding:12px 18px;border-radius:999px;font:500 14px "DM Sans",system-ui,sans-serif;' +
      'box-shadow:0 12px 30px #120f2440;transition:transform .35s cubic-bezier(.2,.8,.2,1);white-space:nowrap}' +
    '.ntc-toast.on{transform:translate(-50%,0)}' +
    '@media(prefers-reduced-motion:reduce){.ntc-launch-mark::before{animation-duration:2.4s}' +
      '.ntc-launch-mark::after,.ntc-launch-dots i.now::after,.ntc-shake{animation:none}}' +
    // App feel: no double-tap zoom on buttons, and 16px inputs so iOS doesn't zoom in on focus.
    'body[data-login] button,body[data-login] a{touch-action:manipulation}' +
    '@media(max-width:768px){body[data-login] .form-field input,body[data-login] .form-field select{font-size:16px!important}}' +
    '@view-transition{navigation:auto}';

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var launch = null, stepIndex = 0;

  function buildLaunch() {
    if (launch) return launch;
    var role = document.body.getAttribute('data-login') || 'student';
    var icon = (document.querySelector('.login-icon') || {}).textContent || (role === 'admin' ? '🛡️' : role === 'teacher' ? '👨‍🏫' : '🎓');
    launch = document.createElement('div');
    launch.className = 'ntc-launch';
    launch.setAttribute('role', 'status');
    launch.setAttribute('aria-live', 'polite');
    launch.innerHTML =
      '<div class="ntc-launch-in"><div class="ntc-launch-mark"><span class="ntc-launch-icon" aria-hidden="true"></span></div>' +
      '<div class="ntc-launch-title"></div><div class="ntc-launch-step"></div>' +
      '<div class="ntc-launch-dots" aria-hidden="true"><i></i><i></i><i></i></div></div>' +
      '<div class="ntc-launch-brand">THE NEWTOWN CLASSES</div>';
    launch.querySelector('.ntc-launch-icon').textContent = icon.trim();
    launch.querySelector('.ntc-launch-title').textContent =
      role === 'admin' ? 'Command Center' : role === 'teacher' ? 'Teacher Studio' : 'Your Learning Space';
    document.body.appendChild(launch);
    return launch;
  }

  // Move the launch screen to step n (0–2), with an optional custom message.
  function stage(n, text) {
    var el = buildLaunch();
    stepIndex = n;
    var step = el.querySelector('.ntc-launch-step');
    var label = (text || STEPS[n] || STEPS[0]) + '…';
    if (step.textContent !== label) {
      step.classList.add('swap');
      setTimeout(function () { step.textContent = label; step.classList.remove('swap'); }, step.textContent ? 160 : 0);
    }
    var dots = el.querySelectorAll('.ntc-launch-dots i');
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = i < n ? 'done' : i === n ? 'now' : '';
    }
    el.offsetWidth; // let the fade-in start from opacity 0
    el.classList.add('on');
  }

  function hideLaunch() {
    if (launch) launch.classList.remove('on');
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
    if (navigator.vibrate) { try { navigator.vibrate(40); } catch (_) {} }
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
    toast.textContent = "You've signed out. See you soon 👋";
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
