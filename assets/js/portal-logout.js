/* Sign-out confirmation + goodbye screen, shared by the three portals.
 *
 *   window.ntcLogout({ signOut: () => signOut(auth), to: '/login/student', role: 'student' })
 *
 * Sign out used to happen the instant the button was touched (an accidental
 * tap on a phone logged people out). Now a bottom sheet asks first; on
 * confirm a full-screen goodbye screen (same look as the login loader) stays
 * up while Firebase signs out and the login page loads. The login page then
 * shows a short "You've signed out" note (see login-boot.js).
 */
(function () {
  'use strict';
  var CSS =
    '.ntc-out-backdrop{position:fixed;inset:0;z-index:2147482000;background:#120f2499;display:flex;align-items:flex-end;justify-content:center;' +
      'opacity:0;transition:opacity .2s ease;-webkit-tap-highlight-color:transparent}' +
    '.ntc-out-backdrop.on{opacity:1}' +
    '.ntc-out-sheet{width:100%;max-width:480px;background:#fff;color:#1f1d35;border-radius:24px 24px 0 0;' +
      'padding:10px 20px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -12px 40px #120f2433;' +
      'transform:translateY(100%);transition:transform .32s cubic-bezier(.2,.8,.2,1);font-family:"DM Sans",system-ui,-apple-system,sans-serif;text-align:center}' +
    '.ntc-out-backdrop.on .ntc-out-sheet{transform:none}' +
    '.ntc-out-grip{width:40px;height:4px;border-radius:4px;background:#d9d5ea;margin:0 auto 18px}' +
    '.ntc-out-icon{width:64px;height:64px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;font-size:30px;' +
      'background:linear-gradient(135deg,#f1edff,#e3f7f4);box-shadow:inset 0 0 0 1px #e4def8}' +
    '.ntc-out-title{font:700 20px/1.25 Syne,"DM Sans",system-ui,sans-serif;margin:0 0 6px}' +
    '.ntc-out-text{font-size:14px;line-height:1.5;color:#6b6788;margin:0 auto 20px;max-width:320px}' +
    '.ntc-out-error{font-size:13px;color:#b42318;margin:-8px 0 14px}' +
    '.ntc-out-actions{display:flex;flex-direction:column;gap:10px}' +
    '.ntc-out-actions button{min-height:52px;border-radius:14px;font:600 16px "DM Sans",system-ui,sans-serif;cursor:pointer;touch-action:manipulation;border:0}' +
    '.ntc-out-yes{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;box-shadow:0 8px 20px -8px #dc262699}' +
    '.ntc-out-no{background:#f3f1fa;color:#3d3a5c}' +
    '.ntc-out-actions button:active{transform:scale(.98)}' +
    '.ntc-out-actions button:focus-visible{outline:3px solid #a78bfa;outline-offset:2px}' +
    '@media(min-width:640px){.ntc-out-backdrop{align-items:center}.ntc-out-sheet{border-radius:24px;padding:24px 28px 24px;transform:translateY(16px) scale(.97);opacity:0;' +
      'transition:transform .25s cubic-bezier(.2,.8,.2,1),opacity .2s ease}.ntc-out-backdrop.on .ntc-out-sheet{opacity:1}.ntc-out-grip{display:none}' +
      '.ntc-out-actions{flex-direction:row-reverse}.ntc-out-actions button{flex:1}}' +
    // Goodbye screen: same look and spinner position as the login loader.
    '.ntc-bye{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;color:#f1eefc;text-align:center;' +
      'background:radial-gradient(120% 80% at 50% 0%,#3d3576 0%,#25214c 45%,#15132b 100%);opacity:0;transition:opacity .25s ease;' +
      'font-family:"DM Sans",system-ui,-apple-system,sans-serif}' +
    '.ntc-bye.on{opacity:1}' +
    '.ntc-bye-in{display:flex;flex-direction:column;align-items:center;gap:22px;padding:24px;transform:translateY(8px) scale(.98);transition:transform .35s cubic-bezier(.2,.8,.2,1)}' +
    '.ntc-bye.on .ntc-bye-in{transform:none}' +
    '.ntc-bye-mark{position:relative;width:96px;height:96px;display:grid;place-items:center}' +
    '.ntc-bye-mark::before{content:"";position:absolute;inset:0;border-radius:50%;' +
      'background:conic-gradient(from 0deg,transparent 0 25%,#a78bfa 60%,#b5eae6 85%,transparent);' +
      '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));' +
      'mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));animation:ntc-bye-spin 1s linear infinite}' +
    '.ntc-bye-mark::after{content:"";position:absolute;inset:14px;border-radius:50%;background:#ffffff0d;box-shadow:0 0 0 1px #ffffff14,0 0 40px #a78bfa40}' +
    '.ntc-bye-icon{position:relative;z-index:1;font-size:34px;line-height:1;transform-origin:70% 80%;animation:ntc-bye-wave 1.4s ease-in-out infinite}' +
    '.ntc-bye-title{font:700 20px/1.2 Syne,"DM Sans",system-ui,sans-serif;letter-spacing:-.3px}' +
    '.ntc-bye-step{min-height:20px;font-size:14px;color:#c4bee6}' +
    '.ntc-bye-brand{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));left:0;right:0;font-size:11px;letter-spacing:2px;color:#8d87b5}' +
    '@keyframes ntc-bye-spin{to{transform:rotate(360deg)}}' +
    '@keyframes ntc-bye-wave{0%,60%,100%{transform:rotate(0)}10%,30%{transform:rotate(16deg)}20%,40%{transform:rotate(-8deg)}}' +
    '@media(prefers-reduced-motion:reduce){.ntc-out-sheet,.ntc-out-backdrop,.ntc-bye,.ntc-bye-in{transition:none}' +
      '.ntc-bye-icon{animation:none}.ntc-bye-mark::before{animation-duration:2.4s}}';

  var styled = false;
  function addStyles() {
    if (styled) return;
    styled = true;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  var open = null;

  function goodbye() {
    var el = document.createElement('div');
    el.className = 'ntc-bye';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="ntc-bye-in"><div class="ntc-bye-mark"><span class="ntc-bye-icon" aria-hidden="true">👋</span></div>' +
      '<div class="ntc-bye-title">Signing you out</div><div class="ntc-bye-step">See you soon…</div></div>' +
      '<div class="ntc-bye-brand">THE NEWTOWN CLASSES</div>';
    document.body.appendChild(el);
    el.offsetWidth;
    el.classList.add('on');
    return el;
  }

  window.ntcLogout = function (options) {
    if (open) return;
    addStyles();
    var staff = options.role === 'teacher' || options.role === 'admin';
    var returnFocus = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'ntc-out-backdrop';
    backdrop.innerHTML =
      '<div class="ntc-out-sheet" role="alertdialog" aria-modal="true" aria-labelledby="ntcOutTitle" aria-describedby="ntcOutText">' +
      '<div class="ntc-out-grip" aria-hidden="true"></div><div class="ntc-out-icon" aria-hidden="true">👋</div>' +
      '<h2 class="ntc-out-title" id="ntcOutTitle">Sign out?</h2>' +
      '<p class="ntc-out-text" id="ntcOutText">You\'ll need your ' + (staff ? 'email' : 'Student ID') +
      ' and password to sign back in on this device.</p><p class="ntc-out-error" role="alert" hidden></p>' +
      '<div class="ntc-out-actions"><button type="button" class="ntc-out-yes">Sign out</button>' +
      '<button type="button" class="ntc-out-no">Stay signed in</button></div></div>';
    document.body.appendChild(backdrop);
    open = backdrop;
    var yes = backdrop.querySelector('.ntc-out-yes');
    var no = backdrop.querySelector('.ntc-out-no');
    backdrop.offsetWidth;
    backdrop.classList.add('on');
    no.focus();

    function close() {
      if (!open) return;
      open = null;
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('on');
      setTimeout(function () { backdrop.remove(); }, 320);
      if (returnFocus && returnFocus.focus) returnFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {   // keep focus inside the sheet
        e.preventDefault();
        (document.activeElement === yes ? no : yes).focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    no.addEventListener('click', close);

    yes.addEventListener('click', function () {
      yes.disabled = no.disabled = true;
      var screen = goodbye();
      var minimum = new Promise(function (r) { setTimeout(r, 900); }); // long enough to read, short enough not to annoy
      Promise.resolve().then(options.signOut).then(function () {
        try { sessionStorage.setItem('ntc:signed-out', '1'); } catch (_) {}
        return minimum;
      }).then(function () {
        window.location.replace(options.to);
      }).catch(function (err) {
        console.warn('Sign out failed:', err);
        screen.classList.remove('on');
        setTimeout(function () { screen.remove(); }, 260);
        yes.disabled = no.disabled = false;
        var msg = backdrop.querySelector('.ntc-out-error');
        msg.textContent = 'Could not sign out. Check your connection and try again.';
        msg.hidden = false;
      });
    });
  };
})();
