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
  var open = null;

  function goodbye() {
    var el = document.createElement('div');
    el.className = 'ntc-bye';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="ntc-bye-brand"><span class="ntc-auth-brand-icon" aria-hidden="true">✧</span>THE NEWTOWN CLASSES</div>' +
      '<div class="ntc-bye-in"><div class="ntc-auth-kicker">Until next time</div>' +
      '<div class="ntc-bye-mark" aria-hidden="true"><i class="ntc-auth-satellite"></i><span class="ntc-bye-icon">' +
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 10H12a3 3 0 0 0-3 3v22a3 3 0 0 0 3 3h10M20 24h20m-7-7 7 7-7 7"/></svg></span></div>' +
      '<h2 class="ntc-bye-title">See you soon.</h2><p class="ntc-bye-step">Signing you out…</p>' +
      '<div class="ntc-bye-track" aria-hidden="true"></div></div>' +
      '<div class="ntc-auth-foot">Every little step takes you further.</div>';
    document.body.appendChild(el);
    el.offsetWidth;
    el.classList.add('on');
    return el;
  }

  window.ntcLogout = function (options) {
    if (open) return;
    var staff = options.role === 'teacher' || options.role === 'admin';
    var returnFocus = document.activeElement;
    var busy = false;
    var previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    var backdrop = document.createElement('div');
    backdrop.className = 'ntc-out-backdrop';
    backdrop.innerHTML =
      '<div class="ntc-out-sheet" role="alertdialog" aria-modal="true" aria-labelledby="ntcOutTitle" aria-describedby="ntcOutText">' +
      '<div class="ntc-out-grip" aria-hidden="true"></div><div class="ntc-out-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M10 12h11m-4-4 4 4-4 4"/></svg></div>' +
      '<p class="ntc-out-kicker">Taking a break</p><h2 class="ntc-out-title" id="ntcOutTitle">Sign out for now?</h2>' +
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
      if (!open || busy) return;
      open = null;
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('on');
      document.body.style.overflow = previousOverflow;
      setTimeout(function () { backdrop.remove(); }, 320);
      if (returnFocus && returnFocus.focus) returnFocus.focus();
    }
    function onKey(e) {
      if (busy && (e.key === 'Escape' || e.key === 'Tab')) { e.preventDefault(); e.stopPropagation(); return; }
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
      if (busy) return;
      busy = true;
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
        busy = false;
        var msg = backdrop.querySelector('.ntc-out-error');
        msg.textContent = 'Could not sign out. Check your connection and try again.';
        msg.hidden = false;
        no.focus();
      });
    });
  };
})();
