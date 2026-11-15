/* Admin → Test Desk. The one place to run the test series (online + offline):
     To check  answer scripts students uploaded, oldest first. Open one →
               download the script → upload the checked PDF + marks → send back.
     Checked   everything already returned (marks, feedback, PDFs).
     Papers    every question paper; publish a new one, close or reopen.
     Students  who wrote how many tests, with averages; open one for their scripts.
     To make   everything you have to create: Custom module requests (chapters
               listed, unlocks for that student only) and mock-pack mocks due
               within a week (reminders start 3 days before they open).
     Packages  weekly mock packs: create (8 mocks ₹3199, 4 mocks ₹1699 or your
               own), see the schedule, upload each mock, pause selling.
   Any record can be deleted permanently from its sheet (typed confirmation).
   A watcher keeps a blinking count on the menu, the bottom tab and the Home
   notice until every waiting script has been checked and sent back.
   Uses the same server actions as the teacher review desk (offline-test.js). */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R = () => window.NTCOfflineRecords, F = () => window.NTCOfflineFiles, U = () => window.NTCUploadcare, P = () => window.NTCOnlinePolicy;
const phone = () => matchMedia('(max-width:700px)').matches;
const HOUR = 3600000;
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'), x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  down: svg('<path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'), up: svg('<path d="M12 15V4.5M7.5 9 12 4.5 16.5 9M5 15v4.5h14V15"/>'),
  chev: svg('<path d="M9 5l7 7-7 7"/>'), check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), doc: svg('<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20zM14 3.5V8h4M9.5 12.5h5M9.5 16h5"/>'),
  clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'), send: svg('<path d="M4 12 20 4l-6 16-3-7z"/>'), refresh: svg('<path d="M19 12a7 7 0 1 1-2.1-5M19 4.5V9h-4.5"/>'),
  inbox: svg('<path d="M4 13.5 6.5 5h11L20 13.5V19H4zM4 13.5h4.5l1 2.5h5l1-2.5H20"/>'),
  cal: svg('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16M8.5 14h2M13.5 14h2M8.5 17h2"/>')
};

let ctx = null, bound = false, pollTimer = 0;
const S = { loaded: false, loading: false, reports: [], tests: [], teachers: [], requests: [], packages: [], pendingRequests: 0, pendingCustom: 0, pendingSlots: 0, tab: 'inbox', q: '', series: '', cls: '', subject: '', page: 0, sheet: null, sending: false, opener: null };

// ── Network ──
const base = () => `https://firestore.googleapis.com/v1/projects/${ctx.config.projectId}/databases/(default)/documents`;
const auth = async extra => ({ Authorization: 'Bearer ' + await ctx.token(), ...(extra || {}) });
const str = (f, k) => (f[k] && f[k].stringValue) || '';
async function patch(path, fields) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const res = await fetch(`${base()}/${path}?key=${ctx.config.apiKey}&${mask}`, { method: 'PATCH', headers: await auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ fields }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error((json.error && json.error.message) || 'Could not save. Please try again.');
}
async function readDoc(path) {
  const res = await fetch(`${base()}/${path}?key=${ctx.config.apiKey}`, { headers: await auth() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error('Could not confirm the saved paper. Please retry.');
  return json;
}
async function commit(records) {
  const writes = records.map(({ path, fields, currentDocument, mask }) => ({
    update: { name: base().replace('https://firestore.googleapis.com/v1/', '') + '/' + path, fields },
    ...(currentDocument ? { currentDocument } : {}), ...(mask ? { updateMask: { fieldPaths: mask } } : {})
  }));
  const res = await fetch(`${base()}:commit?key=${ctx.config.apiKey}`, { method: 'POST', headers: await auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ writes }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error('Could not confirm publication. Retry safely to check or finish sending this paper.');
}
async function api(body) {
  const res = await fetch('/.netlify/functions/offline-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await ctx.token(), ...body }) });
  let data = {}; try { data = await res.json(); } catch (_) {}
  if ([404, 405].includes(res.status) && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Sending back needs Netlify Dev here: run "npx netlify-cli dev" and open http://localhost:8888/command-center.');
  if (!res.ok) throw new Error(data.error || `Could not send (${res.status}). Please try again.`);
  return data;
}
async function pendingCount(collectionId, status) {
  const res = await fetch(`${base()}:runAggregationQuery?key=${ctx.config.apiKey}`, { method: 'POST', headers: await auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: collectionId || 'offlineReports' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: status || 'submitted' } } } }, aggregations: [{ alias: 'n', count: {} }] } }) });
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) throw new Error('count failed');
  return Number(json[0] && json[0].result && json[0].result.aggregateFields && json[0].result.aggregateFields.n && json[0].result.aggregateFields.n.integerValue) || 0;
}
async function loadAll() {
  const headers = await auth(), key = ctx.config.apiKey, list = url => window.PortalUI.fetchList(url, { headers });
  const [reports, tests, keys, teachers, requests, packages] = await Promise.all([
    list(R().listUrl(ctx.config.projectId, key)),
    list(`${base()}/offlineTests?key=${key}&pageSize=300`),
    list(`${base()}/offlineTestKeys?key=${key}&pageSize=300&mask.fieldPaths=questionPdfUrl`).catch(() => ({ documents: [] })),
    list(`${base()}/teachers?key=${key}&pageSize=300&mask.fieldPaths=name`).catch(() => ({ documents: [] })),
    list(`${base()}/moduleRequests?key=${key}&pageSize=300`).catch(() => ({ documents: [] })),
    list(`${base()}/mockPackages?key=${key}&pageSize=300`).catch(() => ({ documents: [] }))
  ]);
  S.packages = (packages.documents || []).map(d => { const f = d.fields || {}; return { id: d.name.split('/').pop(), title: str(f, 'title'), class: str(f, 'class'), board: str(f, 'board'), subject: str(f, 'subject'),
    schedule: ((f.schedule && f.schedule.arrayValue && f.schedule.arrayValue.values) || []).map(v => v.stringValue || ''), priceInr: Number((f.priceInr && (f.priceInr.integerValue ?? f.priceInr.doubleValue)) || 0),
    active: !f.active || f.active.booleanValue !== false, description: str(f, 'description'), createdAt: str(f, 'createdAt') }; })
    .sort((a, b) => (b.active - a.active) || (a.schedule[0] || '').localeCompare(b.schedule[0] || ''));
  S.requests = (requests.documents || []).map(d => { const f = d.fields || {}, o = { id: d.name.split('/').pop() }; for (const k in f) o[k] = f[k].arrayValue ? (f[k].arrayValue.values || []).map(v => v.stringValue || '') : (f[k].stringValue ?? f[k].booleanValue ?? (f[k].integerValue != null ? Number(f[k].integerValue) : f[k].doubleValue)); return o; });
  recountMake();
  const papers = Object.fromEntries((keys.documents || []).map(d => [d.name.split('/').pop(), U().deliveryUrl(str(d.fields || {}, 'questionPdfUrl'))]));
  S.reports = (reports.documents || []).map(d => R().parse(d)).filter(r => r.scriptPdfUrl);
  S.tests = (tests.documents || []).map(d => { const f = d.fields || {}, id = d.name.split('/').pop(), online = str(f, 'series') === 'online';
    return { id, name: str(f, 'testName') || 'Test', class: str(f, 'class') || '—', board: str(f, 'board'), subject: window.PortalUI.subject(str(f, 'subject')), chapter: str(f, 'chapter') || 'General', module: str(f, 'module') || 'Full chapter',
      totalMarks: Number((f.totalMarks && (f.totalMarks.doubleValue ?? f.totalMarks.integerValue)) || 0), durationMin: Number((f.durationMin && f.durationMin.integerValue) || 0),
      teacher: str(f, 'teacherName') || '—', teacherUid: str(f, 'teacherUid'), isActive: !f.isActive || f.isActive.booleanValue !== false, createdAt: str(f, 'createdAt'),
      series: online ? 'Online' : 'Offline', kind: online ? P().kindOf({ kind: str(f, 'kind'), chapter: str(f, 'chapter'), testName: str(f, 'testName') }) : '', paper: papers[id] || '', forUid: str(f, 'forUid'), packageId: str(f, 'packageId'), slot: Number((f.slot && f.slot.integerValue) || 0), releaseAt: str(f, 'releaseAt') }; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  S.teachers = (teachers.documents || []).map(d => ({ uid: d.name.split('/').pop(), name: str(d.fields || {}, 'name') || 'Teacher' })).sort((a, b) => a.name.localeCompare(b.name));
  S.loaded = true;
}

// ── Derived lists ──
const inbox = () => S.reports.filter(r => r.stage === 'pending').sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));
const done = () => S.reports.filter(r => r.stage === 'returned').sort((a, b) => (b.approvedAt || '').localeCompare(a.approvedAt || ''));
function rowsFor(tab) {
  const q = S.q.trim().toLowerCase();
  const hit = (r, text) => (!S.series || r.series === S.series) && (!S.cls || String(r.class) === S.cls) && (!S.subject || r.subject === S.subject) && (!q || text.toLowerCase().includes(q));
  if (tab === 'papers') return S.tests.filter(t => hit(t, `${t.name} ${t.subject} ${t.chapter} ${t.teacher} class ${t.class}`));
  if (tab === 'requests') {
    const custom = S.requests.filter(r => (!S.series || S.series === 'Online') && (!S.cls || String(r.class) === S.cls) && (!S.subject || r.subject === S.subject)
      && (!q || `${r.studentName} ${r.onlineId} ${r.subject} ${(r.chapters || []).join(' ')} class ${r.class}`.toLowerCase().includes(q))).map(r => ({ ...r, type: 'custom' }));
    const slots = dueSlots(7).filter(s => (!S.series || S.series === 'Online') && (!S.cls || String(s.class) === S.cls) && (!S.subject || s.subject === S.subject)
      && (!q || `${s.pkg.title} ${s.subject} mock ${s.n} class ${s.class}`.toLowerCase().includes(q)));
    const waiting = r => r.type === 'slot' || r.status === 'requested';
    return [...slots, ...custom].sort((a, b) => (waiting(a) ? 0 : 1) - (waiting(b) ? 0 : 1) || (waiting(a) ? (a.dueAt || '').localeCompare(b.dueAt || '') : (b.readyAt || '').localeCompare(a.readyAt || '')));
  }
  if (tab === 'packages') return S.packages.filter(p => (!S.series || S.series === 'Online') && (!S.cls || String(p.class) === S.cls) && (!S.subject || p.subject === S.subject)
    && (!q || `${p.title} ${p.subject} class ${p.class}`.toLowerCase().includes(q)));
  if (tab === 'students') return R().students(S.reports.filter(r => !S.series || r.series === S.series))
    .filter(s => (!S.cls || String(s.class) === S.cls) && (!S.subject || s.subjectNames.includes(S.subject)) && (!q || `${s.studentName} ${s.studentId} class ${s.class}`.toLowerCase().includes(q)))
    .sort((a, b) => b.pending - a.pending || a.studentName.localeCompare(b.studentName));
  return (tab === 'inbox' ? inbox() : done()).filter(r => hit(r, `${r.studentName} ${r.studentId} ${r.test} ${r.subject} ${r.chapter} class ${r.class}`));
}
const initials = n => (String(n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function ago(v) { const ms = Date.now() - Date.parse(v); if (!Number.isFinite(ms)) return ''; const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; }
function due(r) {
  const left = Date.parse(r.dueAt) - Date.now();
  if (!Number.isFinite(left)) return '';
  if (left < 0) return `<span class="dk-pill bad">Overdue ${Math.max(1, Math.round(-left / HOUR))}h</span>`;
  return `<span class="dk-pill ${left < 12 * HOUR ? 'warn' : ''}">Due in ${Math.max(1, Math.round(left / HOUR))}h</span>`;
}
const day = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const kindLabel = t => t.series === 'Online' ? (t.kind === 'mock' ? 'Online · Full mock' : t.kind === 'custom' ? 'Online · Custom' : t.kind === 'package' ? 'Online · Pack mock' : 'Online · Chapter-wise') : 'Offline';
// ── Mock packs: weekly mocks; a slot without a paper is "to make" from 7 days out,
// and counts in the blinking reminder from PACK_REMIND_DAYS (3) days before it opens.
const DAYMS = 86400000;
const ist = { date: v => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), time: v => new Date(v).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) };
const when = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const weekly = (p, short) => { const d = new Date(p.schedule[0] || ''); return Number.isNaN(d.getTime()) ? '' : `Every ${d.toLocaleDateString('en-IN', { weekday: short ? 'short' : 'long' })} · ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`; };
function packSlots(p) { return p.schedule.map((at, i) => { const t = S.tests.find(x => x.packageId === p.id && Number(x.slot) === i + 1); return { n: i + 1, at: (t && t.releaseAt) || at, t }; }); }
function dueSlots(days) {
  return S.packages.filter(p => p.active).flatMap(p => packSlots(p).filter(s => !s.t && Date.parse(s.at) - Date.now() <= days * DAYMS)
    .map(s => ({ type: 'slot', id: p.id + '#' + s.n, pkg: p, n: s.n, at: s.at, dueAt: s.at, subject: p.subject, class: p.class })));
}
function recountMake() {
  S.pendingCustom = S.requests.filter(r => r.status === 'requested').length;
  S.pendingSlots = dueSlots(P().PACK_REMIND_DAYS).length;
  S.pendingRequests = S.pendingCustom + S.pendingSlots;
}
function slotPill(s) {
  if (s.t) return Date.parse(s.at) > Date.now() ? '<span class="dk-pill ok">Uploaded</span>' : '<span class="dk-pill ok">Open</span>';
  const left = Date.parse(s.at) - Date.now();
  if (left < 0) return '<span class="dk-pill bad">Overdue</span>';
  if (left <= P().PACK_REMIND_DAYS * DAYMS) return `<span class="dk-pill warn">Due in ${left < DAYMS ? Math.max(1, Math.round(left / 3600000)) + 'h' : Math.round(left / DAYMS) + 'd'}</span>`;
  return '<span class="dk-pill">Upcoming</span>';
}
async function runQuery(collectionId, field, value) {
  const res = await fetch(`${base()}:runQuery?key=${ctx.config.apiKey}`, { method: 'POST', headers: await auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } }) });
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) throw new Error('Could not load.');
  return json.filter(x => x.document).map(x => x.document);
}
// Before the desk is opened: how many pack mocks are due (for the blinking count).
async function packageDueCount() {
  const headers = await auth(), key = ctx.config.apiKey;
  const [packs, tests] = await Promise.all([window.PortalUI.fetchList(`${base()}/mockPackages?key=${key}&pageSize=300`, { headers }), runQuery('offlineTests', 'kind', 'package')]);
  const have = new Set(tests.map(d => { const f = d.fields || {}; return str(f, 'packageId') + '#' + ((f.slot && f.slot.integerValue) || ''); }));
  let n = 0;
  (packs.documents || []).forEach(d => { const f = d.fields || {}, id = d.name.split('/').pop();
    if (f.active && f.active.booleanValue === false) return;
    ((f.schedule && f.schedule.arrayValue && f.schedule.arrayValue.values) || []).forEach((v, i) => { if (!have.has(id + '#' + (i + 1)) && Date.parse(v.stringValue) - Date.now() <= P().PACK_REMIND_DAYS * DAYMS) n++; }); });
  return n;
}

