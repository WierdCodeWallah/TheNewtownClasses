/* Admin panel — small behaviours behind the clean app-style layout.
   - Student rows are compact on phones; tapping one opens its details in place.
   - Card titles lose their decorative emoji; Home shortcuts get small line icons.
   - The generic "Narrow your list…" hint under search bars is hidden. */
(function () {
  'use strict';
  var PICTO = /^[\s‍️]*(?:\p{Extended_Pictographic}[\s‍️]*)+/u;
  var ICONS = {
    'test-desk': '<path d="M9 4h6v3H9zM7 5.5H5.5V20h13V5.5H17M8.5 13l2.5 2.5 4.5-5"/>',
    'all-students': '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3.2 3.2 0 0 1 0 6.4M17.5 14.2A5.5 5.5 0 0 1 21 20"/>',
    'add-student': '<circle cx="10" cy="8" r="3.2"/><path d="M4 20a6 6 0 0 1 12 0M19 7v6M16 10h6"/>',
    'teachers': '<path d="M3 9l9-5 9 5-9 5zM7 11.5V16c1.5 1.5 3.2 2.2 5 2.2s3.5-.7 5-2.2v-4.5M21 9v5"/>',
    'attendance': '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4"/>',
    'upload-material': '<path d="M12 6.5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/>',
    'live-classes': '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M15 10.5l6-3.5v10l-6-3.5"/>',
    'online-students': '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.1-3.8-8.5s1.3-6.2 3.8-8.5z"/>'
  };
  var GLYPH = /^[\s‍️]*(?:[\u2190-\u21FF\u2B00-\u2BFF\u23E9-\u23FA\u2700-\u27BF]|\p{Extended_Pictographic})[\s‍️]*/u;
  // Section descriptions stay out of the way: a small ⓘ next to the title shows them.
  function describe(root) {
    root.querySelectorAll('.card-title + .card-sub, .card-title ~ .card-sub, .inquiry-heading p, .oar-head > div > p').forEach(function (p) {
      if (p.dataset.aaDesc) return;
      var title = p.parentElement.querySelector('.card-title, h2');
      if (!title || title.querySelector('.aa-info')) { p.dataset.aaDesc = '1'; p.classList.add('aa-desc'); return; }
      p.dataset.aaDesc = '1'; p.classList.add('aa-desc');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'aa-info'; b.setAttribute('aria-label', 'About this section'); b.setAttribute('aria-expanded', 'false');
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.2"/></svg>';
      b.onclick = function () { var on = !p.classList.contains('show'); p.classList.toggle('show', on); b.setAttribute('aria-expanded', String(on)); };
      title.appendChild(b);
    });
  }
  function tidyButtons(root) {
    root.querySelectorAll('button, a.btn, .oar-btn').forEach(function (btn) {
      var node = btn.firstChild;
      while (node && node.nodeType === 3 && !node.nodeValue.trim()) node = node.nextSibling;
      if (!node || node.nodeType !== 3 || !GLYPH.test(node.nodeValue)) return;
      var rest = node.nodeValue.replace(GLYPH, '');
      if (rest.trim() || btn.children.length) node.nodeValue = rest;   // keep icon-only buttons (✕, ✎) as they are
    });
  }
  function clean(root) {
    describe(root); tidyButtons(root);
    root.querySelectorAll('.card-title').forEach(function (title) {
      var node = title.firstChild;
      if (node && node.nodeType === 3 && PICTO.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(PICTO, '');
    });
    document.querySelectorAll('.portal-back-context').forEach(function (crumb) {
      if (PICTO.test(crumb.textContent)) crumb.textContent = crumb.textContent.replace(PICTO, '');
    });
    root.querySelectorAll('.portal-path').forEach(function (path) {
      if (/^Narrow your list/.test(path.textContent)) path.dataset.aaHint = '1'; else delete path.dataset.aaHint;
    });
  }
  function start() {
    if (document.body.dataset.portal !== 'admin') return;
    var main = document.getElementById('mainContent') || document.body;
    document.querySelectorAll('.admin-shortcut-grid [data-admin-go]').forEach(function (button) {
      var d = ICONS[button.dataset.adminGo];
      if (!d || button.querySelector('.aa-ic')) return;
      var icon = document.createElement('span');
      icon.className = 'aa-ic'; icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
      button.prepend(icon);
    });
    clean(main);
    var queued = false;
    new MutationObserver(function () {
      if (queued) return; queued = true;
      requestAnimationFrame(function () { queued = false; clean(main); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    var body = document.getElementById('studentTableBody');
    if (!body) return;
    var phone = function () { return window.matchMedia('(max-width: 760px)').matches; };
    function prepare() {
      body.querySelectorAll('tr:not(.group-header)').forEach(function (row) {
        if (row.dataset.aaReady) return;
        row.dataset.aaReady = '1'; row.tabIndex = 0; row.setAttribute('aria-expanded', 'false');
      });
    }
    function toggle(row) {
      if (!phone()) return;
      var open = !row.classList.contains('open');
      body.querySelectorAll('tr.open').forEach(function (r) { r.classList.remove('open'); r.setAttribute('aria-expanded', 'false'); });
      row.classList.toggle('open', open);
      row.setAttribute('aria-expanded', String(open));
    }
    body.addEventListener('click', function (e) {
      if (e.target.closest('button, a, input, select')) return;
      var row = e.target.closest('tr:not(.group-header)');
      if (row) toggle(row);
    });
    body.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr:not(.group-header)')) { e.preventDefault(); toggle(e.target); }
    });
    new MutationObserver(prepare).observe(body, { childList: true });
    prepare();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
