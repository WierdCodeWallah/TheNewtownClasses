/* Admin → Test Desk — browser check with the offline-admin fixture
   (30 students, 121 scripts; 8 waiting, 4 of them overdue).
   Blinking count on the bottom tab / menu / Home notice → To check (oldest
   first, paged, search, filters) → download → upload checked PDF + marks →
   send back (count drops) → Checked → Students (their scripts, permanent
   delete with typed ID) → Papers (close, publish a new paper).
   Reuses the fixtures and network fakes of offline-admin.cjs; nothing touches
   production. Run with Playwright on NODE_PATH: node qa/admin-desk.cjs */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const file = path.resolve(__dirname, 'offline-admin.cjs');
let src = fs.readFileSync(file, 'utf8');
src = src.slice(0, src.indexOf('(async () => {'));
const main = String.raw`
const deskOut = path.join(__dirname, 'artifacts', 'admin-desk'); fs.mkdirSync(deskOut, { recursive: true });
function makePdf(text) {
  const objs = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', null];
  const body = 'BT /F1 18 Tf 60 760 Td (' + text + ') Tj ET';
  objs.push('<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 3 0 R /Resources << /Font << /F1 1 0 R >> >> >>');
  objs[1] = '<< /Type /Pages /Kids [4 0 R] /Count 1 >>';
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 5 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}
const checkedPdf = path.join(deskOut, 'checked.pdf'); fs.writeFileSync(checkedPdf, makePdf('Checked 16/20'));
const paperPdf = path.join(deskOut, 'paper.pdf'); fs.writeFileSync(paperPdf, makePdf('Q1. Define force.'));
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(deskOut, name + '.png') }); };
const pendingTotal = reports.filter(r => r.status === 'submitted').length;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    for (const width of [320, 390, 1440]) {
      const ctx = { docs: reportDocs.map(d => ({ ...d, fields: { ...d.fields } })), calls: [], patches: [], requests: [
        { id: 'order_Mod1_physics', orderId: 'order_Mod1', uid: 'stu5', studentName: 'Student 05', onlineId: 'TNC-ON-STU5', enrolled: false, class: '11', board: 'CISCE', boardLabel: 'ISC', subject: 'Physics',
          chapters: ['Laws of Motion', 'Gravitation', 'Oscillations'], chapterCount: 3, amountPaise: 59700, status: 'requested', testId: '', createdAt: new Date(Date.now() - 3600000).toISOString(), dueAt: new Date(Date.now() + 23 * 3600000).toISOString(), readyAt: '' },
        { id: 'order_Mod0_chemistry', orderId: 'order_Mod0', uid: 'stu8', studentName: 'Student 08', onlineId: 'TNC-ON-STU8', enrolled: true, class: '11', board: 'CBSE', boardLabel: 'CBSE', subject: 'Chemistry',
          chapters: ['Equilibrium'], chapterCount: 1, amountPaise: 0, status: 'ready', testId: 'otsready', createdAt: new Date(Date.now() - 86400000).toISOString(), dueAt: new Date().toISOString(), readyAt: new Date().toISOString() }],
        // Mock pack: mock 1 opens in 2 days (to upload now), mock 2 in 9 days (not yet).
        packages: [{ id: 'pkphy8', title: 'Physics · 8 weekly mocks', class: '10', board: '', subject: 'Physics', mocks: 8, priceInr: 3199, active: true, description: '',
          schedule: Array.from({ length: 8 }, (_, i) => new Date(Math.floor((Date.now() + 2 * 86400000) / 60000) * 60000 + i * 7 * 86400000).toISOString()) }],
        onlineStudents: [{ id: 'riya', uid: 'riya', name: 'Riya Sharma', onlineId: 'TNC-ON-RIYA', class: '10', board: 'CBSE', phone: '9800012345', email: 'riya@example.test', enrolled: false, profileComplete: true, createdAt: '2026-11-01T10:00:00Z' },
          { id: 'tnc9', uid: 'tnc9', name: 'Riyaan TNC', onlineId: 'NTC-9', class: '10', enrolled: true, profileComplete: true, createdAt: '2026-11-01T10:00:00Z' }],
        packTests: [], joined: [{ id: 'pkg_pkphy8__stu1', uid: 'stu1', testId: 'pkg_pkphy8' }, { id: 'pkg_pkphy8__stu2', uid: 'stu2', testId: 'pkg_pkphy8' }, { id: 'pkg_pkphy8__stu3', uid: 'stu3', testId: 'pkg_pkphy8' }] };
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', width, ctx);
      await page.waitForSelector('#logoutBtn');
      const phone = width < 700;
      // Blinking count before the desk is even opened.
      const badge = phone ? '.portal-bottom-nav [data-section="test-desk"] .desk-badge' : '#sidebar [data-section="test-desk"] .desk-badge';
      await page.waitForSelector(badge + ':not([hidden])');
      assert.equal(await page.getAttribute(badge, 'data-count'), String(pendingTotal + 2), 'count of scripts waiting + custom papers to make + pack mocks due');
      assert.match(await page.locator(badge).evaluate(el => getComputedStyle(el).animationName), /deskBlink/, 'the count blinks');
      assert.match(await page.textContent('#deskNoticeText'), new RegExp(pendingTotal + ' answer scripts to check · 1 custom paper to make · 1 pack mock to upload'));
      if (width === 390) await shot(page, 'desk-01-home-notice-390');
      await page.click('#deskNoticeOpen');
      await page.waitForSelector('#tab-test-desk.active .dk-row[data-dk-open]');
      assert.equal(await page.locator('#deskNotice').isVisible(), false, 'notice hides while the desk is open');
      // To check: oldest first, paged, compact.
      const size = phone ? 8 : 12;
      assert.equal(await page.locator('.dk-row[data-dk-open]').count(), Math.min(size, pendingTotal));
      assert.equal(await page.textContent('#dkN-inbox'), String(pendingTotal));
      assert.ok(await page.locator('#dkN-inbox.blink').count(), 'To check count blinks');
      assert.ok(await page.locator('.dk-row').first().evaluate(el => el.classList.contains('overdue')), 'overdue scripts come first');
      assert.match(await page.locator('.dk-row').first().textContent(), /Overdue/);
      const rowH = await page.locator('.dk-row').first().evaluate(el => el.getBoundingClientRect().height);
      assert.ok(rowH <= 84, 'compact rows (' + rowH + 'px)');
      assert.ok(await fits(page), 'no horizontal overflow at ' + width);
      if (pendingTotal > size) { assert.match(await page.textContent('#dkPager'), new RegExp('1–' + size + ' of ' + pendingTotal)); await page.click('[data-dk-page="1"]'); assert.equal(await page.locator('.dk-row[data-dk-open]').count(), pendingTotal - size); await page.click('[data-dk-page="-1"]'); }
      await shot(page, 'desk-02-to-check-' + width);
      // Search and filters never refetch.
      await page.fill('#dkSearch', 'student 08');
      assert.equal(await page.locator('.dk-row[data-dk-open]').count(), 1); assert.match(await page.textContent('.dk-row'), /Student 08/);
      await page.fill('#dkSearch', 'zzz'); await page.waitForSelector('.dk-empty:has-text("Nothing matches")');
      await page.fill('#dkSearch', '');
      await page.selectOption('#dkClass', '7');
      assert.ok((await page.locator('.dk-gh b').allTextContents()).every(t => t === 'Class 7'), 'class filter: only Class 7 groups');
      await page.selectOption('#dkClass', '');
      // Check a script and send it back.
      const firstName = await page.locator('.dk-row b').first().textContent();
      await page.locator('.dk-row').first().click();
      await page.waitForSelector('#dkSheet.on #dkSend');
      assert.equal(await page.inputValue('#dkTeacher'), 'teacher-demo', 'assigned teacher preselected');
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dkDownload')]);
      assert.match(download.suggestedFilename(), /^Student_\d+_TNC-\d+_.+\.pdf$/, 'script downloads with the student name');
      await page.click('#dkSend'); assert.match(await page.textContent('#dkMsg'), /Choose the checked script/);
      await page.setInputFiles('#dkChecked', checkedPdf);
      await page.fill('#dkScore', '25'); await page.click('#dkSend'); assert.match(await page.textContent('#dkMsg'), /between 0 and 20/);
      await page.fill('#dkScore', '16'); await page.fill('#dkRemark', 'Good steps. Label the diagram.');
      if (width === 390) await shot(page, 'desk-03-check-sheet-390');
      await page.click('#dkSend');
      await page.waitForSelector('#dkSheet', { state: 'hidden' });
      const sent = ctx.calls.find(c => c.action === 'return-script');
      assert.equal(sent.score, 16); assert.equal(sent.onBehalfOf, 'teacher-demo'); assert.equal(sent.remark, 'Good steps. Label the diagram.');
      assert.match(sent.checkedScriptUrl, /^https:\/\/32zbpzustr\.ucarecd\.net\//);
      assert.equal(await page.textContent('#dkN-inbox'), String(pendingTotal - 1), 'count drops after sending back');
      assert.equal(await page.getAttribute(badge, 'data-count'), String(pendingTotal + 1), 'blinking count drops too');
      assert.match(await page.textContent('#dkToast'), /Sent back to/);
      // Checked.
      await page.click('[data-dk-tab=done]');
      assert.match(await page.locator('.dk-row').first().textContent(), new RegExp(firstName + '[\\s\\S]*16/20'));
      await page.locator('.dk-row').first().click(); await page.waitForSelector('#dkSheet.on .dk-score');
      assert.match(await page.textContent('#dkSheetBody'), /Label the diagram/);
      if (width === 390) await shot(page, 'desk-04-checked-sheet-390');
      await page.click('#dkSheetClose'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      // Summary numbers match totals computed independently.
      const stats = await page.locator('#dkStats').innerText();
      assert.match(stats, new RegExp((pendingTotal - 1) + '[^0-9]+Waiting')); assert.match(stats, /\d+\s+Overdue 48h/); assert.match(stats, new RegExp((summary.returned + 1) + '[^0-9]+Checked'));
      // Students: one row per student; open one → their scripts → delete a record with typed confirmation.
      await page.click('[data-dk-tab=students]');
      assert.equal(await page.textContent('#dkN-students'), String(summary.students), 'one row per student');
      await page.fill('#dkSearch', 'Student 07');
      assert.equal(await page.locator('.dk-row[data-dk-open]').count(), 1);
      const seven = perStudent.find(x => x.studentName === 'Student 07');
      assert.match(await page.textContent('.dk-row'), new RegExp(seven.total + ' tests?'));
      await page.locator('.dk-row').first().click(); await page.waitForSelector('#dkSheet.on [data-dk-script]');
      assert.equal(await page.locator('#dkSheet [data-dk-script]').count(), seven.total, "all of the student's scripts listed");
      if (width === 390) await shot(page, 'desk-07-student-sheet-390');
      await page.locator('#dkSheet [data-dk-script]').first().click(); await page.waitForSelector('#dkSheet .dk-danger');
      await page.click('.dk-danger summary');
      assert.equal(await page.locator('#dkDelete').isDisabled(), true, 'delete locked until the ID is typed');
      await page.fill('#dkDelConfirm', 'wrong'); assert.equal(await page.locator('#dkDelete').isDisabled(), true);
      await page.fill('#dkDelConfirm', seven.studentId.toLowerCase()); assert.equal(await page.locator('#dkDelete').isDisabled(), false);
      if (width === 390) await shot(page, 'desk-08-delete-390');
      await page.click('#dkDelete'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.ok(ctx.calls.some(c => c.action === 'delete-record' && /__stu7$/.test(c.attemptId)), 'record deleted on the server');
      assert.match(await page.textContent('#dkToast'), /Deleted Student 07/);
      assert.match(await page.textContent('.dk-row'), new RegExp((seven.total - 1) + ' tests?'), 'student total drops');
      await page.fill('#dkSearch', '');
      // To make: the custom paper for the chapters the student chose + the pack mock due soon.
      await page.click('[data-dk-tab=requests]');
      assert.equal(await page.textContent('#dkN-requests'), '2'); assert.ok(await page.locator('#dkN-requests.blink').count(), 'To make count blinks');
      const reqRows = await page.locator('.dk-row[data-dk-open]').allTextContents();
      assert.equal(reqRows.length, 3); assert.match(reqRows[0], /Student 05[\s\S]*3 chapters[\s\S]*Due in/, 'waiting request first');
      assert.deepEqual(await page.locator('.dk-gh').allInnerTexts().then(a => a.map(t => t.replace(/\s+/g, ' ').trim())), ['Class 11 Physics 1', 'Class 10 Physics 1', 'Class 11 Chemistry 1'], 'grouped by class · subject, most urgent group first');
      assert.match(reqRows[1], /Mock 1 of 8[\s\S]*Pack · opens[\s\S]*Due in 2d/, 'pack mock due in 2 days, mock 2 (9 days) not yet'); assert.match(reqRows[2], /Sent/);
      if (width === 390) await shot(page, 'desk-11-to-make-390');
      await page.locator('.dk-row').first().click(); await page.waitForSelector('#dkrSend');
      assert.match(await page.textContent('.dk-chapters'), /Laws of Motion[\s\S]*Gravitation[\s\S]*Oscillations/);
      await page.click('#dkrSend'); assert.match(await page.textContent('#dkMsg'), /Choose the teacher/);
      await page.selectOption('#dkrTeacher', 'teacher-demo'); await page.fill('#dkrMarks', '30'); await page.fill('#dkrTime', '75'); await page.setInputFiles('#dkrFile', paperPdf);
      if (width === 390) await shot(page, 'desk-09-request-390');
      if (width === 390) {
        ctx.failCustomCommit = true;
        await page.click('#dkrSend'); await page.waitForSelector('#dkMsg.bad');
        assert.equal(ctx.patches.filter(p => /^offlineTests\/otc/.test(p.path)).length, 0, 'failed atomic publication leaves no visible paper');
      }
      if (width === 1440) {
        ctx.loseCustomReply = true;
        await page.click('#dkrSend'); await page.waitForSelector('#dkMsg.bad');
        assert.equal(ctx.patches.filter(p => /^offlineTests\/otc/.test(p.path)).length, 1, 'commit succeeded despite lost response');
      }
      await page.click('#dkrSend'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.equal(ctx.patches.filter(p => /^offlineTests\/otc/.test(p.path)).length, 1, 'retry never duplicates or overwrites a custom paper');
      const custom = ctx.patches.find(p => /^offlineTests\/otc/.test(p.path));
      assert.ok(custom, 'custom paper published'); assert.equal(custom.body.fields.kind.stringValue, 'custom'); assert.equal(custom.body.fields.forUid.stringValue, 'stu5');
      assert.equal(custom.body.fields.class.stringValue, '11'); assert.match(custom.body.fields.module.stringValue, /Laws of Motion; Gravitation; Oscillations/);
      const marked = ctx.patches.find(p => p.path === 'moduleRequests/order_Mod1_physics');
      assert.equal(marked.body.fields.status.stringValue, 'ready'); assert.equal(marked.body.fields.testId.stringValue, custom.path.split('/')[1]);
      assert.equal(await page.textContent('#dkN-requests'), '1'); assert.equal(await page.getAttribute(badge, 'data-count'), String(pendingTotal), 'count drops once the paper is sent');
      assert.match(await page.textContent('#dkToast'), /Paper sent to Student 05|already been sent/);

      // Packages: the pack, its weekly schedule, who joined; upload mock 1; create a new pack; pause it.
      await page.click('[data-dk-tab=packages]');
      assert.equal(await page.textContent('#dkN-packages'), '1');
      assert.match(await page.textContent('.dk-row.dk-add'), /New mock pack/);
      const packRow = page.locator('.dk-row[data-dk-open=pkphy8]');
      assert.match(await packRow.textContent(), /Physics · 8 weekly mocks[\s\S]*₹3199 · Every [A-Z][a-z]{2} · [\s\S]*0\/8 uploaded[\s\S]*Due in 2d/);
      assert.ok(await fits(page), 'packages fit at ' + width);
      if (width === 390) await shot(page, 'desk-12-packages-390');
      await packRow.click(); await page.waitForSelector('#dkSheet.on #dkPackToggle');
      assert.equal(await page.locator('#dkSheet [data-dk-slot]').count(), 8, 'all 8 weekly mocks listed');
      await page.waitForFunction(() => /3 students/.test(document.querySelector('#dkPackJoined').textContent));
      if (width === 390) await shot(page, 'desk-13-pack-sheet-390');
      await page.locator('#dkSheet [data-dk-slot="1"]').click(); await page.waitForSelector('#dksSend');
      assert.equal(await page.inputValue('#dksName'), 'Physics full mock 1');
      await page.click('#dksSend'); assert.match(await page.textContent('#dkMsg'), /Choose the teacher/);
      await page.selectOption('#dksTeacher', 'teacher-demo'); await page.fill('#dksMarks', '80'); await page.fill('#dksTime', '180'); await page.setInputFiles('#dksFile', paperPdf);
      if (width === 390) await shot(page, 'desk-14-upload-pack-mock-390');
      await page.click('#dksSend'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      const pm = ctx.patches.find(p => /^offlineTests\/otp/.test(p.path));
      assert.ok(pm, 'pack mock published'); const pf = pm.body.fields;
      assert.equal(pf.kind.stringValue, 'package'); assert.equal(pf.packageId.stringValue, 'pkphy8'); assert.equal(pf.slot.integerValue, '1'); assert.equal(pf.series.stringValue, 'online');
      assert.equal(pf.releaseAt.stringValue, ctx.packages[0].schedule[0], 'opens at the scheduled time'); assert.equal(pf.module.stringValue, 'Mock 1 of 8'); assert.equal(pf.class.stringValue, '10');
      assert.ok(!ctx.patches.some(p => p.path === 'mockPackages/pkphy8'), 'schedule untouched when the time is unchanged');
      assert.match(await packRow.textContent(), /1\/8 uploaded[\s\S]*Upcoming/);
      assert.equal(await page.textContent('#dkN-requests'), '0'); assert.equal(await page.getAttribute(badge, 'data-count'), String(pendingTotal - 1), 'count drops once the pack mock is uploaded');
      assert.match(await page.textContent('#dkToast'), /Mock 1 uploaded/);
      await page.click('[data-dk-newpack]'); await page.waitForSelector('#dknCreate');
      await page.click('#dknCreate'); assert.match(await page.textContent('#dkMsg'), /class and subject/);
      await page.click('[data-preset="4|1699"]');
      assert.equal(await page.inputValue('#dknMocks'), '4'); assert.equal(await page.inputValue('#dknPrice'), '1699');
      await page.selectOption('#dknClass', '12'); await page.selectOption('#dknSubject', 'Chemistry'); await page.fill('#dknTime', '18:30');
      assert.match(await page.textContent('#dknPreview'), /4 mocks · Every [A-Z][a-z]+day · 6:30 pm[\s\S]*₹1699/i);
      if (width === 390) await shot(page, 'desk-15-new-pack-390');
      await page.click('#dknCreate'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      const np = ctx.patches.find(p => /^mockPackages\/pk/.test(p.path) && p.body.fields.title);
      assert.ok(np, 'pack saved'); assert.equal(np.body.fields.priceInr.integerValue, '1699'); assert.equal(np.body.fields.mocks.integerValue, '4');
      assert.equal(np.body.fields.schedule.arrayValue.values.length, 4); assert.equal(np.body.fields.class.stringValue, '12'); assert.equal(np.body.fields.active.booleanValue, true);
      assert.match(np.body.fields.title.stringValue, /Chemistry · 4 weekly mocks/);
      assert.equal(await page.textContent('#dkN-packages'), '2'); assert.match(await page.textContent('#dkToast'), /is on sale/);
      await page.locator('.dk-row[data-dk-open="' + np.path.split('/')[1] + '"]').click(); await page.waitForSelector('#dkPackToggle');
      await page.click('#dkPackToggle'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.ok(ctx.patches.some(p => p.path === np.path && p.body.fields.active && p.body.fields.active.booleanValue === false), 'pack paused');
      assert.match(await page.locator('.dk-row[data-dk-open="' + np.path.split('/')[1] + '"]').textContent(), /Paused/);

      // Papers: close one, publish one.
      await page.click('[data-dk-tab=papers]'); await page.waitForSelector('.dk-row .dk-av.paper');
      await shot(page, 'desk-05-papers-' + width);
      await page.locator('.dk-row').first().click(); await page.waitForSelector('#dkToggle');
      await page.click('#dkToggle'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      assert.ok(ctx.patches.some(p => /^offlineTests\//.test(p.path) && p.body.fields.isActive.booleanValue === false), 'paper closed');
      assert.match(await page.locator('.dk-row').first().textContent(), /Closed/);
      await page.click('#dkNew'); await page.waitForSelector('#dkPublish');
      await page.click('#dkPublish'); assert.match(await page.textContent('#dkMsg'), /Choose the teacher/);
      await page.selectOption('#dkpTeacher', 'teacher-2'); await page.selectOption('#dkpKind', 'mock');
      await page.selectOption('#dkpClass', '10'); await page.selectOption('#dkpSubject', 'Physics');
      await page.fill('#dkpChapter', 'Full syllabus'); await page.fill('#dkpName', 'Full mock 1'); await page.fill('#dkpMarks', '80'); await page.fill('#dkpTime', '180');
      await page.setInputFiles('#dkpFile', paperPdf);
      if (width === 390) await shot(page, 'desk-06-new-paper-390');
      await page.click('#dkPublish'); await page.waitForSelector('#dkSheet', { state: 'hidden' });
      const made = ctx.patches.find(p => /^offlineTests\/ots/.test(p.path) && p.body.fields.testName && p.body.fields.testName.stringValue === 'Full mock 1');
      assert.ok(made, 'paper published'); assert.equal(made.body.fields.series.stringValue, 'online'); assert.equal(made.body.fields.kind.stringValue, 'mock');
      assert.equal(made.body.fields.teacherName.stringValue, 'Neha Gupta'); assert.equal(made.body.fields.gradingMode.stringValue, 'teacher');
      assert.ok(ctx.patches.some(p => /^offlineTestKeys\//.test(p.path) && /ucarecd/.test(p.body.fields.questionPdfUrl.stringValue)), 'question paper stored privately');
      await page.selectOption('#dkClass', '10');
      assert.match(await page.locator('.dk-row', { has: page.locator('b', { hasText: /^Full mock 1$/ }) }).textContent(), /Full mock 1[\s\S]*Online · Full mock[\s\S]*Live/);
      assert.ok((await page.locator('.dk-gh').allInnerTexts()).some(t => /Class 10[\s\S]*Physics/.test(t)), 'new paper sits in its Class 10 · Physics group');
      await page.selectOption('#dkClass', '');
      assert.ok(await fits(page), 'no horizontal overflow after publishing at ' + width);
      // Online Students → Promo codes: create one (never overwriting an existing code).
      if (width === 390) {
        await page.evaluate(() => switchAdminTab('online-students'));
        await page.waitForSelector('[data-ona-view=promos]');
        await page.click('[data-ona-view=promos]'); await page.waitForSelector('#onaPCreate');
        assert.equal(await page.locator('.portal-browser:visible').count(), 0, 'no student search panel on the Promo codes view');
        assert.match(await page.inputValue('#onaPCode'), /^TNC[A-Z2-9]{5}$/, 'random code suggested');
        await page.fill('#onaPCode', 'riya chapter'); await page.click('#onaPCreate');
        assert.match(await page.textContent('#onaPMsg'), /capital letters or digits/);
        await page.fill('#onaPCode', 'tncriya1'); await page.selectOption('#onaPScope', 'chapter'); await page.fill('#onaPNote', 'Physics chapter 3');
        await page.fill('#onaPMaxValue', '399'); await page.fill('#onaPMaxCh', '2');
        // Only for: lock the code to one Google student (TNC students are not offered).
        await page.fill('#onaPFor', 'riya');
        assert.equal(await page.locator('#onaPForList [data-pfor]').count(), 2, 'Google and TNC students are offered (TNC students pay for custom tests and packs)');
        await page.click('#onaPCreate'); assert.match(await page.textContent('#onaPMsg'), /Tap a student/);
        await page.click('[data-pfor=riya]'); await page.waitForSelector('.oar-for');
        assert.match(await page.textContent('.oar-for'), /Riya Sharma[\s\S]*TNC-ON-RIYA · Class 10/);
        await page.click('#onaPCreate'); await page.waitForSelector('#onaPList .oar-row');
        const made = ctx.patches.find(p => p.path === 'promoCodes/TNCRIYA1');
        assert.ok(await page.locator('#onaPScope option[value=package]').count(), 'mock-pack promo scope offered');
        assert.ok(made, 'code saved'); assert.equal(made.body.fields.scope.stringValue, 'chapter');
        assert.equal(made.body.fields.maxValueInr.integerValue, '399'); assert.equal(made.body.fields.maxChapters.integerValue, '2');
        assert.match(await page.textContent('#onaPList'), /Covers up to ₹399 · up to 2 chapters/);
        assert.equal(made.body.fields.forUid.stringValue, 'riya'); assert.equal(made.body.fields.forOnlineId.stringValue, 'TNC-ON-RIYA');
        assert.match(await page.textContent('#onaPMsg'), /for Riya Sharma\. Only this student can use it/); assert.equal(made.body.fields.maxUses.integerValue, '1'); assert.equal(made.body.fields.uses.integerValue, '0');
        assert.match(await page.textContent('#onaPList'), /TNCRIYA1[\s\S]*Chapter-wise tests[\s\S]*For Riya Sharma · TNC-ON-RIYA · Class 10[\s\S]*Active[\s\S]*0 \/ 1 used/);
        await shot(page, 'desk-10-promo-codes-390');
        await page.click('[data-promo-toggle=TNCRIYA1]'); await page.waitForFunction(() => /Off/.test(document.querySelector('#onaPList').textContent));
        assert.ok(ctx.patches.some(p => p.path === 'promoCodes/TNCRIYA1' && p.body.fields.active && p.body.fields.active.booleanValue === false), 'code switched off');
        // From a student's details: Give a promo code → the form opens locked to that student.
        await page.click('[data-ona-view=students]'); await page.click('[data-ona-open=riya]'); await page.waitForSelector('[data-pfor-give=riya]');
        await page.click('[data-pfor-give=riya]'); await page.waitForSelector('#onaPromoBox[open] .oar-for');
        assert.match(await page.textContent('.oar-for'), /Riya Sharma/);
        await shot(page, 'desk-16-promo-only-for-390');
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log('✓ Test Desk ' + width + 'px: blinking count ' + pendingTotal + ' → check & send back → ' + (pendingTotal - 1) + ' · search, filters, paging · checked · students + permanent delete · custom paper request · mock packs (upload due mock, new pack, pause) · close + publish a paper');
    }
    console.log('Screenshots: ' + path.relative(root, deskOut));
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
`;
const run = new Module(file, module); run.filename = file; run.paths = module.paths;
run._compile(src + main, file);