// ── Blinking count everywhere ──
// n = scripts to check; custom papers to make are added on top.
function setBadge(scripts) {
  const papers = S.pendingCustom || 0, slots = S.pendingSlots || 0, n = scripts + papers + slots;
  document.body.dataset.deskPending = n ? '1' : '0';
  // The number lives in data-count (drawn by CSS) so it never leaks into menu labels or breadcrumbs.
  document.querySelectorAll('[data-desk-badge]').forEach(el => { el.dataset.count = n > 99 ? '99+' : String(n); el.setAttribute('aria-label', n + ' waiting'); el.hidden = !n; });
  const note = $('deskNotice');
  if (note) { note.hidden = !n || document.body.dataset.activeSection === 'test-desk';
    $('deskNoticeText').textContent = [scripts ? `${scripts} answer script${scripts === 1 ? '' : 's'} to check` : '', papers ? `${papers} custom paper${papers === 1 ? '' : 's'} to make` : '', slots ? `${slots} pack mock${slots === 1 ? '' : 's'} to upload` : ''].filter(Boolean).join(' · '); }
}
// Every minute: a cheap count. When it changes, the desk reloads its lists so a
// new script appears (and the count starts blinking) without a refresh.
async function poll() {
  if (!ctx || document.hidden || S.sending) return;
  try {
    const [n, made] = await Promise.all([pendingCount(), pendingCount('moduleRequests', 'requested').catch(() => S.pendingCustom)]);
    if (!S.loaded) { S.pendingCustom = made; S.pendingSlots = await packageDueCount().catch(() => 0); S.pendingRequests = S.pendingCustom + S.pendingSlots; return setBadge(n); }
    // Reload the full lists only while Test Desk is on screen; elsewhere just update the
    // blinking count (opening Test Desk always loads fresh). Keeps database reads low.
    if (!document.querySelector('#tab-test-desk.active')) { S.pendingCustom = made; S.pendingRequests = made + (S.pendingSlots || 0); return setBadge(n); }
    if ((n !== inbox().filter(r => r.status === 'submitted').length || made !== S.pendingCustom) && $('dkSheet').hidden) { await loadAll(); render(); }
    recountMake(); if ($('dkN-requests')) { $('dkN-requests').textContent = S.pendingRequests; $('dkN-requests').classList.toggle('blink', S.pendingRequests > 0); }
    setBadge(inbox().length);
  } catch (_) {}
}
function ensureBadges() {
  const tab = document.querySelector('.portal-bottom-nav [data-section="test-desk"]');
  if (tab && !tab.querySelector('[data-desk-badge]')) { const b = document.createElement('b'); b.className = 'desk-badge'; b.dataset.deskBadge = ''; b.hidden = true; tab.append(b); }
}

