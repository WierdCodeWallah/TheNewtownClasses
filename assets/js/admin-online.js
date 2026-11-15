/* Admin → Online Students (all-India Online Test Series).
   Everyone who signed up at /test-series: their sign-up form details, tests
   unlocked, payments and online scripts. Read-only; CSV export for records.
   Loaded on demand when the admin opens the section. */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const date = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
const mobile = () => matchMedia('(max-width:600px)').matches;

let ctx = null, data = null, view = 'students', opener = null, bound = false;

function val(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) { const o = {}; for (const k in v.mapValue.fields || {}) o[k] = val(v.mapValue.fields[k]); return o; }
  return null;
}
const docOf = d => { const o = { id: d.name.split('/').pop() }; for (const k in d.fields || {}) o[k] = val(d.fields[k]); return o; };

async function load() {
  const { config } = ctx, token = await ctx.token();
  const base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
  const headers = { Authorization: 'Bearer ' + token };
  const list = path => window.PortalUI.fetchList(`${base}/${path}?key=${config.apiKey}&pageSize=300`, { headers }).then(r => r.documents.map(docOf));
  const query = async (collectionId, field, value, fields) => {
    const res = await fetch(`${base}:runQuery?key=${config.apiKey}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }, select: { fields: fields.map(fieldPath => ({ fieldPath })) } } }) });
    const json = await res.json();
    if (!res.ok || !Array.isArray(json)) throw new Error((json && json.error && json.error.message) || 'Could not load online scripts.');
    return json.filter(x => x.document).map(x => docOf(x.document));
  };
  const [students, purchases, orders, claims, reports, promos, redemptions] = await Promise.all([
    list('onlineStudents'), list('onlinePurchases'), list('onlineOrders'), list('onlineFreeClaims'),
    query('offlineReports', 'series', 'online', ['uid', 'testName', 'subject', 'chapter', 'status', 'score', 'totalMarks', 'submittedAt', 'approvedAt', 'studentClass']),
    list('promoCodes').catch(() => []), list('promoRedemptions').catch(() => [])
  ]);
  const by = (rows, key) => rows.reduce((m, r) => { (m[r[key]] ||= []).push(r); return m; }, {});
  const claimList = c => Array.isArray(c.claims) ? c.claims : c.testId ? [c] : [];
  return { students, purchases, orders, reports, promos: promos.sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || '')), redemptionsBy: by(redemptions, 'code'), claims: Object.fromEntries(claims.map(c => [c.id, claimList(c)])), purchasesBy: by(purchases, 'uid'), reportsBy: by(reports, 'uid') };
}

function kpis() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const online = data.students.filter(s => !s.enrolled);
  const paid = data.orders.filter(o => o.status === 'paid');
  const tiles = [
    [online.length, 'Online students'],
    [data.students.length - online.length, 'TNC students using it'],
    [data.students.filter(s => (s.createdAt || '') > weekAgo).length, 'Joined this week', 'ok'],
    [`${data.purchases.filter(p => Number(p.amountPaise) > 0).length} · ${Object.values(data.claims).reduce((n, c) => n + c.length, 0)}`, 'Paid unlocks · free mocks'],
    [inr(paid.reduce((n, o) => n + (Number(o.amountPaise) || 0), 0) / 100), 'Revenue', 'ok'],
    [data.reports.length, 'Scripts submitted']
  ];
  $('onaKpis').innerHTML = tiles.map(([n, label, tone]) => `<div class="oar-kpi${tone ? ' ' + tone : ''}"><strong>${esc(n)}</strong><span>${esc(label)}</span></div>`).join('');
}

function studentsView() {
  const host = $('onaStudents');
  if (!data.students.length) { window.PortalUI.clearBrowser(host); host.innerHTML = '<div class="oar-empty"><strong>No online students yet</strong>Students appear here as soon as they finish the sign-up form at /test-series.</div>'; return; }
  const rows = data.students.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const byId = new Map(rows.map(s => [s.id, s]));
  window.PortalUI.collection({ host, key: 'ona-students',
    items: rows.map(s => ({ id: s.id, studentName: s.name || '', onlineId: s.onlineId || s.studentId || '', class: s.class ? String(s.class) : 'Unassigned', board: s.board || '',
      state: s.state || 'Not given', type: s.enrolled ? 'TNC student' : 'Online', city: s.city || '', school: s.school || '', phone: s.phone || '', email: s.email || '', guardian: s.guardianName || '' })),
    title: 'Find an online student', eyebrow: 'ALL-INDIA SIGN-UPS', facets: ['class', 'board', 'state', 'type'], alwaysShow: ['type'],
    labels: { state: 'State', type: 'Account' }, plurals: { type: 'accounts' }, unit: ['student', 'students'],
    searchLabel: 'Search name, phone, email, school or city', pageSize: mobile() ? 6 : 12,
    render: visible => {
      host.innerHTML = visible.map(i => byId.get(i.id)).map(s => {
        const unlocked = (data.purchasesBy[s.id] || []).length, tests = (data.reportsBy[s.id] || []).length;
        return `<article class="oar-row">
          <div class="oar-who"><strong>${esc(s.name || 'Student')}</strong><small>${esc([s.onlineId || s.studentId, s.class && 'Class ' + s.class, s.board].filter(Boolean).join(' · '))}</small></div>
          <div class="oar-path"><span>${esc([s.city, s.state].filter(Boolean).join(', ') || '—')}</span><small>${esc(s.school || '')}</small><small>Joined ${esc(date(s.createdAt))}${s.phone ? ' · ' + esc(s.phone) : ''}</small></div>
          <div class="oar-meta"><span class="oar-chip ${s.enrolled ? 'ok' : 'info'}">${s.enrolled ? 'TNC student' : 'Online'}</span><span class="oar-chip">${unlocked} unlocked</span><span class="oar-chip">${tests} submitted</span>${s.profileComplete ? '' : '<span class="oar-chip warn">Form not finished</span>'}</div>
          <div class="oar-actions"><button type="button" class="oar-btn primary" data-ona-open="${esc(s.id)}">Details</button>${s.phone ? `<a class="oar-btn" href="tel:+91${esc(s.phone)}">Call</a>` : ''}</div>
        </article>`;
      }).join('');
    } });
}

function paymentsView() {
  const host = $('onaPayments');
  const names = new Map(data.students.map(s => [s.id, s]));
  const rows = data.orders.slice().sort((a, b) => (b.paidAt || b.createdAt || '').localeCompare(a.paidAt || a.createdAt || ''));
  if (!rows.length) { window.PortalUI.clearBrowser(host); host.innerHTML = '<div class="oar-empty"><strong>No payments yet</strong>Paid unlocks (₹499 per test) will be listed here with their Razorpay payment IDs.</div>'; return; }
  const byId = new Map(rows.map(o => [o.id, o]));
  window.PortalUI.collection({ host, key: 'ona-payments',
    items: rows.map(o => ({ id: o.id, studentName: o.studentName || (names.get(o.uid) || {}).name || '', onlineId: o.onlineId || '', test: o.testName || '', subject: o.subject || '', class: o.class || 'Unassigned',
      status: o.duplicate ? 'Duplicate · refund' : o.status === 'paid' ? 'Paid' : 'Not completed', paymentId: o.paymentId || '', orderId: o.id })),
    title: 'Payments', eyebrow: 'RAZORPAY', facets: ['class', 'subject', 'status'], alwaysShow: ['status'], labels: { status: 'Status' }, plurals: { status: 'statuses' },
    unit: ['payment', 'payments'], searchLabel: 'Search student, test or payment ID', pageSize: mobile() ? 8 : 15,
    render: visible => {
      host.innerHTML = visible.map(i => byId.get(i.id)).map(o => `<article class="oar-row">
        <div class="oar-who"><strong>${esc(o.studentName || (names.get(o.uid) || {}).name || 'Student')}</strong><small>${esc([o.onlineId, o.phone].filter(Boolean).join(' · '))}</small></div>
        <div class="oar-path"><span>${esc(o.testName || 'Test')}</span><small>${esc([o.subject, o.class && 'Class ' + o.class].filter(Boolean).join(' · '))}</small><small>${esc(o.paymentId || o.id)}</small></div>
        <div class="oar-meta"><span class="oar-marks">${inr((Number(o.amountPaise) || 0) / 100)}</span>${o.duplicate ? '<span class="oar-chip bad" title="Paid twice for something already unlocked — refund this payment in Razorpay">Duplicate · refund</span>' : ''}<span class="oar-chip ${o.status === 'paid' ? 'ok' : 'warn'}">${o.status === 'paid' ? 'Paid ' + esc(date(o.paidAt)) : 'Not completed · ' + esc(date(o.createdAt))}</span></div>
      </article>`).join('');
    } });
}

function openStudent(uid, btn) {
  const s = data.students.find(x => x.id === uid); if (!s) return;
  opener = btn || document.activeElement;
  const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd></div>`;
  const purchases = (data.purchasesBy[uid] || []).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
  const reports = (data.reportsBy[uid] || []).sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  $('onaModalKicker').textContent = s.enrolled ? 'TNC student · Online Test Series' : 'Online student';
  $('onaModalTitle').textContent = s.name || 'Student';
  $('onaModalBody').innerHTML = `
    <dl class="oar-facts">${fact('ID', s.onlineId || s.studentId)}${fact('Signed in with', s.enrolled ? 'TNC ID' : 'Google')}${fact('Email', s.email)}${fact('Mobile', s.phone)}
      ${fact('Date of birth', s.dob ? date(s.dob + 'T00:00:00') : '')}${fact('Gender', s.gender)}${fact('Class', s.class && 'Class ' + s.class)}${fact('Board', s.board)}
      ${fact('School', s.school)}${fact('Subjects', (s.subjects || []).join(', '))}${fact('Preparing for', s.target)}${fact('Joined', date(s.createdAt))}
      ${fact('Address', s.address)}${fact('City', s.city)}${fact('State', s.state)}${fact('PIN code', s.pincode)}
      ${fact('Guardian', s.guardianName)}${fact('Relation', s.guardianRelation)}${fact('Guardian mobile', s.guardianPhone)}${fact('Guardian email', s.guardianEmail)}${fact('Last active', date(s.lastSeenAt))}
      ${fact(`Free mocks (${s.enrolled ? 2 : 1})`, (data.claims[uid] || []).map(c => `${c.subject} · ${c.testName} (${date(c.claimedAt)})`).join('; ') || 'Not used yet')}</dl>
    <h4 style="margin:6px 0 8px;color:#16365f">Unlocked tests (${purchases.length})</h4>
    <div class="oar-list">${purchases.length ? purchases.map(p => `<div class="oar-row"><div class="oar-who"><strong>${esc(p.testName || p.testId)}</strong><small>${esc([p.subject, p.class && 'Class ' + p.class].filter(Boolean).join(' · '))}</small></div><div class="oar-meta">${Number(p.amountPaise) > 0 ? `<span class="oar-marks">${inr(Number(p.amountPaise) / 100)}</span>` : p.via === 'promo' ? `<span class="oar-chip info">Promo ${esc(p.promoCode || '')}</span>` : '<span class="oar-chip info">Free mock</span>'}<span class="oar-chip ok">${esc(date(p.paidAt))}</span>${p.paymentId ? `<span class="oar-chip">${esc(p.paymentId)}</span>` : ''}</div></div>`).join('') : '<div class="oar-empty">No unlocks yet' + (s.enrolled ? ' — chapter-wise tests are free for TNC students.' : '.') + '</div>'}</div>
    <h4 style="margin:14px 0 8px;color:#16365f">Online scripts (${reports.length})</h4>
    <div class="oar-list">${reports.length ? reports.map(r => `<div class="oar-row"><div class="oar-who"><strong>${esc(r.testName)}</strong><small>${esc([r.subject, r.chapter].filter(Boolean).join(' · '))} · submitted ${esc(date(r.submittedAt))}</small></div><div class="oar-meta">${r.status === 'approved' ? `<span class="oar-marks">${esc(r.score)} <small>/ ${esc(r.totalMarks)}</small></span><span class="oar-chip ok">Returned</span>` : '<span class="oar-chip warn">Awaiting review</span>'}</div></div>`).join('') : '<div class="oar-empty">No scripts submitted yet.</div>'}</div>
    <div class="oar-actions" style="margin-top:14px"><button type="button" class="oar-btn primary" data-pfor-give="${esc(uid)}">Give a promo code</button>${s.phone ? `<a class="oar-btn" href="tel:+91${esc(s.phone)}">Call student</a>` : ''}${s.guardianPhone ? `<a class="oar-btn" href="tel:+91${esc(s.guardianPhone)}">Call guardian</a>` : ''}${s.phone ? `<a class="oar-btn" href="https://wa.me/91${esc(s.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`;
  $('onaModal').hidden = false; document.documentElement.style.overflow = 'hidden';
  $('onaModalClose').focus();
}
function closeStudent() {
  if ($('onaModal').hidden) return;
  $('onaModal').hidden = true; document.documentElement.style.overflow = '';
  $('onaModalBody').innerHTML = '';
  if (opener && document.contains(opener)) opener.focus();
}

function exportCsv() {
  if (!data) return;
  const cols = [['Name', 'name'], ['ID', s => s.onlineId || s.studentId], ['Account', s => s.enrolled ? 'TNC student' : 'Online'], ['Email', 'email'], ['Mobile', 'phone'],
    ['Date of birth', 'dob'], ['Gender', 'gender'], ['Class', 'class'], ['Board', 'board'], ['School', 'school'], ['Subjects', s => (s.subjects || []).join('; ')], ['Preparing for', 'target'],
    ['Address', 'address'], ['City', 'city'], ['State', 'state'], ['PIN code', 'pincode'], ['Guardian', 'guardianName'], ['Relation', 'guardianRelation'], ['Guardian email', 'guardianEmail'], ['Guardian mobile', 'guardianPhone'],
    ['Tests unlocked', s => (data.purchasesBy[s.id] || []).length], ['Free mocks', s => (data.claims[s.id] || []).map(c => c.subject).join('; ')], ['Scripts submitted', s => (data.reportsBy[s.id] || []).length], ['Joined', s => (s.createdAt || '').slice(0, 10)]];
  // Quote every cell; a leading = + - @ is neutralised so spreadsheets never run it as a formula.
  const cell = v => { let t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const lines = [cols.map(c => cell(c[0])).join(',')].concat(data.students.map(s => cols.map(([, k]) => cell(typeof k === 'function' ? k(s) : s[k])).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `online-students-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// ── Promo codes: 100% off one purchase for Google students ──
const SCOPES = { all: 'Any test, module or pack', chapter: 'Chapter-wise tests', mock: 'Full mock tests', custom: 'Custom module tests', package: 'Mock packs' };
// "Only for": a code locked to one student (forUid). Nobody else can use it, even if it is shared.
let promoFor = null;
const forLine = st => `${st.name || 'Student'} · ${st.onlineId || ''}${st.class ? ' · Class ' + st.class : ''}`;
function renderFor() {
  const box = $('onaPForBox'); if (!box) return;
  box.innerHTML = promoFor
    ? `<div class="oar-for"><span><b>${esc(promoFor.name || 'Student')}</b><small>${esc([promoFor.onlineId, promoFor.class && 'Class ' + promoFor.class, promoFor.phone].filter(Boolean).join(' · '))}</small></span><button type="button" class="oar-btn" data-pfor-clear>Change</button></div>
       <small class="oar-help">Only this student can use the code. Anyone else is told it was made for another student.</small>`
    : `<input id="onaPFor" type="search" autocomplete="off" placeholder="Search name, ID or mobile" aria-label="Only for student"><div class="oar-pick" id="onaPForList"></div>
       <small class="oar-help">Leave empty and anyone with the code can use it.</small>`;
  const input = $('onaPFor');
  if (input) input.oninput = () => {
    const q = input.value.trim().toLowerCase(), list = $('onaPForList');
    const hits = q.length < 2 ? [] : data.students.filter(st => `${st.name} ${st.onlineId} ${st.studentId || ''} ${st.phone} ${st.email}`.toLowerCase().includes(q)).slice(0, 5);
    list.innerHTML = q.length < 2 ? '' : hits.length ? hits.map(st => `<button type="button" data-pfor="${esc(st.id)}"><b>${esc(st.name || 'Student')}</b><small>${esc([st.onlineId, st.class && 'Class ' + st.class, st.phone].filter(Boolean).join(' · '))}</small></button>`).join('')
      : '<p class="oar-help">No student matches.</p>';
  };
}
const newCode = () => 'TNC' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
async function rest(path, method, fields, query) {
  const { config } = ctx, base = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
  const res = await fetch(`${base}/${path}?key=${config.apiKey}${query || ''}`, { method, headers: { Authorization: 'Bearer ' + await ctx.token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw Object.assign(new Error((json.error && json.error.message) || 'Could not save.'), { status: res.status });
}
function promosView() {
  const host = $('onaPromos');
  const rows = data.promos, open = !rows.length;
  host.innerHTML = `<details class="oar-publish"${open ? ' open' : ''} id="onaPromoBox"><summary><span>＋ Create a promo code</span><small>Makes one purchase free: a test or mock (Google students), a custom test or a mock pack (anyone)</small></summary>
    <div class="oar-form-grid">
      <label>Code<input id="onaPCode" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${newCode()}"></label>
      <div class="full oar-forfield"><span class="oar-label">Only for (optional)</span><div id="onaPForBox"></div></div>
      <label>Works on<select id="onaPScope">${Object.entries(SCOPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>How many uses in total<input id="onaPMax" type="number" min="0" max="10000" value="1" inputmode="numeric"><small class="oar-help">1 = a single student. 0 = no limit.</small></label>
      <label>Covers up to ₹ (optional)<input id="onaPMaxValue" type="number" min="0" max="100000" inputmode="numeric" placeholder="e.g. 399"><small class="oar-help">Bigger purchases are refused. Empty = any price.</small></label>
      <label>Up to chapters (custom tests)<input id="onaPMaxCh" type="number" min="0" max="40" inputmode="numeric" placeholder="e.g. 2"><small class="oar-help">A cart with more chapters is refused. Empty = any.</small></label>
      <label>Expires on (optional)<input id="onaPExp" type="date"></label>
      <label class="full">Note (optional)<input id="onaPNote" maxlength="120" placeholder="e.g. Physics chapter 3 · paid by cash"></label>
      <label class="full" style="flex-direction:row;align-items:center;gap:8px"><input id="onaPOnce" type="checkbox" checked style="width:auto;min-height:0"> Each student can use it only once</label>
    </div>
    <div class="oar-actions"><button type="button" class="oar-btn primary" id="onaPCreate">Create code</button><button type="button" class="oar-btn" id="onaPNew">New random code</button></div>
    <div id="onaPMsg" class="oar-msg" role="status" aria-live="polite"></div></details>
    <div class="oar-list" id="onaPList">${rows.length ? rows.map(p => {
      const used = (data.redemptionsBy[p.code] || []).length || Number(p.uses || 0), max = Number(p.maxUses || 0);
      const expired = p.expiresAt && Date.parse(p.expiresAt) < Date.now(), full = max > 0 && used >= max;
      const state = p.active === false ? ['Off', ''] : expired ? ['Expired', 'warn'] : full ? ['Used up', 'warn'] : ['Active', 'ok'];
      return `<article class="oar-row"><div class="oar-who"><strong style="letter-spacing:.06em">${esc(p.code)}</strong><small>${esc(SCOPES[p.scope] || 'Any test or module')}${p.oncePerStudent === false ? '' : ' · once per student'}${p.expiresAt ? ' · until ' + esc(date(p.expiresAt)) : ''}</small>${Number(p.maxValueInr) || Number(p.maxChapters) ? `<small class="oar-forline">Covers ${[Number(p.maxValueInr) ? 'up to ₹' + Number(p.maxValueInr) : '', Number(p.maxChapters) ? 'up to ' + Number(p.maxChapters) + ' chapter' + (Number(p.maxChapters) === 1 ? '' : 's') : ''].filter(Boolean).join(' · ')}</small>` : ''}${p.forUid ? `<small class="oar-forline">For ${esc(forLine({ name: p.forName, onlineId: p.forOnlineId, class: p.forClass }))}</small>` : '<small>Anyone with the code</small>'}${p.note ? `<small>${esc(p.note)}</small>` : ''}</div>
        <div class="oar-meta"><span class="oar-chip ${state[1]}">${state[0]}</span><span class="oar-chip">${used} / ${max || '∞'} used</span></div>
        <div class="oar-actions">${used ? `<button type="button" class="oar-btn" data-promo-uses="${esc(p.code)}">Who used it</button>` : ''}<button type="button" class="oar-btn" data-promo-copy="${esc(p.code)}">Copy</button><button type="button" class="oar-btn" data-promo-toggle="${esc(p.code)}">${p.active === false ? 'Turn on' : 'Turn off'}</button></div></article>`;
    }).join('') : '<div class="oar-empty"><strong>No promo codes yet</strong>Create one above and send it to a student. It makes that purchase ₹0.</div>'}</div>`;
  $('onaPNew').onclick = () => { $('onaPCode').value = newCode(); };
  $('onaPCreate').onclick = createPromo;
  renderFor();
}
async function createPromo() {
  const msg = $('onaPMsg'), btn = $('onaPCreate');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'oar-msg' + (cls ? ' ' + cls : ''); };
  const code = $('onaPCode').value.trim().toUpperCase(), max = parseInt($('onaPMax').value || '0', 10), exp = $('onaPExp').value;
  if (!/^[A-Z0-9]{4,20}$/.test(code)) return say('Use 4–20 capital letters or digits, no spaces.', 'err');
  if (!(max >= 0 && max <= 10000)) return say('Uses must be between 0 and 10000.', 'err');
  const maxValue = parseInt($('onaPMaxValue').value || '0', 10), maxCh = parseInt($('onaPMaxCh').value || '0', 10);
  if (!(maxValue >= 0 && maxValue <= 100000)) return say('“Covers up to ₹” must be between 0 and 100000.', 'err');
  if (!(maxCh >= 0 && maxCh <= 40)) return say('“Up to chapters” must be between 0 and 40.', 'err');
  if (maxCh === 1) return say('Custom tests need at least 2 chapters per subject, so use 2 or more (or leave it empty).', 'err');
  if (data.promos.some(p => p.code === code)) return say('That code already exists. Pick another.', 'err');
  if ($('onaPFor') && $('onaPFor').value.trim()) return say('Tap a student in the list to lock the code to them, or clear the search.', 'err');
  const who = promoFor;
  btn.disabled = true; say('Creating…');
  const s = v => ({ stringValue: v }), now = new Date().toISOString();
  try {
    await rest(`promoCodes/${code}`, 'PATCH', { code: s(code), scope: s($('onaPScope').value), maxUses: { integerValue: String(max) }, uses: { integerValue: '0' },
      oncePerStudent: { booleanValue: $('onaPOnce').checked }, expiresAt: s(exp ? new Date(exp + 'T23:59:59+05:30').toISOString() : ''), note: s($('onaPNote').value.trim()),
      active: { booleanValue: true }, createdAt: s(now), createdBy: s(ctx.uid || ''),
      maxValueInr: { integerValue: String(maxValue) }, maxChapters: { integerValue: String(maxCh) },
      ...(who ? { forUid: s(who.id), forName: s(who.name || ''), forOnlineId: s(who.onlineId || ''), forClass: s(String(who.class || '')) } : {}) }, '&currentDocument.exists=false');
    data.promos.unshift({ code, scope: $('onaPScope').value, maxUses: max, uses: 0, oncePerStudent: $('onaPOnce').checked, expiresAt: exp ? new Date(exp + 'T23:59:59+05:30').toISOString() : '', note: $('onaPNote').value.trim(), active: true, createdAt: now, maxValueInr: maxValue, maxChapters: maxCh,
      ...(who ? { forUid: who.id, forName: who.name || '', forOnlineId: who.onlineId || '', forClass: String(who.class || '') } : {}) });
    promoFor = null; promosView();
    $('onaPMsg').className = 'oar-msg ok'; $('onaPMsg').textContent = who ? `Created ${code} for ${who.name || 'the student'}. Only this student can use it — copy it and send it.` : `Created ${code}. Copy it and send it to the student.`;
    try { await navigator.clipboard.writeText(code); } catch (_) {}
  } catch (e) {
    btn.disabled = false;
    say(e.status === 409 || /exists/i.test(e.message) ? 'That code already exists. Pick another.' : 'Could not create the code: ' + e.message, 'err');
  }
}
async function togglePromo(code, btn) {
  const p = data.promos.find(x => x.code === code); if (!p) return;
  btn.disabled = true;
  try { await rest(`promoCodes/${code}`, 'PATCH', { active: { booleanValue: p.active === false } }, '&updateMask.fieldPaths=active'); p.active = p.active === false; promosView(); }
  catch (e) { btn.disabled = false; alert('Could not update the code: ' + e.message); }
}
function promoUses(code, btn) {
  const list = (data.redemptionsBy[code] || []).sort((x, y) => (y.at || '').localeCompare(x.at || ''));
  opener = btn;
  $('onaModalKicker').textContent = 'Promo code'; $('onaModalTitle').textContent = code;
  $('onaModalBody').innerHTML = `<div class="oar-list">${list.map(r => `<div class="oar-row"><div class="oar-who"><strong>${esc(r.studentName || r.uid)}</strong><small>${esc([r.onlineId, r.testName, r.subject, r.class && 'Class ' + r.class].filter(Boolean).join(' · '))}</small></div>
    <div class="oar-meta"><span class="oar-chip">${esc(date(r.at))}</span>${r.valuePaise ? `<span class="oar-chip info">${inr(r.valuePaise / 100)} off</span>` : ''}</div></div>`).join('') || '<div class="oar-empty">Not used yet.</div>'}</div>`;
  $('onaModal').hidden = false; document.documentElement.style.overflow = 'hidden'; $('onaModalClose').focus();
}

function show(next) {
  view = next;
  document.querySelectorAll('[data-ona-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.onaView === view)));
  $('onaStudents').hidden = view !== 'students'; $('onaPayments').hidden = view !== 'payments'; $('onaPromos').hidden = view !== 'promos';
  // Each list's search/filter panel sits outside its host: drop the ones for hidden views.
  if (view !== 'students') window.PortalUI.clearBrowser($('onaStudents'));
  if (view !== 'payments') window.PortalUI.clearBrowser($('onaPayments'));
  if (data) (view === 'students' ? studentsView : view === 'promos' ? promosView : paymentsView)();
}

async function refresh() {
  const note = $('onaNotice');
  note.className = 'oar-msg'; note.textContent = data ? 'Refreshing…' : '';
  if (!data) $('onaStudents').innerHTML = '<div class="oar-empty">Loading online students…</div>';
  try {
    data = await load();
    note.textContent = '';
    kpis(); show(view);
  } catch (e) {
    note.className = 'oar-msg err';
    note.textContent = 'Could not load online students: ' + (e.message || e) + ' If this says "permission", publish the latest firestore.rules.';
  }
}

export function loadOnlineStudents(context) {
  ctx = context;
  if (!bound) {
    bound = true;
    $('onaRefresh').onclick = refresh;
    $('onaExport').onclick = exportCsv;
    document.addEventListener('click', e => {
      const v = e.target.closest && e.target.closest('[data-ona-view]'); if (v) return show(v.dataset.onaView);
      const o = e.target.closest && e.target.closest('[data-ona-open]'); if (o) return openStudent(o.dataset.onaOpen, o);
      const pt = e.target.closest && e.target.closest('[data-promo-toggle]'); if (pt) return togglePromo(pt.dataset.promoToggle, pt);
      const pf = e.target.closest && e.target.closest('[data-pfor]'); if (pf) { promoFor = data.students.find(x => x.id === pf.dataset.pfor) || null; return renderFor(); }
      const pfc = e.target.closest && e.target.closest('[data-pfor-clear]'); if (pfc) { promoFor = null; renderFor(); return $('onaPFor') && $('onaPFor').focus(); }
      const pg = e.target.closest && e.target.closest('[data-pfor-give]'); if (pg) {
        promoFor = data.students.find(x => x.id === pg.dataset.pforGive) || null; closeStudent(); show('promos');
        const box = $('onaPromoBox'); if (box) { box.open = true; box.scrollIntoView({ block: 'start' }); }
        return;
      }
      const pu = e.target.closest && e.target.closest('[data-promo-uses]'); if (pu) return promoUses(pu.dataset.promoUses, pu);
      const pc = e.target.closest && e.target.closest('[data-promo-copy]');
      if (pc) { navigator.clipboard?.writeText(pc.dataset.promoCopy).then(() => { pc.textContent = 'Copied'; setTimeout(() => { pc.textContent = 'Copy'; }, 1500); }, () => {}); }
    });
    $('onaModalClose').onclick = closeStudent;
    $('onaModal').addEventListener('click', e => { if (e.target.id === 'onaModal') closeStudent(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStudent(); });
  }
  return refresh();
}
