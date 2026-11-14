/* Admin panel — "impatient client" stress check on phones (390 / 320 px) and a laptop.
   Fails on any JS error, sideways scrolling, stuck sheet, duplicate write or unsafe HTML:
     · every admin section opened at 390 and 320 px (and 1440): no horizontal overflow
     · 30 rapid section switches: last one wins, no errors
     · Test Desk: double tap Send back / Create pack → one write; Escape and phone Back close
       sheets without leaving the desk; lists grouped by Class · Subject
     · Online Students details: phone Back closes it
     · a student name containing HTML is shown as text everywhere and never runs
   Reuses the fixtures and network fakes of offline-admin.cjs; nothing touches production.
   Run with Playwright on NODE_PATH: node qa/admin-stress.cjs */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const file = path.resolve(__dirname, 'offline-admin.cjs');
let src = fs.readFileSync(file, 'utf8');
src = src.slice(0, src.indexOf('(async () => {'));
const main = String.raw`
const stressOut = path.join(__dirname, 'artifacts', 'admin-stress'); fs.mkdirSync(stressOut, { recursive: true });
const snap = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(stressOut, name + '.png') }); };
const SECTIONS = ['overview', 'all-students', 'online-students', 'test-desk', 'upload-material', 'ncert', 'teachers', 'tests', 'live-classes', 'enquiries', 'attendance', 'notifications'];
const overflow = page => page.evaluate(() => {
  const w = document.documentElement.clientWidth, bad = [];
  if (document.documentElement.scrollWidth > w + 1) {
    document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > w + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('[hidden]')) bad.push((el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase()) + ' ' + Math.round(r.right)); });
  }
  return { sw: document.documentElement.scrollWidth, w, bad: bad.slice(0, 6) };
});
const evil = '<img src=x onerror="window.__xss=1">Hacker';
const ctxFor = () => {
  const docs = reportDocs.map(d => ({ ...d, fields: { ...d.fields } }));
  const i = docs.findIndex(d => d.fields.status && d.fields.status.stringValue === 'submitted');
  docs[i] = { ...docs[i], fields: { ...docs[i].fields, studentName: { stringValue: evil } } };
  return { docs, calls: [], patches: [], requests: [], packages: [], packTests: [], joined: [],
    onlineStudents: [{ id: 'riya', uid: 'riya', name: 'Riya <b>Sharma</b>', onlineId: 'TNC-ON-RIYA', class: '10', board: 'CBSE', phone: '9874461218', email: 'riya@example.test', enrolled: false, profileComplete: true, createdAt: '2026-11-01T10:00:00Z' }] };
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  const problems = [];
  try {
    // ── 1. Every section at phone and laptop widths ──
    for (const width of [320, 390, 1440]) {
      const ctx = ctxFor();
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', width, ctx);
      await page.waitForSelector('#logoutBtn');
      for (const s of SECTIONS) {
        const ok = await page.evaluate(name => { if (typeof switchAdminTab !== 'function') return false; switchAdminTab(name); return true; }, s);
        assert.ok(ok, 'switchAdminTab exists');
        await page.waitForTimeout(450);
        const o = await overflow(page);
        if (o.sw > o.w + 1) problems.push(width + 'px ' + s + ': sideways scroll ' + o.sw + ' > ' + o.w + ' — ' + o.bad.join(', '));
        if (width !== 1440) await snap(page, width + '-' + s);
      }
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'injected HTML never runs');
      if (errors.length) problems.push(width + 'px errors: ' + errors.join(' | '));
      await page.close();
    }
    if (problems.length) { console.log('PROBLEMS:\n  ' + problems.join('\n  ')); throw new Error(problems.length + ' layout / error problem(s)'); }
    console.log('✓ all ' + SECTIONS.length + ' sections at 320 / 390 / 1440 px: no sideways scroll, no JS errors, no injected HTML runs');

    // ── 2. Rapid switching ──
    {
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', 390, ctxFor());
      await page.waitForSelector('#logoutBtn');
      await page.evaluate(list => { for (let i = 0; i < 30; i++) switchAdminTab(list[i % list.length]); switchAdminTab('test-desk'); }, SECTIONS);
      await page.waitForSelector('#tab-test-desk.active .dk-row[data-dk-open]');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ 31 rapid section switches: lands on the last one, no errors');
    }

    // ── 3. Test Desk abuse ──
    {
      const ctx = ctxFor();
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', 390, ctx);
      await page.waitForSelector('#logoutBtn');
      await page.evaluate(() => switchAdminTab('test-desk'));
      await page.waitForSelector('#tab-test-desk.active .dk-row[data-dk-open]');
      assert.ok(await page.locator('.dk-gh').count() >= 2, 'grouped by Class · Subject');
      assert.match(await page.textContent('#dkList'), /<img src=x/, 'hostile name shown as text');
      // Escape closes; phone Back closes and stays on the desk.
      await page.locator('.dk-row[data-dk-open]').first().click(); await page.waitForSelector('#dkSheet.on');
      await page.keyboard.press('Escape'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      await page.locator('.dk-row[data-dk-open]').first().click(); await page.waitForSelector('#dkSheet.on');
      await page.goBack(); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.ok(await page.locator('#tab-test-desk.active').count(), 'phone Back closed the sheet and stayed on Test Desk');
      // Double tap Send back → one return.
      await page.locator('.dk-row[data-dk-open]').first().click(); await page.waitForSelector('#dkSheet.on #dkSend');
      await page.setInputFiles('#dkChecked', path.join(__dirname, 'artifacts', 'admin-desk', 'checked.pdf'));
      await page.fill('#dkScore', '10');
      await page.locator('#dkSend').dblclick();
      await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.equal(ctx.calls.filter(c => c.action === 'return-script').length, 1, 'double tap Send back → one return');
      // Double tap Create pack → one pack.
      await page.click('[data-dk-tab=packages]'); await page.click('[data-dk-newpack]'); await page.waitForSelector('#dknCreate');
      await page.selectOption('#dknClass', '10'); await page.selectOption('#dknSubject', 'Physics');
      await page.locator('#dknCreate').dblclick();
      await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.equal(ctx.patches.filter(p => /^mockPackages\/pk/.test(p.path) && p.body.fields.title).length, 1, 'double tap Create pack → one pack');
      await snap(page, 'desk-after-abuse-390');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ Test Desk: grouped lists, hostile names safe, Escape / phone Back close sheets, double taps write once');
    }

    // ── 3b. Teacher-written data (study material, class tests) can never run code in the admin panel ──
    {
      const ctx = ctxFor();
      const badId = "x');window.__xss=3;('";
      ctx.collections = {
        chapters: [{ id: 'ch1', docId: badId, class: '10', subject: 'Physics', chapterName: '<img src=x onerror="window.__xss=4">Light', category: 'notes', pdfUrl: 'javascript:window.__xss=5', targetBoard: 'CBSE' }],
        tests: [{ id: 'ts1', testId: "t1');window.__xss=6;('", testName: '<img src=x onerror="window.__xss=7">Quiz', class: '10', subject: 'Physics', isActive: true, totalMarks: 10, totalQ: 5, timeLimit: 30 }]
      };
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', 1440, ctx);
      await page.waitForSelector('#logoutBtn');
      await page.evaluate(() => switchAdminTab('upload-material'));
      await page.waitForSelector('#tab-upload-material .portal-browser input');
      await page.fill('#tab-upload-material .portal-browser input', 'Light'); await page.waitForTimeout(400);
      assert.ok(await page.locator('[onclick^="deletePdf"]').count(), 'material row rendered');
      await page.evaluate(() => { window.deletePdf = (a, b) => { window.__args = [a, b]; }; });
      await page.click('[onclick^="deletePdf"]');
      assert.deepEqual(await page.evaluate(() => window.__args), [badId, '<img src=x onerror="window.__xss=4">Light'], 'delete gets the exact values, nothing injected');
      assert.equal(await page.getAttribute('#pdfListWrap a[target=_blank]', 'href'), '#', 'javascript: links blocked');
      await page.evaluate(() => switchAdminTab('tests'));
      await page.waitForSelector('#tab-tests .portal-browser input');
      await page.fill('#tab-tests .portal-browser input', 'Quiz'); await page.waitForTimeout(400);
      assert.ok(await page.locator('[onclick^="viewTestResults"]').count(), 'class test rendered');
      await page.evaluate(() => { window.viewTestResults = a => { window.__args2 = a; }; });
      await page.click('[onclick^="viewTestResults"]');
      assert.equal(await page.evaluate(() => window.__args2), "t1');window.__xss=6;('");
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'no injected code ran');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ teacher-written study material and class tests: names shown as text, buttons get exact values, javascript: links blocked');
    }

    // ── 4. Online Students details: phone Back closes ──
    {
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', 390, ctxFor());
      await page.waitForSelector('#logoutBtn');
      await page.evaluate(() => switchAdminTab('online-students'));
      await page.waitForSelector('[data-ona-open=riya]'); await page.click('[data-ona-open=riya]'); await page.waitForSelector('#onaModal:not([hidden])');
      assert.match(await page.textContent('#onaModalTitle'), /Riya <b>Sharma<\/b>/, 'name shown as text');
      await page.goBack(); await page.waitForSelector('#onaModal', { state: 'hidden' });
      assert.ok(await page.locator('#tab-online-students.active').count(), 'stayed on Online Students');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ Online Students: details shown safely, phone Back closes them');
    }
  } finally { await browser.close(); server.close(); }
  console.log('All admin stress checks passed. Screenshots: ' + path.relative(root, stressOut));
})().catch(e => { console.error(e.message || e); process.exit(1); });
`;
const run = new Module(file, module); run.filename = file; run.paths = module.paths;
run._compile(src + main, file);