// ── Render ──
function shell() {
  const host = $('deskRoot');
  if (host.dataset.ready) return;
  host.dataset.ready = '1';
  host.innerHTML = `
    <header class="dk-head"><div><span class="dk-eyebrow">Test Desk</span><h2>Papers &amp; answer scripts</h2></div>
      <div class="dk-head-act"><button type="button" class="dk-icon" id="dkRefresh" aria-label="Refresh">${I.refresh}</button><button type="button" class="dk-btn primary" id="dkNew">${I.plus}<span>New paper</span></button></div></header>
    <div class="dk-stats" id="dkStats" aria-live="polite"></div>
    <div class="dk-seg" role="tablist" aria-label="Test Desk views">
      <button type="button" role="tab" data-dk-tab="inbox">To check <b id="dkN-inbox">0</b></button>
      <button type="button" role="tab" data-dk-tab="requests">To make <b id="dkN-requests">0</b></button>
      <button type="button" role="tab" data-dk-tab="packages">Packages <b id="dkN-packages">0</b></button>
      <button type="button" role="tab" data-dk-tab="done">Checked <b id="dkN-done">0</b></button>
      <button type="button" role="tab" data-dk-tab="papers">Papers <b id="dkN-papers">0</b></button>
      <button type="button" role="tab" data-dk-tab="students">Students <b id="dkN-students">0</b></button></div>
    <div class="dk-tools">
      <label class="dk-search">${I.search}<input type="search" id="dkSearch" placeholder="Search student, ID or test" aria-label="Search student, ID or test" autocomplete="off"></label>
      <div class="dk-filters"><select id="dkSeries" aria-label="Series"><option value="">All series</option><option>Online</option><option>Offline</option></select>
        <select id="dkClass" aria-label="Class"></select><select id="dkSubject" aria-label="Subject"></select></div></div>
    <div class="dk-list" id="dkList" aria-live="polite"></div>
    <div class="dk-pager" id="dkPager"></div>`;
  $('dkRefresh').onclick = () => refresh(true);
  $('dkNew').onclick = openPublish;
  $('dkSearch').oninput = e => { S.q = e.target.value; S.page = 0; list(); };
  $('dkSeries').onchange = e => { S.series = e.target.value; S.page = 0; list(); };
  $('dkClass').onchange = e => { S.cls = e.target.value; S.page = 0; list(); };
  $('dkSubject').onchange = e => { S.subject = e.target.value; S.page = 0; list(); };
  host.addEventListener('click', e => {
    const tab = e.target.closest('[data-dk-tab]'); if (tab) { S.tab = tab.dataset.dkTab; S.page = 0; return render(); }
    const np = e.target.closest('[data-dk-newpack]'); if (np) return openNewPack(np);
    const row = e.target.closest('[data-dk-open]'); if (row) return (S.tab === 'papers' ? openPaper : S.tab === 'students' ? openStudent : S.tab === 'requests' ? openRequest : S.tab === 'packages' ? openPack : openScript)(row.dataset.dkOpen, row);
    const pg = e.target.closest('[data-dk-page]'); if (pg) { S.page += Number(pg.dataset.dkPage); list(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  });
}
function render() {
  if (!$('deskRoot')) return;
  shell();
  const sum = R().summary(S.reports);
  const counts = { inbox: inbox().length, requests: S.pendingRequests, packages: S.packages.length, done: done().length, papers: S.tests.length, students: sum.students };
  $('dkStats').innerHTML = [[counts.inbox, 'Waiting', counts.inbox ? 'warn' : ''], [sum.overdue, 'Overdue 48h', sum.overdue ? 'bad' : ''], [counts.done, 'Checked', 'ok'], [sum.average == null ? '—' : sum.average + '%', 'Average', '']]
    .map(([n, label, tone]) => `<div class="${tone}"><b>${esc(n)}</b><span>${label}</span></div>`).join('');
  Object.entries(counts).forEach(([k, n]) => { const el = $('dkN-' + k); el.textContent = n; el.classList.toggle('blink', (k === 'inbox' || k === 'requests') && n > 0); });
  document.querySelectorAll('[data-dk-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.dkTab === S.tab)));
  const src = S.tab === 'papers' ? S.tests : S.reports;
  const options = (id, values, all, label, cur) => { $(id).innerHTML = `<option value="">${all}</option>` + values.map(v => `<option value="${esc(v)}"${String(v) === cur ? ' selected' : ''}>${esc(label(v))}</option>`).join(''); };
  options('dkClass', [...new Set(src.map(r => String(r.class)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), 'All classes', v => 'Class ' + v, S.cls);
  options('dkSubject', [...new Set(src.map(r => r.subject))].sort(), 'All subjects', v => v, S.subject);
  $('dkSearch').placeholder = S.tab === 'papers' ? 'Search paper, chapter or teacher' : S.tab === 'students' ? 'Search student or ID' : S.tab === 'requests' ? 'Search student, subject or chapter' : S.tab === 'packages' ? 'Search pack or subject' : 'Search student, ID or test';
  list();
}
// Lists are grouped by Class · Subject (Students by class). Urgent tabs (To check,
// To make) put the group with the most urgent item first; the rest go by class.
const clsNum = c => { const n = parseInt(c, 10); return Number.isFinite(n) ? n : 99; };
function groupOf(tab, r) {
  const cls = String(r.class || '').trim() || '—';
  return tab === 'students' ? { key: cls, cls, sub: '' } : { key: cls + '|' + (r.subject || ''), cls, sub: r.subject || 'General' };
}
function grouped(tab, all) {
  const urgent = tab === 'inbox' || tab === 'requests', order = new Map();
  all.forEach((r, i) => { const g = groupOf(tab, r); if (!order.has(g.key)) order.set(g.key, { ...g, first: i, n: 0 }); order.get(g.key).n++; });
  const rank = [...order.values()].sort((a, b) => urgent ? a.first - b.first : (clsNum(a.cls) - clsNum(b.cls)) || String(a.cls).localeCompare(String(b.cls)) || a.sub.localeCompare(b.sub));
  const pos = new Map(rank.map((g, i) => [g.key, i]));
  const rows = all.map((r, i) => ({ r, i })).sort((a, b) => (pos.get(groupOf(tab, a.r).key) - pos.get(groupOf(tab, b.r).key)) || a.i - b.i).map(x => x.r);
  return { rows, info: order };
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function rowHtml(tab, r, counts) {
  const open = (id, cls, av, title, sub, side) => `<button type="button" class="dk-row${cls}" data-dk-open="${esc(id)}">${av}<span class="dk-main"><b>${title}</b><small>${sub}</small></span><span class="dk-side">${side}</span>${I.chev}</button>`;
  const person = n => `<span class="dk-av" style="--h:${hue(n)}">${esc(initials(n))}</span>`;
  if (tab === 'papers') {
    const c = counts[r.id] || { total: 0 };
    return open(r.id, '', `<span class="dk-av paper">${I.doc}</span>`, esc(r.name), esc([kindLabel(r), r.chapter, c.total ? plural(c.total, 'script') : ''].filter(Boolean).join(' · ')),
      `<span class="dk-pill ${r.isActive ? 'ok' : ''}">${r.isActive ? 'Live' : 'Closed'}</span>`);
  }
  if (tab === 'packages') {
    const slots = packSlots(r), up = slots.filter(x => x.t).length, next = slots.find(x => !x.t);
    return open(r.id, '', `<span class="dk-av paper">${I.cal}</span>`, esc(r.title), esc(`₹${r.priceInr} · ${weekly(r, true)} · ${up}/${slots.length} uploaded`),
      !r.active ? '<span class="dk-pill">Paused</span>' : next ? slotPill(next) : '<span class="dk-pill ok">All uploaded</span>');
  }
  if (tab === 'requests') {
    if (r.type === 'slot') return open(r.id, Date.parse(r.at) < Date.now() ? ' overdue' : '', `<span class="dk-av paper">${I.cal}</span>`, `Mock ${r.n} of ${r.pkg.schedule.length}`, esc(`Pack · opens ${when(r.at)}`), slotPill(r));
    const late = r.status === 'requested' && Date.parse(r.dueAt) < Date.now();
    return open(r.id, late ? ' overdue' : '', person(r.studentName), esc(r.studentName || 'Student'), esc(`Custom · ${plural(r.chapterCount, 'chapter')} · ${ago(r.createdAt)}`),
      r.status === 'requested' ? due(r) : '<span class="dk-pill ok">Sent</span>');
  }
  if (tab === 'students') {
    return open(r.uid || r.studentId, '', person(r.studentName), esc(r.studentName), esc([r.studentId, plural(r.total, 'test')].filter(Boolean).join(' · ')),
      `<span class="dk-pill score ${r.average == null ? '' : r.average >= 75 ? 'ok' : r.average >= 50 ? 'warn' : 'bad'}">${r.average == null ? '—' : r.average + '%'}</span>`);
  }
  return open(r.id, r.overdue ? ' overdue' : '', person(r.studentName), esc(r.studentName), esc(`${r.test} · ${tab === 'inbox' ? 'sent ' + ago(r.submittedAt) : day(r.approvedAt)}`),
    tab === 'inbox' ? due(r) : `<span class="dk-pill score ${r.pct == null ? '' : r.pct >= 75 ? 'ok' : r.pct >= 50 ? 'warn' : 'bad'}">${r.score == null ? '—' : r.score}/${r.totalMarks}</span>`);
}
function list() {
  const host = $('dkList'), size = phone() ? 8 : 12;
  const { rows: all, info } = grouped(S.tab, rowsFor(S.tab));
  S.page = Math.max(0, Math.min(S.page, Math.ceil(all.length / size) - 1));
  const rows = all.slice(S.page * size, (S.page + 1) * size);
  if (!S.loaded) { host.classList.remove('grouped'); host.innerHTML = Array.from({ length: 4 }, () => '<div class="dk-row sk"><span class="dk-av"></span><span class="dk-main"><b></b><small></small></span></div>').join(''); $('dkPager').innerHTML = ''; return; }
  host.classList.add('grouped');
  const filtered = S.q || S.series || S.cls || S.subject;
  let html = '';
  if (S.tab === 'packages') html += `<div class="dk-group"><div class="dk-rows"><button type="button" class="dk-row dk-add" data-dk-newpack><span class="dk-av paper">${I.plus}</span><span class="dk-main"><b>New mock pack</b><small>8 mocks ₹3199 · 4 mocks ₹1699 · or your own</small></span>${I.chev}</button></div></div>`;
  if (!rows.length) {
    const msg = filtered ? ['Nothing matches', 'Try a different search or clear the filters.']
      : S.tab === 'inbox' ? ['All caught up', 'Every answer script has been checked and sent back.']
      : S.tab === 'done' ? ['No checked scripts yet', 'Scripts you send back appear here with their marks.']
      : S.tab === 'students' ? ['No students yet', 'Students appear here once they submit an answer script.']
      : S.tab === 'requests' ? ['Nothing to make', 'Custom papers and pack mocks due this week appear here.']
      : S.tab === 'packages' ? ['No mock packs yet', 'Create one: a full-syllabus mock every week at a fixed time.'] : ['No papers yet', 'Tap “New paper” to publish your first question paper.'];
    html += `<div class="dk-empty">${S.tab === 'inbox' && !filtered ? I.check : I.inbox}<b>${msg[0]}</b><p>${msg[1]}</p></div>`;
  } else {
    const counts = {}; if (S.tab === 'papers') S.reports.forEach(r => { (counts[r.testId] ||= { total: 0 }).total++; });
    let cur = null, buf = '';
    const flush = () => { if (!cur) return; const g = info.get(cur);
      html += `<section class="dk-group"><header class="dk-gh"><b>${g.cls === '—' ? 'No class' : 'Class ' + esc(g.cls)}</b>${g.sub ? `<span>${esc(g.sub)}</span>` : ''}<i>${g.n}</i></header><div class="dk-rows">${buf}</div></section>`; buf = ''; };
    rows.forEach(r => { const k = groupOf(S.tab, r).key; if (k !== cur) { flush(); cur = k; } buf += rowHtml(S.tab, r, counts); });
    flush();
  }
  host.innerHTML = html;
  const from = all.length ? S.page * size + 1 : 0, to = Math.min(all.length, (S.page + 1) * size);
  const unit = S.tab === 'students' ? 'student' : S.tab === 'papers' ? 'paper' : S.tab === 'requests' ? 'item' : S.tab === 'packages' ? 'pack' : 'script';
  $('dkPager').innerHTML = all.length > size
    ? `<span>${from}–${to} of ${all.length}</span><div><button type="button" data-dk-page="-1" aria-label="Previous page" ${S.page ? '' : 'disabled'}>‹</button><button type="button" data-dk-page="1" aria-label="Next page" ${to < all.length ? '' : 'disabled'}>›</button></div>`
    : `<span>${all.length} ${unit}${all.length === 1 ? '' : 's'}</span>`;
}

// ── Sheet ──
function openSheet(title, kicker, html, opener) {
  S.opener = opener || document.activeElement;
  $('dkSheetKicker').textContent = kicker; $('dkSheetTitle').textContent = title; $('dkSheetBody').innerHTML = html;
  const back = $('dkSheet'); back.hidden = false; document.documentElement.style.overflow = 'hidden';
  requestAnimationFrame(() => back.classList.add('on'));
  setTimeout(() => $('dkSheetClose').focus({ preventScroll: true }), 60);
}
function closeSheet() {
  const back = $('dkSheet'); if (!back || back.hidden || S.sending) return;
  back.classList.remove('on'); document.documentElement.style.overflow = '';
  setTimeout(() => { if (!back.classList.contains('on')) { back.hidden = true; $('dkSheetBody').innerHTML = ''; } }, 200);
  if (S.opener && document.contains(S.opener)) S.opener.focus({ preventScroll: true });
}
function toast(msg, bad) {
  const el = $('dkToast'); el.textContent = msg; el.className = 'dk-toast on' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = 'dk-toast' + (bad ? ' bad' : ''); }, bad ? 5200 : 3200);
}
const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd></div>`;
const fileName = (r, tail) => `${r.studentName}_${r.studentId || 'student'}_${r.test}${tail || ''}.pdf`.replace(/[^\w.-]+/g, '_');
// Permanent delete, collapsed and locked until the student's ID is typed.
const deleteBlock = r => `<details class="dk-danger"><summary>Delete this record permanently</summary>
  <p>Removes this answer script, the checked PDF, marks and feedback from the student's results. The question paper stays. This cannot be undone.</p>
  <label>Type <b>${esc(r.studentId || 'DELETE')}</b> to confirm<input id="dkDelConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
  <button type="button" class="dk-btn danger" id="dkDelete" disabled>Delete permanently</button></details>`;
function bindDelete(r) {
  const input = $('dkDelConfirm'), btn = $('dkDelete'); if (!input) return;
  const want = (r.studentId || 'DELETE').trim().toLowerCase();
  input.oninput = () => { btn.disabled = input.value.trim().toLowerCase() !== want; };
  btn.onclick = async () => {
    if (S.sending) return;
    S.sending = true; btn.disabled = true; input.disabled = true;
    const msg = $('dkMsg'); msg.className = 'dk-msg'; msg.textContent = 'Deleting…';
    const gone = note => { S.reports = S.reports.filter(x => x.id !== r.id); S.sending = false; closeSheet(); render(); setBadge(inbox().length); toast(note); };
    try {
      const res = await api({ action: 'delete-record', attemptId: r.id });
      gone(res.filesFailed ? `Record deleted. ${res.filesFailed} uploaded file${res.filesFailed === 1 ? '' : 's'} could not be removed from storage.` : `Deleted ${r.studentName}'s ${r.test}`);
    } catch (e) {
      if (/already been deleted/.test(e.message)) return gone('That record was already deleted');
      S.sending = false; input.disabled = false; btn.disabled = false;
      msg.className = 'dk-msg bad'; msg.textContent = e.message + ' Nothing was deleted.';
    }
  };
}

function openScript(id, opener) {
  const r = S.reports.find(x => x.id === id); if (!r) return;
  const facts = `<dl class="dk-facts">${fact('Student', r.studentName)}${fact('ID', r.studentId)}${fact('Class', 'Class ' + r.class + (r.board ? ' · ' + r.board : ''))}${fact('Series', r.series)}
    ${fact('Subject', r.subject)}${fact('Chapter', r.chapter)}${fact('Submitted', day(r.submittedAt) + ' · ' + ago(r.submittedAt))}${fact(r.stage === 'returned' ? 'Checked by' : 'Teacher', r.stage === 'returned' ? r.teacher : r.assignedTeacher)}</dl>`;
  if (r.stage === 'returned') {
    openSheet(r.test, 'Checked script', `${facts}
      <div class="dk-score ${r.pct == null ? '' : r.pct >= 75 ? 'ok' : r.pct >= 50 ? 'warn' : 'bad'}"><b>${r.score == null ? '—' : r.score}<small> / ${r.totalMarks}</small></b><span>${r.pct == null ? '' : r.pct + '%'} · returned ${esc(day(r.approvedAt))}</span></div>
      ${r.remark ? `<p class="dk-note">${esc(r.remark)}</p>` : ''}
      <div class="dk-actions">${r.checkedScriptUrl ? `<a class="dk-btn primary" href="${esc(r.checkedScriptUrl)}" target="_blank" rel="noopener">${I.doc}<span>Checked script</span></a>` : ''}<a class="dk-btn" href="${esc(r.scriptPdfUrl)}" target="_blank" rel="noopener">${I.doc}<span>Student's script</span></a></div>
      <p class="dk-msg" id="dkMsg" role="status"></p>${deleteBlock(r)}`, opener);
    bindDelete(r);
    return;
  }
  const busyCheck = ['checking', 'grading'].includes(r.status);
  const teacherOptions = S.teachers.map(t => `<option value="${esc(t.uid)}"${t.uid === r.assignedTeacherUid ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  openSheet(r.test, r.overdue ? 'Overdue · check now' : 'Check & send back', `${facts}
    ${r.lateByMin > 15 ? `<p class="dk-note warn">Submitted ${r.lateByMin} minutes late.</p>` : ''}
    <ol class="dk-steps">
      <li><span>1</span><div><b>Download the answer script</b><small>Opens as ${esc(fileName(r))}</small>
        <button type="button" class="dk-btn" id="dkDownload">${I.down}<span>Download script</span></button></div></li>
      <li><span>2</span><div><b>Upload the checked script</b><small>One PDF with your marking</small>
        <label class="dk-file" id="dkFileBox"><input type="file" id="dkChecked" accept="application/pdf,.pdf">${I.up}<span id="dkFileName">Choose checked PDF</span></label></div></li>
      <li><span>3</span><div><b>Marks &amp; feedback</b>
        <div class="dk-grid"><label>Marks (out of ${esc(r.totalMarks)})<input type="number" id="dkScore" min="0" max="${esc(r.totalMarks)}" step="0.5" inputmode="decimal" placeholder="e.g. ${Math.round(r.totalMarks * 0.8)}"></label>
          <label>Shown as checked by<select id="dkTeacher"><option value="">Choose teacher</option>${teacherOptions}</select></label></div>
        <label class="dk-full">Feedback for the student (optional)<textarea id="dkRemark" rows="2" maxlength="3000" placeholder="What went well, what to fix next time"></textarea></label></div></li>
    </ol>
    <p class="dk-msg" id="dkMsg" role="status"></p>${deleteBlock(r)}
    <div class="dk-actions sticky"><button type="button" class="dk-btn" data-dk-close>Cancel</button><button type="button" class="dk-btn primary" id="dkSend" ${busyCheck ? 'disabled' : ''}>${I.send}<span>Send back to student</span></button></div>`, opener);
  bindDelete(r);
  $('dkDownload').onclick = async e => { const b = e.currentTarget; b.disabled = true; try { await F().downloadPdf(r.scriptPdfUrl, fileName(r)); } catch (err) { window.open(r.scriptPdfUrl, '_blank', 'noopener'); } finally { b.disabled = false; } };
  $('dkChecked').onchange = e => { const f = e.target.files[0]; $('dkFileName').textContent = f ? f.name : 'Choose checked PDF'; $('dkFileBox').classList.toggle('has', !!f); };
  $('dkSend').onclick = () => sendBack(r);
}
async function sendBack(r) {
  if (S.sending) return;
  const msg = $('dkMsg'), btn = $('dkSend'), file = $('dkChecked').files[0], raw = $('dkScore').value.trim(), score = Number(raw), teacher = $('dkTeacher').value;
  const say = (t, cls) => { msg.textContent = t; msg.className = 'dk-msg' + (cls ? ' ' + cls : ''); };
  if (!file) return say('Choose the checked script PDF first.', 'bad');
  if (raw === '' || !Number.isFinite(score) || score < 0 || score > r.totalMarks) return say(`Enter marks between 0 and ${r.totalMarks}.`, 'bad');
  if (!teacher) return say('Choose the teacher shown as the checker.', 'bad');
  S.sending = true; btn.disabled = true;
  try {
    say('Reading the PDF…'); await F().validateReadablePdf(file);
    if (!S.sheet || S.sheet.file !== file) S.sheet = { file, url: '' };
    if (!S.sheet.url) S.sheet.url = await F().upload(file, p => say(`Uploading checked script… ${Math.round(p * 100)}%`));
    say('Sending to the student…');
    const remark = $('dkRemark').value.trim();
    await api({ action: 'return-script', attemptId: r.id, checkedScriptUrl: S.sheet.url, score, remark, onBehalfOf: teacher });
    Object.assign(r, { status: 'approved', stage: 'returned', stageLabel: 'Returned', score, pct: r.totalMarks > 0 ? Math.round(score / r.totalMarks * 100) : null, remark, overdue: false,
      checkedScriptUrl: U().deliveryUrl(S.sheet.url), approvedAt: new Date().toISOString(), teacher: (S.teachers.find(t => t.uid === teacher) || {}).name || r.assignedTeacher });
    S.sheet = null; S.sending = false;
    closeSheet(); render(); setBadge(inbox().length);
    toast(`Sent back to ${r.studentName} · ${score}/${r.totalMarks}`);
  } catch (e) {
    S.sending = false; btn.disabled = false;
    say((e.message || 'Could not send.') + ' Nothing was sent — tap Send back again.', 'bad');
  }
}

function openStudent(key, opener) {
  const mine = S.reports.filter(r => (r.uid || r.studentId) === key).sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  const s = R().students(mine)[0]; if (!s) return;
  openSheet(s.studentName, 'Student · test series', `<dl class="dk-facts">${fact('ID', s.studentId)}${fact('Class', 'Class ' + s.class + (s.board ? ' · ' + s.board : ''))}${fact('Tests given', s.total)}${fact('Average', s.average == null ? '—' : s.average + '%')}
      ${s.subjects.map(x => fact(x.subject, `${x.count} test${x.count === 1 ? '' : 's'}${x.average == null ? '' : ' · ' + x.average + '%'}`)).join('')}</dl>
    <div class="dk-list in-sheet">${mine.map(r => `<button type="button" class="dk-row" data-dk-script="${esc(r.id)}">
      <span class="dk-main"><b>${esc(r.test)}</b><small>${esc(r.subject)} · ${esc(r.chapter)} · ${esc(day(r.submittedAt))}</small></span>
      <span class="dk-side">${r.stage === 'returned' ? `<span class="dk-pill score ${r.pct == null ? '' : r.pct >= 75 ? 'ok' : r.pct >= 50 ? 'warn' : 'bad'}">${r.score == null ? '—' : r.score}/${r.totalMarks}</span>` : '<span class="dk-pill warn">To check</span>'}</span>${I.chev}</button>`).join('')}</div>`, opener);
}

// A Custom module request: make the paper for exactly these chapters, upload,
// and it unlocks for this student only (forUid). Marks the request ready.
function openRequest(id, opener) {
  if (String(id).includes('#')) { const [pid, n] = id.split('#'); return openSlot(pid, Number(n), opener); }
  const r = S.requests.find(x => x.id === id); if (!r) return;
  const facts = `<dl class="dk-facts">${fact('Student', r.studentName)}${fact('ID', r.onlineId)}${fact('Class', 'Class ' + r.class + ' · ' + (r.boardLabel || ''))}${fact('Subject', r.subject)}
    ${fact('Chapters', r.chapterCount)}${fact('Paid', r.enrolled ? 'Free (TNC student)' : '₹' + Math.round((r.amountPaise || 0) / 100))}${fact('Ordered', day(r.createdAt) + ' · ' + ago(r.createdAt))}${fact(r.status === 'requested' ? 'Due' : 'Sent', day(r.status === 'requested' ? r.dueAt : r.readyAt))}</dl>
    <div class="dk-chapters"><b>Chapters to cover</b><ol>${(r.chapters || []).map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>`;
  if (r.status !== 'requested') {
    const t = S.tests.find(x => x.id === r.testId);
    openSheet(`Custom · ${r.subject}`, 'Paper sent', `${facts}<div class="dk-actions">${t && t.paper ? `<a class="dk-btn" href="${esc(t.paper)}" target="_blank" rel="noopener">${I.doc}<span>Question paper</span></a>` : ''}</div>`, opener);
    return;
  }
  const opt = list => list.map(t => `<option value="${esc(t.uid)}">${esc(t.name)}</option>`).join('');
  openSheet(`Custom · ${r.subject}`, Date.parse(r.dueAt) < Date.now() ? 'Overdue · make the paper' : 'Make the paper', `${facts}
    <div class="dk-form">
      <label class="dk-full">Publish as teacher<select id="dkrTeacher"><option value="">Choose teacher</option>${opt(S.teachers)}</select><small>The student sees this teacher's name.</small></label>
      <label class="dk-full">Test name<input id="dkrName" maxlength="120" value="${esc('Custom module · ' + r.subject)}"></label>
      <label>Maximum marks<input id="dkrMarks" type="number" min="1" max="500" inputmode="numeric" placeholder="${r.chapterCount * 10}"></label>
      <label>Time (minutes)<input id="dkrTime" type="number" min="5" max="600" inputmode="numeric" placeholder="${Math.min(180, 30 + r.chapterCount * 15)}"></label>
      <label class="dk-full">Instructions (optional)<input id="dkrNote" maxlength="500" placeholder="e.g. Attempt all questions"></label>
      <label class="dk-file dk-full" id="dkrFileBox"><input type="file" id="dkrFile" accept="application/pdf,.pdf">${I.up}<span id="dkrFileName">Choose question paper PDF</span></label>
    </div>
    <p class="dk-msg" id="dkMsg" role="status"></p>
    <div class="dk-actions sticky"><button type="button" class="dk-btn" data-dk-close>Cancel</button><button type="button" class="dk-btn primary" id="dkrSend">${I.send}<span>Send paper to student</span></button></div>`, opener);
  $('dkrFile').onchange = e => { const f = e.target.files[0]; $('dkrFileName').textContent = f ? f.name : 'Choose question paper PDF'; $('dkrFileBox').classList.toggle('has', !!f); };
  $('dkrSend').onclick = () => publishCustom(r);
}
async function publishCustom(r) {
  if (S.sending) return;
  const v = id => ($(id).value || '').trim(), msg = $('dkMsg'), btn = $('dkrSend');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'dk-msg' + (cls ? ' ' + cls : ''); };
  const teacher = S.teachers.find(t => t.uid === v('dkrTeacher')), name = v('dkrName'), marks = parseFloat(v('dkrMarks')), mins = parseInt(v('dkrTime'), 10), file = $('dkrFile').files[0];
  if (!teacher) return say('Choose the teacher this paper is published as.', 'bad');
  if (!name) return say('Give the test a name.', 'bad');
  if (!(marks > 0 && marks <= 500) || !(mins >= 5 && mins <= 600)) return say('Marks must be 1–500 and time 5–600 minutes.', 'bad');
  if (!file) return say('Choose the question paper PDF.', 'bad');
  S.sending = true; btn.disabled = true;
  try {
    const request = await readDoc(`moduleRequests/${r.id}`);
    if (str(request.fields, 'status') === 'ready') {
      await loadAll(); S.sending = false; closeSheet(); render(); setBadge(inbox().length);
      toast('This paper has already been sent to the student.'); return;
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(r.id));
    const id = 'otc' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    say('Reading the PDF…'); await F().validateReadablePdf(file);
    const url = await F().upload(file, p => say(`Uploading question paper… ${Math.round(p * 100)}%`));
    say('Sending to the student…');
    const now = new Date().toISOString(), s = x => ({ stringValue: x });
    const chapters = (r.chapters || []).join('; ').slice(0, 900);
    await commit([
      { path: `offlineTestKeys/${id}`, currentDocument: { exists: false }, fields: { questionPdfUrl: s(url), answerPdfUrl: s(''), testName: s(name), teacherUid: s(teacher.uid), createdAt: s(now) } },
      { path: `offlineTests/${id}`, currentDocument: { exists: false }, fields: { testName: s(name), class: s(String(r.class)), board: s(''), subject: s(r.subject), chapter: s('Custom module'), module: s(chapters),
      totalMarks: { doubleValue: marks }, durationMin: { integerValue: String(mins) }, instructions: s(v('dkrNote')), gradingMode: s('teacher'),
      series: s('online'), kind: s('custom'), isFree: { booleanValue: false }, forUid: s(r.uid), requestId: s(r.id),
      teacherUid: s(teacher.uid), teacherName: s(teacher.name), isActive: { booleanValue: true }, createdAt: s(now) } },
      { path: `moduleRequests/${r.id}`, currentDocument: { updateTime: request.updateTime }, mask: ['status', 'testId', 'readyAt', 'teacherName'], fields: { status: s('ready'), testId: s(id), readyAt: s(now), teacherName: s(teacher.name) } },
      { path: `offlineAudit/publish_${id}`, currentDocument: { exists: false }, fields: { action: s('publish-custom'), testId: s(id), requestId: s(r.id), byAdminUid: s(ctx.uid), onBehalfOfUid: s(teacher.uid), onBehalfOfName: s(teacher.name), at: s(now) } }
    ]);
    Object.assign(r, { status: 'ready', testId: id, readyAt: now, teacherName: teacher.name });
    recountMake();
    S.tests.unshift({ id, name, class: String(r.class), board: '', subject: window.PortalUI.subject(r.subject), chapter: 'Custom module', module: chapters, totalMarks: marks, durationMin: mins,
      teacher: teacher.name, teacherUid: teacher.uid, isActive: true, createdAt: now, series: 'Online', kind: 'custom', paper: U().deliveryUrl(url) });
    S.sending = false;
    closeSheet(); render(); setBadge(inbox().length);
    toast(`Paper sent to ${r.studentName} · it's unlocked for them now`);
  } catch (e) {
    S.sending = false; btn.disabled = false;
    say((e.message || 'Could not confirm publication.') + ' You can retry safely; an already sent paper will not be duplicated.', 'bad');
  }
}

// ── Mock packs ──
function openPack(id, opener) {
  const p = S.packages.find(x => x.id === id); if (!p) return;
  const slots = packSlots(p);
  openSheet(p.title, p.active ? 'Mock pack · on sale' : 'Mock pack · paused', `<dl class="dk-facts">${fact('Class', 'Class ' + p.class + (p.board ? ' · ' + p.board : ' · All boards'))}${fact('Subject', p.subject)}${fact('Mocks', slots.length)}${fact('Price', '₹' + p.priceInr)}
      ${fact('Schedule', weekly(p))}${fact('Starts', when(p.schedule[0]))}${fact('Uploaded', slots.filter(s => s.t).length + ' of ' + slots.length)}<div><dt>Joined</dt><dd id="dkPackJoined">…</dd></div></dl>
    <div class="dk-list in-sheet">${slots.map(s => `<button type="button" class="dk-row" ${s.t ? `data-dk-paper="${esc(s.t.id)}"` : `data-dk-slot="${s.n}"`}>
      <span class="dk-main"><b>Mock ${s.n}</b><small>${esc(when(s.at))}${s.t ? ' · ' + esc(s.t.name) : ''}</small></span><span class="dk-side">${slotPill(s)}</span>${I.chev}</button>`).join('')}</div>
    <p class="dk-msg" id="dkMsg" role="status"></p>
    <div class="dk-actions"><button type="button" class="dk-btn ${p.active ? 'danger' : 'primary'}" id="dkPackToggle">${p.active ? 'Pause selling' : 'Resume selling'}</button></div>
    <p class="dk-fine">${p.active ? 'Pausing stops new students joining. Students already in the pack keep every mock.' : 'Students can join this pack again.'}</p>`, opener);
  runQuery('onlinePurchases', 'testId', 'pkg_' + p.id).then(docs => { const el = $('dkPackJoined'); if (el) el.textContent = docs.length + ' student' + (docs.length === 1 ? '' : 's'); }).catch(() => { const el = $('dkPackJoined'); if (el) el.textContent = '—'; });
  $('dkSheetBody').querySelectorAll('[data-dk-slot]').forEach(b => b.onclick = () => openSlot(p.id, Number(b.dataset.dkSlot), opener));
  $('dkSheetBody').querySelectorAll('[data-dk-paper]').forEach(b => b.onclick = () => { const t = S.tests.find(x => x.id === b.dataset.dkPaper); if (t && t.paper) window.open(t.paper, '_blank', 'noopener'); });
  $('dkPackToggle').onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await patch(`mockPackages/${p.id}`, { active: { booleanValue: !p.active } }); p.active = !p.active; recountMake(); closeSheet(); render(); setBadge(inbox().length); toast(p.active ? 'Pack on sale again' : 'Pack paused'); }
    catch (err) { $('dkMsg').textContent = err.message; $('dkMsg').className = 'dk-msg bad'; b.disabled = false; }
  };
}
function openNewPack(opener) {
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const next = new Date(Date.now() + 7 * DAYMS);
  openSheet('New mock pack', 'Weekly full-syllabus mocks', `<div class="dk-presets">${P().PACK_PRESETS.map(x => `<button type="button" class="dk-preset" data-preset="${x.mocks}|${x.priceInr}"><b>${x.mocks} mocks</b><span>₹${x.priceInr} · one a week</span></button>`).join('')}</div>
    <div class="dk-form">
      <label>Class<select id="dknClass">${opt([['', 'Select'], ...['9', '10', '11', '12'].map(c => [c, 'Class ' + c])], '')}</select></label>
      <label>Subject<select id="dknSubject">${opt([['', 'Select'], ['Physics', 'Physics'], ['Chemistry', 'Chemistry'], ['Mathematics', 'Mathematics'], ['Biology', 'Biology'], ['Science', 'Science'], ['Computer', 'Computer Science'], ['English', 'English']], '')}</select></label>
      <label>Board<select id="dknBoard">${opt([['', 'All boards'], ['CBSE', 'CBSE only'], ['ICSE', 'ICSE / ISC only']], '')}</select></label>
      <label>Number of mocks<input id="dknMocks" type="number" min="1" max="52" inputmode="numeric" value="8"></label>
      <label>First mock on<input id="dknDate" type="date" value="${ist.date(next)}"></label>
      <label>At (time)<input id="dknTime" type="time" value="10:00"></label>
      <label>Price (₹)<input id="dknPrice" type="number" min="1" max="100000" inputmode="numeric" value="3199"></label>
      <label>Pack name (optional)<input id="dknTitle" maxlength="80" placeholder="e.g. Physics full-syllabus series"></label>
      <label class="dk-full">About this pack (optional)<input id="dknDesc" maxlength="300" placeholder="e.g. Board-pattern papers, 80 marks, 3 hours"></label>
    </div>
    <p class="dk-preview" id="dknPreview"></p>
    <p class="dk-msg" id="dkMsg" role="status"></p>
    <div class="dk-actions sticky"><button type="button" class="dk-btn" data-dk-close>Cancel</button><button type="button" class="dk-btn primary" id="dknCreate">${I.plus}<span>Create pack</span></button></div>`, opener);
  const preview = () => {
    const sched = P().packSchedule($('dknDate').value, $('dknTime').value, parseInt($('dknMocks').value, 10));
    $('dknPreview').textContent = sched.length ? `${sched.length} mocks · ${weekly({ schedule: sched })} · ${when(sched[0])} → ${when(sched[sched.length - 1])} · ₹${$('dknPrice').value || 0}` : '';
  };
  ['dknDate', 'dknTime', 'dknMocks', 'dknPrice'].forEach(id => $(id).addEventListener('input', preview)); preview();
  $('dkSheetBody').querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const [m, pr] = b.dataset.preset.split('|'); $('dknMocks').value = m; $('dknPrice').value = pr; $('dkSheetBody').querySelectorAll('.dk-preset').forEach(x => x.classList.toggle('on', x === b)); preview(); });
  $('dknCreate').onclick = createPack;
}
async function createPack() {
  if (S.sending) return;
  const v = id => ($(id).value || '').trim(), msg = $('dkMsg'), btn = $('dknCreate');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'dk-msg' + (cls ? ' ' + cls : ''); };
  const cls = v('dknClass'), subject = v('dknSubject'), mocks = parseInt(v('dknMocks'), 10), price = parseInt(v('dknPrice'), 10);
  const schedule = P().packSchedule(v('dknDate'), v('dknTime'), mocks);
  if (!cls || !subject) return say('Choose the class and subject.', 'bad');
  if (!(mocks >= 1 && mocks <= 52)) return say('Number of mocks must be 1–52.', 'bad');
  if (!schedule.length) return say('Choose the first mock date and time.', 'bad');
  if (Date.parse(schedule[0]) < Date.now()) return say('The first mock must be in the future.', 'bad');
  if (!(price >= 1 && price <= 100000)) return say('Enter the pack price in rupees.', 'bad');
  S.sending = true; btn.disabled = true; say('Creating…');
  const id = 'pk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = new Date().toISOString(), s = x => ({ stringValue: x });
  const title = v('dknTitle') || `${window.PortalUI.subject(subject)} · ${mocks} weekly mocks`;
  try {
    await patch(`mockPackages/${id}`, { title: s(title), class: s(cls), board: s(v('dknBoard')), subject: s(subject), mocks: { integerValue: String(mocks) }, priceInr: { integerValue: String(price) },
      schedule: { arrayValue: { values: schedule.map(x => s(x)) } }, description: s(v('dknDesc')), active: { booleanValue: true }, createdAt: s(now), createdBy: s(ctx.uid || '') });
    S.packages.unshift({ id, title, class: cls, board: v('dknBoard'), subject, schedule, priceInr: price, active: true, description: v('dknDesc'), createdAt: now });
    recountMake(); S.sending = false; S.tab = 'packages'; S.page = 0;
    closeSheet(); render(); setBadge(inbox().length);
    toast(`“${title}” is on sale · first mock ${when(schedule[0])}`);
  } catch (e) { S.sending = false; btn.disabled = false; say('Could not create the pack: ' + e.message, 'bad'); }
}
function openSlot(pid, n, opener) {
  const p = S.packages.find(x => x.id === pid); if (!p) return;
  const s = packSlots(p).find(x => x.n === n); if (!s) return;
  if (s.t) return openPack(pid, opener);
  const opt = list => list.map(t => `<option value="${esc(t.uid)}">${esc(t.name)}</option>`).join('');
  openSheet(`${p.subject} · Mock ${n} of ${p.schedule.length}`, Date.parse(s.at) < Date.now() ? 'Overdue · upload now' : 'Upload this mock', `<dl class="dk-facts">${fact('Pack', p.title)}${fact('Class', 'Class ' + p.class + (p.board ? ' · ' + p.board : ''))}${fact('Opens', when(s.at))}${fact('Students see', 'Mock ' + n + ' of ' + p.schedule.length)}</dl>
    <div class="dk-form">
      <label class="dk-full">Publish as teacher<select id="dksTeacher"><option value="">Choose teacher</option>${opt(S.teachers)}</select></label>
      <label class="dk-full">Test name<input id="dksName" maxlength="120" value="${esc(window.PortalUI.subject(p.subject) + ' full mock ' + n)}"></label>
      <label>Maximum marks<input id="dksMarks" type="number" min="1" max="500" inputmode="numeric" placeholder="80"></label>
      <label>Time (minutes)<input id="dksTime" type="number" min="5" max="600" inputmode="numeric" placeholder="180"></label>
      <label>Opens on<input id="dksDate" type="date" value="${ist.date(s.at)}"></label>
      <label>At<input id="dksAt" type="time" value="${ist.time(s.at)}"></label>
      <label class="dk-full">Instructions (optional)<input id="dksNote" maxlength="500" placeholder="e.g. Attempt all questions"></label>
      <label class="dk-file dk-full" id="dksFileBox"><input type="file" id="dksFile" accept="application/pdf,.pdf">${I.up}<span id="dksFileName">Choose question paper PDF</span></label>
    </div>
    <p class="dk-fine">Students in the pack can start it from the opening time. Changing the date here moves only this mock.</p>
    <p class="dk-msg" id="dkMsg" role="status"></p>
    <div class="dk-actions sticky"><button type="button" class="dk-btn" data-dk-close>Cancel</button><button type="button" class="dk-btn primary" id="dksSend">${I.send}<span>Upload mock</span></button></div>`, opener);
  $('dksFile').onchange = e => { const f = e.target.files[0]; $('dksFileName').textContent = f ? f.name : 'Choose question paper PDF'; $('dksFileBox').classList.toggle('has', !!f); };
  $('dksSend').onclick = () => publishSlot(p, n);
}
async function publishSlot(p, n) {
  if (S.sending) return;
  const v = id => ($(id).value || '').trim(), msg = $('dkMsg'), btn = $('dksSend');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'dk-msg' + (cls ? ' ' + cls : ''); };
  const teacher = S.teachers.find(t => t.uid === v('dksTeacher')), name = v('dksName'), marks = parseFloat(v('dksMarks')), mins = parseInt(v('dksTime'), 10), file = $('dksFile').files[0];
  const releaseAt = new Date(`${v('dksDate')}T${v('dksAt') || '10:00'}:00+05:30`).toISOString();
  if (!teacher) return say('Choose the teacher this mock is published as.', 'bad');
  if (!name) return say('Give the mock a name.', 'bad');
  if (!(marks > 0 && marks <= 500) || !(mins >= 5 && mins <= 600)) return say('Marks must be 1–500 and time 5–600 minutes.', 'bad');
  if (!file) return say('Choose the question paper PDF.', 'bad');
  S.sending = true; btn.disabled = true;
  try {
    say('Reading the PDF…'); await F().validateReadablePdf(file);
    const url = await F().upload(file, pr => say(`Uploading question paper… ${Math.round(pr * 100)}%`));
    say('Publishing…');
    const id = 'otp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = new Date().toISOString(), s = x => ({ stringValue: x });
    await patch(`offlineTestKeys/${id}`, { questionPdfUrl: s(url), answerPdfUrl: s(''), testName: s(name), teacherUid: s(teacher.uid), createdAt: s(now) });
    await patch(`offlineTests/${id}`, { testName: s(name), class: s(String(p.class)), board: s(p.board || ''), subject: s(p.subject), chapter: s('Full syllabus'), module: s(`Mock ${n} of ${p.schedule.length}`),
      totalMarks: { doubleValue: marks }, durationMin: { integerValue: String(mins) }, instructions: s(v('dksNote')), gradingMode: s('teacher'),
      series: s('online'), kind: s('package'), isFree: { booleanValue: false }, packageId: s(p.id), slot: { integerValue: String(n) }, releaseAt: s(releaseAt),
      teacherUid: s(teacher.uid), teacherName: s(teacher.name), isActive: { booleanValue: true }, createdAt: s(now) });
    if (releaseAt !== p.schedule[n - 1]) {
      const schedule = p.schedule.slice(); schedule[n - 1] = releaseAt;
      await patch(`mockPackages/${p.id}`, { schedule: { arrayValue: { values: schedule.map(x => s(x)) } } });
      p.schedule = schedule;
    }
    patch(`offlineAudit/publish_${id}`, { action: s('publish-pack-mock'), testId: s(id), packageId: s(p.id), byAdminUid: s(ctx.uid), onBehalfOfUid: s(teacher.uid), onBehalfOfName: s(teacher.name), at: s(now) }).catch(() => {});
    S.tests.unshift({ id, name, class: String(p.class), board: p.board || '', subject: window.PortalUI.subject(p.subject), chapter: 'Full syllabus', module: `Mock ${n} of ${p.schedule.length}`, totalMarks: marks, durationMin: mins,
      teacher: teacher.name, teacherUid: teacher.uid, isActive: true, createdAt: now, series: 'Online', kind: 'package', paper: U().deliveryUrl(url), packageId: p.id, slot: n, releaseAt });
    recountMake(); S.sending = false;
    closeSheet(); render(); setBadge(inbox().length);
    toast(`Mock ${n} uploaded · opens ${when(releaseAt)}`);
  } catch (e) { S.sending = false; btn.disabled = false; say((e.message || 'Could not upload.') + ' Nothing was published — try again.', 'bad'); }
}

