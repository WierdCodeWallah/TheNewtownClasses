/* Associate legacy field labels and hints without replacing native controls or
   their existing handlers. Also handles question editors and loaded dialogs. */
(function () {
  'use strict';
  let sequence = 0;
  const fields = '.field, .form-field, .form-group';
  const icons = {
    person: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    book: '<path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2"/>',
    text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8" cy="11" r="2"/><path d="M5 16c0-3 6-3 6 0m3-6h4m-4 4h3"/>'
  };
  function syncValue(control) {
    const field = control.closest?.('.app-input-field');
    if (field) field.classList.toggle('has-value', Boolean(control.value));
  }
  function identify(node) {
    if (!node.id) {
      do { node.id = 'portal-control-' + (++sequence); }
      while (document.getElementById(node.id) !== node);
    }
    return node.id;
  }
  function enhance(root) {
    const containers = [...root.querySelectorAll(fields)];
    if (root.matches?.(fields)) containers.unshift(root);
    containers.forEach(field => {
      const label = field.querySelector(':scope > label:not([for])');
      const controls = [...field.querySelectorAll('input:not([type=hidden]),select,textarea')]
        .filter(control => control.closest(fields) === field);
      if (label && !label.querySelector('input,select,textarea') && controls.length === 1) {
        label.htmlFor = identify(controls[0]);
      }
      const group = field.querySelector(':scope > .chip-group');
      if (label && group && !group.hasAttribute('aria-labelledby')) {
        group.setAttribute('role', 'group');
        group.setAttribute('aria-labelledby', identify(label));
      }
      const hint = field.querySelector(':scope > p, :scope > small');
      if (hint) controls.forEach(control => {
        const ids = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        ids.add(identify(hint));
        control.setAttribute('aria-describedby', [...ids].join(' '));
      });
      // Keep the DOM structure and native input intact: page scripts often use
      // parentElement, so decoration belongs on the existing field container.
      const title = field.querySelector(':scope > label');
      const control = controls[0];
      if (controls.length === 1 && title && !title.querySelector('input,select,textarea') &&
          control.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]),select,textarea') &&
          (control.parentElement === field || control.parentElement.classList.contains('password-wrap'))) {
        field.classList.add('app-input-field');
        if (!title.querySelector('.app-field-icon')) {
          const text = title.textContent.toLowerCase();
          const kind = /password/.test(text) ? 'lock' : /phone/.test(text) ? 'phone' : /email/.test(text) ? 'mail' : /student id/.test(text) ? 'id' : /name/.test(text) ? 'person' : /class|board|subject|chapter|enroll/.test(text) ? 'book' : /date|time/.test(text) ? 'calendar' : 'text';
          const icon = document.createElement('span');
          icon.className = 'app-field-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icons[kind] + '</svg>';
          title.prepend(icon);
        }
        syncValue(control);
      }
    });
  }
  document.addEventListener('input', event => syncValue(event.target));
  document.addEventListener('change', event => syncValue(event.target));
  document.addEventListener('reset', event => {
    // reset's default action happens after the listener.
    queueMicrotask(() => event.target.querySelectorAll('input,select,textarea').forEach(syncValue));
  });
  enhance(document);
  new MutationObserver(records => {
    const roots = new Set();
    records.forEach(record => {
      const field = record.target.closest?.(fields);
      if (field) roots.add(field);
      record.addedNodes.forEach(node => { if (node.nodeType === 1) roots.add(node); });
    });
    roots.forEach(enhance);
  }).observe(document.body, {childList:true, subtree:true});

  // One shared picker; the original select stays in place for form validation,
  // dependent dropdowns, autofill, reset and existing page event handlers.
  if (typeof HTMLDialogElement === 'undefined') return;
  const picker = document.createElement('dialog');
  picker.className = 'app-picker';
  picker.id = 'portal-app-picker';
  picker.setAttribute('aria-labelledby', 'app-picker-title');
  picker.innerHTML = '<div class="app-picker-grip" aria-hidden="true"></div>' +
    '<header class="app-picker-header"><span class="app-picker-spark" aria-hidden="true">✦</span><div><span class="app-picker-eyebrow">MAKE IT YOURS</span><h2 id="app-picker-title"></h2></div><button type="button" class="app-picker-close" aria-label="Close choices">×</button></header>' +
    '<div class="app-picker-search" hidden><input type="search" aria-label="Search choices" placeholder="Find your option…" autocomplete="off"></div>' +
    '<div class="app-picker-options" role="listbox" tabindex="0" aria-labelledby="app-picker-title"></div>' +
    '<p class="app-picker-empty" role="status" hidden>No matches. Try another word.</p><footer class="app-picker-footer"><span class="app-picker-count"></span><span>Tap to choose</span></footer>';
  document.body.append(picker);
  const list = picker.querySelector('[role=listbox]');
  const search = picker.querySelector('input');
  let source = null, choices = [], cursor = -1, closeTimer, typeahead = '', typeTimer;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(max-width: 600px)');
  const selectable = option => !option.disabled && !option.parentElement?.disabled && !option.hidden && !option.parentElement?.hidden;
  const eligible = select => select instanceof HTMLSelectElement && !select.multiple && select.size <= 1 && !select.matches(':disabled');
  function positionPicker() {
    picker.style.setProperty('--picker-viewport-height', (window.visualViewport?.height || innerHeight) + 'px');
    if (!source || phone.matches) { picker.style.removeProperty('left'); picker.style.removeProperty('top'); return; }
    const box = source.getBoundingClientRect();
    const width = Math.min(420, Math.max(320, box.width), innerWidth - 32);
    picker.style.width = width + 'px';
    picker.style.left = Math.max(16, Math.min(box.left, innerWidth - width - 16)) + 'px';
    const height = picker.getBoundingClientRect().height;
    picker.style.top = Math.max(16, Math.min(box.bottom + 10, innerHeight - height - 16)) + 'px';
  }
  function markCursor(index, scroll = true) {
    cursor = index;
    [...list.children].forEach((item, i) => item.classList.toggle('is-active', i === cursor));
    if (cursor < 0) list.removeAttribute('aria-activedescendant');
    else {
      const item = list.children[cursor];
      list.setAttribute('aria-activedescendant', item.id);
      if (scroll) item.scrollIntoView({block:'nearest'});
    }
  }
  function renderChoices() {
    if (!source) return;
    if (!source.isConnected || !eligible(source) || !source.getClientRects().length) { closePicker(true); return; }
    const needle = search.value.trim().toLocaleLowerCase();
    choices = [...source.options].filter(option => selectable(option) && option.label.toLocaleLowerCase().includes(needle));
    list.replaceChildren();
    let group = null;
    choices.forEach((option, index) => {
      const row = document.createElement('div');
      row.id = 'app-picker-option-' + index;
      row.className = 'app-picker-option';
      row.dataset.index = index;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      const text = document.createElement('span');
      text.className = 'app-picker-option-text';
      const name = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement.label : '';
      if (name && name !== group) {
        const caption = document.createElement('small'); caption.textContent = name; text.append(caption);
      }
      group = name;
      const label = document.createElement('span'); label.textContent = option.label; text.append(label);
      const check = document.createElement('span'); check.className = 'app-picker-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = option.selected ? '✓' : '';
      row.append(text, check); list.append(row);
    });
    picker.querySelector('.app-picker-empty').hidden = choices.length > 0;
    picker.querySelector('.app-picker-count').textContent = choices.length + (choices.length === 1 ? ' option' : ' options');
    markCursor(choices.length ? Math.max(0, choices.findIndex(option => option.selected)) : -1, false);
    positionPicker();
  }
  function finishClose() {
    clearTimeout(closeTimer);
    const previous = source;
    source = null;
    picker.close();
    picker.classList.remove('is-closing');
    document.body.classList.remove('app-picker-open');
    if (previous) {
      previous.setAttribute('aria-expanded', 'false');
      if (previous.isConnected && !previous.disabled) previous.focus({preventScroll:true});
    }
  }
  function closePicker(immediate = false) {
    if (!source) return;
    if (immediate || reduced.matches) finishClose();
    else {
      picker.classList.add('is-closing');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(finishClose, 160);
    }
  }
  function choose(index) {
    const option = choices[index], select = source;
    if (!select || !option || !selectable(option) || !select.contains(option) || !eligible(select)) return;
    const changed = select.selectedIndex !== option.index;
    select.selectedIndex = option.index;
    closePicker();
    if (changed) {
      select.dispatchEvent(new Event('input', {bubbles:true}));
      select.dispatchEvent(new Event('change', {bubbles:true}));
    }
  }
  function openPicker(select) {
    if (!eligible(select) || source) return;
    source = select;
    search.value = '';
    clearTimeout(typeTimer); typeahead = '';
    const explicitLabel = (select.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    const title = explicitLabel || select.getAttribute('aria-label') || [...select.labels].map(label => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('select,input,textarea,.app-field-icon').forEach(node => node.remove());
      return copy.textContent;
    }).join(' ').trim() || 'Choose an option';
    picker.querySelector('h2').textContent = title.replace(/\s*\*\s*$/, '');
    picker.querySelector('.app-picker-search').hidden = select.options.length < 9;
    select.setAttribute('aria-haspopup', 'dialog');
    select.setAttribute('aria-controls', picker.id);
    select.setAttribute('aria-expanded', 'true');
    document.body.classList.add('app-picker-open');
    picker.showModal();
    renderChoices();
    list.focus({preventScroll:true});
    if (cursor >= 0) list.children[cursor].scrollIntoView({block:'nearest'});
  }
  document.addEventListener('pointerdown', event => {
    if (eligible(event.target) && event.button === 0) event.preventDefault();
  });
  document.addEventListener('click', event => {
    if (eligible(event.target)) { event.preventDefault(); openPicker(event.target); }
  });
  document.addEventListener('keydown', event => {
    if (eligible(event.target) && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); openPicker(event.target);
    }
  });
  picker.querySelector('.app-picker-close').addEventListener('click', () => closePicker());
  picker.addEventListener('cancel', event => { event.preventDefault(); closePicker(); });
  picker.addEventListener('click', event => {
    if (event.target !== picker) return;
    const box = picker.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closePicker();
  });
  list.addEventListener('click', event => {
    const row = event.target.closest('[data-index]');
    if (row && !picker.classList.contains('is-closing')) choose(Number(row.dataset.index));
  });
  search.addEventListener('input', renderChoices);
  picker.addEventListener('keydown', event => {
    if (![list, search].includes(event.target)) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target === list || event.key.startsWith('Arrow'))) {
      event.preventDefault(); list.focus({preventScroll:true});
      if (choices.length) markCursor(event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (cursor + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target === list)) {
      event.preventDefault(); if (cursor >= 0) choose(cursor);
    } else if (event.target === list && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); clearTimeout(typeTimer); typeahead += event.key.toLocaleLowerCase();
      const index = choices.findIndex(option => option.label.toLocaleLowerCase().startsWith(typeahead));
      if (index >= 0) markCursor(index);
      typeTimer = setTimeout(() => { typeahead = ''; }, 650);
    }
  });
  new MutationObserver(records => {
    if (source && records.some(record => record.target === source || source.contains(record.target) || !source.isConnected)) renderChoices();
  }).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['disabled', 'label', 'value', 'selected', 'multiple', 'size']});
  window.addEventListener('resize', positionPicker);
  window.visualViewport?.addEventListener('resize', positionPicker);
})();
