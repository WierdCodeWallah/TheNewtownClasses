/* App-style inquiry navigation stays usable even when Google cannot load. */
(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('enquiryDialog');
  if (!dialog) return;
  document.body.append(dialog); // Escape the homepage's animated/transforming ancestors.
  const screens = [...dialog.querySelectorAll('[data-enquiry-step]')];
  let step = 0, ready = false, busy = false, complete = false;
  let returnFocus, scrollY = 0, savedBody, historyPending = false;
  function viewport() {
    if (!dialog.open) return;
    dialog.style.setProperty('--enquiry-height', `${window.visualViewport?.height || innerHeight}px`);
    dialog.style.setProperty('--enquiry-top', `${window.visualViewport?.offsetTop || 0}px`);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (dialog.contains(active) && active.matches('input,select,textarea')) {
        active.scrollIntoView({block:'nearest',behavior:'instant'});
      }
    });
  }
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport);
  dialog.addEventListener('focusin', event => {
    if (event.target.matches('input,select,textarea')) viewport();
  });
  function open(trigger) {
    if (dialog.open || historyPending) return;
    returnFocus = trigger || document.activeElement;
    scrollY = window.scrollY;
    savedBody = {position:document.body.style.position,top:document.body.style.top,width:document.body.style.width,overflow:document.body.style.overflow};
    Object.assign(document.body.style, {position:'fixed',top:`-${scrollY}px`,width:'100%',overflow:'hidden'});
    dialog.showModal(); viewport();
    history.pushState({...history.state, enquirySheet:true}, '');
    (complete ? $('enquirySuccess') : ready ? screens[step].querySelector('h2') : $('enquiryClose')).focus({preventScroll:true});
  }
  function close() { if (!busy && dialog.open) dialog.close(); }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    Object.assign(document.body.style, savedBody);
    window.scrollTo({top:scrollY,behavior:'instant'});
    returnFocus?.focus({preventScroll:true});
    if (history.state?.enquirySheet) { historyPending = true; history.back(); }
  });
  window.addEventListener('popstate', () => {
    historyPending = false;
    // Android/browser Back closes the sheet; entered values remain in memory.
    if (dialog.open && !history.state?.enquirySheet) dialog.close();
  });
  $('enquiryOpen').onclick = event => open(event.currentTarget);
  $('enquiryClose').onclick = $('enquiryDone').onclick = close;
  document.addEventListener('click', event => {
    const cta = event.target.closest('a[href="#contact"]:is(.nav-cta,.btn-primary,.btn-outline)');
    if (!cta || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation(); open(cta);
  }, true);
  function review() {
    $('enquiryReview').replaceChildren();
    [['Student','enquiryName'],['Mobile','enquiryPhone'],['Course','enquiryCourse'],['Class','enquiryClass']].forEach(([label,id]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = $(id).value; row.append(dt,dd); $('enquiryReview').append(row);
    });
  }
  function render() {
    screens.forEach((screen,index) => { screen.hidden = index !== step; });
    $('enquiryProgress').hidden = $('enquiryActions').hidden = !ready || complete;
    $('enquiryAccount').hidden = !ready || complete || step !== 0;
    $('enquiryProgressText').textContent = `Step ${step + 1} of 3 · ${['About you','Your goals','Review'][step]}`;
    $('enquiryProgressText').nextElementSibling.textContent = ['Let’s begin','Your learning path','Ready to send'][step];
    $('enquiryProgressFill').style.width = `${(step + 1) / 3 * 100}%`;
    dialog.querySelector('[role=progressbar]').setAttribute('aria-valuenow', String(step + 1));
    $('enquiryBack').hidden = step === 0;
    $('enquiryNext').hidden = step === 2;
    $('enquirySubmit').hidden = step !== 2;
    ['enquiryNext','enquiryBack','enquirySubmit','enquiryClose'].forEach(id => { $(id).disabled = busy; });
    if (step === 2) review();
  }
  function go(next) {
    step = Math.max(0,Math.min(2,next));
    $('cmsEnquiryMsg').textContent = '';
    render(); $('enquiryScroll').scrollTop = 0;
    if (dialog.open) screens[step].querySelector('h2').focus({preventScroll:true});
  }
  function validate(index) {
    const inputs = [...screens[index].querySelectorAll('input,select,textarea')];
    $('enquiryName').setCustomValidity($('enquiryName').value.trim().length < 2 ? 'Please enter the student’s full name.' : '');
    let phone = $('enquiryPhone').value.replace(/\D/g,'');
    if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
    if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
    $('enquiryPhone').setCustomValidity(/^[6-9]\d{9}$/.test(phone) ? '' : 'Please enter a valid 10-digit Indian mobile number.');
    const invalid = inputs.find(input => !input.checkValidity());
    if (!invalid) return true;
    go(index);
    $('cmsEnquiryMsg').textContent = invalid.validationMessage;
    $('cmsEnquiryMsg').classList.add('is-error');
    invalid.setAttribute('aria-invalid','true');
    invalid.setAttribute('aria-describedby','cmsEnquiryMsg');
    invalid.focus(); return false;
  }
  $('enquiryForm').addEventListener('input', event => {
    event.target.setCustomValidity?.(''); event.target.removeAttribute('aria-invalid');
    $('cmsEnquiryMsg').textContent = '';
  });
  $('enquiryNext').onclick = () => { if (!busy && ready && validate(step)) go(step + 1); };
  $('enquiryBack').onclick = () => { if (!busy) go(step - 1); };
  window.EnquiryUI = {
    get step() { return step; }, go, validate,
    setState(state) {
      const wasReady = ready;
      ready = state.ready; busy = state.busy; complete = state.complete;
      if (!ready) step = 0;
      render();
      if (!wasReady && ready && dialog.open) go(0);
    }
  };
  render();
})();