function openPaper(id, opener) {
  const t = S.tests.find(x => x.id === id); if (!t) return;
  const mine = S.reports.filter(r => r.testId === t.id), pending = mine.filter(r => r.stage !== 'returned').length;
  openSheet(t.name, t.isActive ? 'Live paper' : 'Closed paper', `<dl class="dk-facts">${fact('Class', 'Class ' + t.class + (t.board ? ' · ' + t.board : ''))}${fact('Subject', t.subject)}${fact('Chapter', t.chapter)}${fact('Type', kindLabel(t) + (t.series === 'Online' ? ' · ₹' + P().priceFor({ kind: t.kind }) : ''))}
      ${fact('Marks', t.totalMarks)}${fact('Time', t.durationMin + ' min')}${fact('Teacher', t.teacher)}${fact('Published', day(t.createdAt))}${fact('Submitted', mine.length)}${fact('To check', pending)}</dl>
    <p class="dk-msg" id="dkMsg" role="status"></p>
    <div class="dk-actions">${t.paper ? `<a class="dk-btn" href="${esc(t.paper)}" target="_blank" rel="noopener">${I.doc}<span>Question paper</span></a>` : ''}
      ${mine.length ? `<button type="button" class="dk-btn" id="dkPaperScripts">${I.inbox}<span>See scripts</span></button>` : ''}
      <button type="button" class="dk-btn ${t.isActive ? 'danger' : 'primary'}" id="dkToggle">${t.isActive ? 'Close paper' : 'Reopen paper'}</button></div>
    <p class="dk-fine">${t.isActive ? 'Closing hides the paper from students who have not started it. Submitted scripts and results are kept.' : 'Reopening makes the paper available to students again.'}</p>`, opener);
  const scripts = $('dkPaperScripts');
  if (scripts) scripts.onclick = () => { S.tab = pending ? 'inbox' : 'done'; S.q = t.name; S.page = 0; closeSheet(); $('dkSearch').value = t.name; render(); };
  $('dkToggle').onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await patch(`offlineTests/${t.id}`, { isActive: { booleanValue: !t.isActive } }); t.isActive = !t.isActive; closeSheet(); render(); toast(t.isActive ? 'Paper reopened' : 'Paper closed'); }
    catch (err) { $('dkMsg').textContent = err.message; $('dkMsg').className = 'dk-msg bad'; b.disabled = false; }
  };
}

function openPublish() {
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const chapters = [...new Set(S.tests.map(t => t.chapter))].sort();
  openSheet('New question paper', 'Publish', `<div class="dk-form">
      <label class="dk-full">Publish as teacher<select id="dkpTeacher"><option value="">Choose teacher</option>${S.teachers.map(t => `<option value="${esc(t.uid)}">${esc(t.name)}</option>`).join('')}</select><small>Students see this teacher's name.</small></label>
      <label>Series<select id="dkpSeries">${opt([['online', 'Online · all-India'], ['offline', 'Offline · enrolled']], 'online')}</select></label>
      <label id="dkpKindBox">Type<select id="dkpKind">${opt([['chapter', 'Chapter-wise · ₹199'], ['mock', 'Full mock · ₹499']], 'chapter')}</select></label>
      <label>Class<select id="dkpClass">${opt([['', 'Select'], ...['6', '7', '8', '9', '10', '11', '12'].map(c => [c, 'Class ' + c])], '')}</select></label>
      <label>Subject<select id="dkpSubject">${opt([['', 'Select'], ['Physics', 'Physics'], ['Chemistry', 'Chemistry'], ['Mathematics', 'Mathematics'], ['Biology', 'Biology'], ['Science', 'Science'], ['Computer', 'Computer Science'], ['English', 'English']], '')}</select></label>
      <label class="dk-full">Chapter<input id="dkpChapter" list="dkpChapters" maxlength="120" placeholder="e.g. Electricity, or Full syllabus" autocomplete="off"><datalist id="dkpChapters">${chapters.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
      <label>Test name<input id="dkpName" maxlength="120" placeholder="e.g. Chapter test 1"></label>
      <label>Part (optional)<input id="dkpPart" maxlength="100" placeholder="e.g. Part 1"></label>
      <label>Maximum marks<input id="dkpMarks" type="number" min="1" max="500" inputmode="numeric" placeholder="40"></label>
      <label>Time (minutes)<input id="dkpTime" type="number" min="5" max="600" inputmode="numeric" placeholder="90"></label>
      <label>Board<select id="dkpBoard">${opt([['', 'All boards'], ['CBSE', 'CBSE only'], ['ICSE', 'ICSE / ISC only']], '')}</select></label>
      <label>Instructions (optional)<input id="dkpNote" maxlength="500" placeholder="e.g. Attempt all questions"></label>
      <label class="dk-file dk-full" id="dkpFileBox"><input type="file" id="dkpFile" accept="application/pdf,.pdf">${I.up}<span id="dkpFileName">Choose question paper PDF</span></label>
    </div>
    <p class="dk-msg" id="dkMsg" role="status"></p>
    <div class="dk-actions sticky"><button type="button" class="dk-btn" data-dk-close>Cancel</button><button type="button" class="dk-btn primary" id="dkPublish">${I.send}<span>Publish paper</span></button></div>`, $('dkNew'));
  $('dkpSeries').onchange = e => { $('dkpKindBox').hidden = e.target.value !== 'online'; };
  $('dkpFile').onchange = e => { const f = e.target.files[0]; $('dkpFileName').textContent = f ? f.name : 'Choose question paper PDF'; $('dkpFileBox').classList.toggle('has', !!f); };
  $('dkPublish').onclick = publish;
}
async function publish() {
  if (S.sending) return;
  const v = id => ($(id).value || '').trim(), msg = $('dkMsg'), btn = $('dkPublish');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'dk-msg' + (cls ? ' ' + cls : ''); };
  const teacher = S.teachers.find(t => t.uid === v('dkpTeacher')), series = v('dkpSeries') === 'offline' ? 'offline' : 'online', kind = v('dkpKind') === 'mock' ? 'mock' : 'chapter';
  const cls = v('dkpClass'), subject = v('dkpSubject'), chapter = v('dkpChapter'), name = v('dkpName'), marks = parseFloat(v('dkpMarks')), mins = parseInt(v('dkpTime'), 10), file = $('dkpFile').files[0];
  if (!teacher) return say('Choose the teacher this paper is published as.', 'bad');
  if (!cls || !subject || !chapter || !name) return say('Fill class, subject, chapter and test name.', 'bad');
  if (!(marks > 0 && marks <= 500) || !(mins >= 5 && mins <= 600)) return say('Marks must be 1–500 and time 5–600 minutes.', 'bad');
  if (!file) return say('Choose the question paper PDF.', 'bad');
  S.sending = true; btn.disabled = true;
  try {
    say('Reading the PDF…'); await F().validateReadablePdf(file);
    const url = await F().upload(file, p => say(`Uploading question paper… ${Math.round(p * 100)}%`));
    say('Publishing…');
    const id = 'ots' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), now = new Date().toISOString(), s = x => ({ stringValue: x });
    await patch(`offlineTestKeys/${id}`, { questionPdfUrl: s(url), answerPdfUrl: s(''), testName: s(name), teacherUid: s(teacher.uid), createdAt: s(now) });
    await patch(`offlineTests/${id}`, { testName: s(name), class: s(cls), board: s(v('dkpBoard')), subject: s(subject), chapter: s(chapter), module: s(v('dkpPart') || 'Full chapter'),
      totalMarks: { doubleValue: marks }, durationMin: { integerValue: String(mins) }, instructions: s(v('dkpNote')), gradingMode: s('teacher'),
      series: s(series), isFree: { booleanValue: false }, ...(series === 'online' ? { kind: s(kind) } : {}),
      teacherUid: s(teacher.uid), teacherName: s(teacher.name), isActive: { booleanValue: true }, createdAt: s(now) });
    patch(`offlineAudit/publish_${id}`, { action: s('publish-test'), testId: s(id), byAdminUid: s(ctx.uid), onBehalfOfUid: s(teacher.uid), onBehalfOfName: s(teacher.name), at: s(now) }).catch(() => {});
    S.tests.unshift({ id, name, class: cls, board: v('dkpBoard'), subject: window.PortalUI.subject(subject), chapter, module: v('dkpPart') || 'Full chapter', totalMarks: marks, durationMin: mins, teacher: teacher.name, teacherUid: teacher.uid,
      isActive: true, createdAt: now, series: series === 'online' ? 'Online' : 'Offline', kind: series === 'online' ? kind : '', paper: U().deliveryUrl(url) });
    S.sending = false; S.tab = 'papers'; S.page = 0;
    closeSheet(); render();
    toast(`“${name}” is live for Class ${cls} ${subject}`);
  } catch (e) {
    S.sending = false; btn.disabled = false;
    say((e.message || 'Could not publish.') + ' Nothing was published — try again.', 'bad');
  }
}

async function refresh(manual) {
  if (S.loading) return;
  S.loading = true; shell();
  const btn = $('dkRefresh'); if (btn) btn.classList.add('spin');
  if (!S.loaded) list();
  try { await loadAll(); render(); setBadge(inbox().length); if (manual) toast('Up to date'); }
  catch (e) { $('dkList').innerHTML = `<div class="dk-empty bad"><b>Could not load the Test Desk</b><p>${esc(e.message || e)}</p><button type="button" class="dk-btn primary" id="dkRetry">Try again</button></div>`; const r = $('dkRetry'); if (r) r.onclick = () => refresh(true); }
  finally { S.loading = false; if (btn) btn.classList.remove('spin'); }
}

function bind() {
  if (bound) return; bound = true;
  ensureBadges();
  $('dkSheetClose').onclick = closeSheet;
  $('dkSheet').addEventListener('click', e => {
    if (e.target.id === 'dkSheet' || e.target.closest('[data-dk-close]')) return closeSheet();
    const script = e.target.closest('[data-dk-script]'); if (script) openScript(script.dataset.dkScript, S.opener);
  });
  $('dkSheet').addEventListener('input', () => { const m = $('dkMsg'); if (m && m.classList.contains('bad') && !S.sending) { m.textContent = ''; m.className = 'dk-msg'; } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('dkSheet') && !$('dkSheet').hidden) closeSheet(); });
  const open = $('deskNoticeOpen'); if (open) open.onclick = () => window.switchAdminTab('test-desk');
  new MutationObserver(() => { const n = parseInt(document.querySelector('[data-desk-badge]')?.dataset.count, 10) || 0; const note = $('deskNotice'); if (note) note.hidden = !n || document.body.dataset.activeSection === 'test-desk'; })
    .observe(document.body, { attributes: true, attributeFilter: ['data-active-section'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  clearInterval(pollTimer); pollTimer = setInterval(poll, 60000);
}

// Called once the admin is verified: starts the blinking count.
export function startDeskWatch(context) { ctx = context; bind(); poll(); }
// Called when the Test Desk section opens.
export function loadTestDesk(context) { ctx = context; bind(); return refresh(); }
