/* Online Test Series — "impatient user" stress check on a phone (390 / 320 px, touch).
   Hammers the portal the way a real, irritated student would and fails on any
   JS error, stuck button, double charge, broken Back button or layout overflow:
     · rapid tab switching (and how long each switch takes)
     · double / triple taps on Pay → one order only
     · closing Razorpay → button usable again; failed confirmation → clear message, nothing unlocked
     · phone Back with a sheet / the More sheet open → closes it, stays in the app
     · going offline mid-session → offline badge, friendly errors, recovers online
     · a name containing HTML / script → shown as text, never run
     · every tab at 320 px with no sideways scrolling
   Reuses the fixtures and network fakes of online-series.cjs; nothing touches production.
   Run with Playwright on NODE_PATH: node qa/online-stress.cjs */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const file = path.resolve(__dirname, 'online-series.cjs');
let src = fs.readFileSync(file, 'utf8');
src = src.slice(0, src.indexOf('(async () => {'));
const main = String.raw`
const stressOut = path.join(__dirname, 'artifacts', 'online-stress'); fs.mkdirSync(stressOut, { recursive: true });
const snap = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(stressOut, name + '.png') }); };
const riya = { uid: 'riya', displayName: 'Riya Sharma', email: 'riya@example.test' };
const findings = [];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    // ── 1. Rapid tab switching ──
    {
      const state = newState({ user: riya });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      const tabs = ['custom', 'results', 'home', 'custom', 'home', 'results'];
      for (let round = 0; round < 4; round++) for (const t of tabs) await page.click('#nav [data-tab=' + t + ']', { delay: 0 });
      await page.waitForSelector('.v-results');
      assert.equal(await page.evaluate(() => location.hash), '#/results', 'last tap wins');
      // Time a switch: tap → new view painted.
      const ms = [];
      for (const t of ['home', 'custom', 'results', 'home']) {
        const t0 = await page.evaluate(() => performance.now());
        await page.click('#nav [data-tab=' + t + ']');
        await page.waitForSelector('#nav [data-tab=' + t + '].on');
        ms.push(Math.round((await page.evaluate(() => performance.now())) - t0));
      }
      const worst = Math.max(...ms);
      assert.ok(worst < 250, 'tab switch feels instant (worst ' + worst + 'ms)');
      // More sheet opened and closed repeatedly.
      for (let i = 0; i < 5; i++) { await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu'); await page.keyboard.press('Escape'); await page.waitForSelector('#sheet', { state: 'hidden' }); }
      // Phone Back closes the More sheet instead of leaving the app.
      await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu');
      await page.goBack(); await page.waitForSelector('#sheet', { state: 'hidden' });
      assert.match(await page.evaluate(() => location.href), /test-series/, 'still in the app after Back');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ rapid tabs: 24 taps, last tap wins, worst switch ' + worst + 'ms; More sheet opens/closes cleanly; Back closes it');
    }

    // ── 2. Payment abuse: double taps, closing Razorpay, failed confirmation ──
    {
      const state = newState({ user: riya });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await page.click('.subj:has-text("Physics")'); await page.click('[data-seg=chapter]');
      // a) Student closes the Razorpay window → Pay works again, nothing unlocked.
      await page.evaluate(() => { window.__dismiss = true; });
      await page.addInitScript(() => {});
      await page.route('https://checkout.razorpay.com/**', route => route.fulfill({ contentType: 'text/javascript', body:
        "window.Razorpay=function(o){this.o=o;};window.Razorpay.prototype.on=function(){};window.Razorpay.prototype.open=function(){window.__rzOpens=(window.__rzOpens||0)+1;const o=this.o;if(window.__dismiss){setTimeout(()=>o.modal.ondismiss(),1500);}else{setTimeout(()=>o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:'pay_Fx000001',razorpay_signature:'a'.repeat(64)}),150);}};" }));
      await page.click('.row:has-text("Chapter test 1")'); await page.waitForSelector('#sheet.on [data-go=pay]');
      const calls0 = state.calls.filter(c => c === 'create-order').length;
      await page.locator('[data-go=pay]').click({ clickCount: 3, delay: 20 });
      await page.waitForFunction(() => window.__rzOpens >= 1);
      await page.waitForFunction(() => { const b = document.querySelector('[data-go=pay]'); return b && !b.disabled && !b.getAttribute('aria-busy'); }, null, { timeout: 4000 });
      assert.equal(state.calls.filter(c => c === 'create-order').length - calls0, 1, 'triple tap → one order');
      assert.equal(await page.evaluate(() => window.__rzOpens), 1, 'Razorpay opened once');
      assert.ok(!state.unlocked.includes('phy1'), 'closing Razorpay unlocks nothing');
      // b) Payment confirmation fails (server says no) → clear message, still locked.
      await page.evaluate(() => { window.__dismiss = false; });
      state.failVerify = true;
      await page.click('[data-go=pay]');
      await page.waitForSelector('#sheet .celebrate.err', { timeout: 20000 });
      assert.match(await page.textContent('#sheet .celebrate.err'), /still confirming|Payment ID/i, 'honest message with the payment ID');
      assert.ok(!state.unlocked.includes('phy1'));
      await snap(page, 'pay-confirm-failed-390');
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      // c) Phone Back with the unlock sheet open → sheet closes, subject list stays.
      await page.click('.row:has-text("Chapter test 2")'); await page.waitForSelector('#sheet.on');
      await page.goBack(); await page.waitForSelector('#sheet', { state: 'hidden' });
      assert.equal(await page.evaluate(() => location.hash), '#/s/Physics', 'Back closed the sheet, not the page');
      assert.deepEqual(errors.filter(e => !/verify|confirm/i.test(e)), []); await page.close();
      console.log('✓ payments: triple tap → 1 order / 1 Razorpay window; closing Razorpay re-enables Pay; failed confirmation → honest message, nothing unlocked; Back closes the sheet');
    }

    // ── 3. Offline in the middle of using it ──
    {
      const state = newState({ user: riya });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.waitForSelector('#netBadge:not([hidden])');
      await page.click('#nav [data-tab=custom]'); await page.waitForSelector('.v-custom');
      await page.click('#nav [data-tab=home]'); await page.waitForSelector('.v-home .subj');
      await snap(page, 'offline-390');
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForSelector('#netBadge', { state: 'hidden' });
      assert.deepEqual(errors.filter(e => !/Failed to fetch|NetworkError|ERR_INTERNET|net::/i.test(e)), []); await page.close();
      console.log('✓ offline: badge shows, cached screens still work, recovers when back online');
    }

    // ── 4. Hostile text in a name ──
    {
      const evil = '<img src=x onerror="window.__xss=1">Riya';
      const state = newState({ user: riya, profiles: { riya: { ...profile, name: evil, school: '<script>window.__xss=2</script>' } } });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      for (const t of ['home', 'custom', 'results']) { await page.click('#nav [data-tab=' + t + ']'); await page.waitForTimeout(80); }
      await page.click('#navMore'); await page.waitForSelector('.more-menu'); await page.click('.more-menu a[href="#/me"]'); await page.waitForSelector('.me-card');
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'injected HTML never runs');
      assert.match(await page.textContent('.me-card'), /<img src=x/, 'shown as plain text');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ security: HTML / script in a name or school is shown as text and never runs');
    }

    // ── 5. Small phone (320 px): every tab, no sideways scroll, tab bar fixed ──
    {
      const state = newState({ user: riya, packages: [{ id: 'pkphy8', title: 'Physics · 8 weekly mocks with a very long name for small screens', class: '10', board: '', subject: 'Physics', mocks: 8, priceInr: 3199, active: true, description: '',
        schedule: Array.from({ length: 8 }, (_, i) => new Date(Date.now() + (i * 7 + 2) * 86400000).toISOString()) }] });
      const { page, errors } = await open(browser, origin, state, { width: 320, height: 640 });
      await page.waitForSelector('.v-home .subj');
      for (const t of ['home', 'custom', 'results', 'ranks', 'packs', 'me']) {
        if (['ranks', 'packs', 'me'].includes(t)) { await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu'); await page.click('.more-menu a[href="#/' + t + '"]'); await page.waitForSelector('#sheet', { state: 'hidden' }); }
        else await page.click('#nav [data-tab=' + t + ']');
        await page.waitForTimeout(150);
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, nav: Math.round(document.querySelector('#nav').getBoundingClientRect().bottom), h: innerHeight }));
        assert.ok(o.sw <= o.w, t + ': no sideways scroll at 320 (' + o.sw + ' > ' + o.w + ')');
        assert.ok(Math.abs(o.nav - o.h) <= 1, t + ': tab bar sits at the bottom');
        await snap(page, 'p320-' + t);
      }
      const tapH = await page.locator('#nav [data-tab]:visible').evaluateAll(els => Math.min(...els.map(e => e.getBoundingClientRect().height)));
      assert.ok(tapH >= 48, 'tab bar targets ≥ 48px (' + tapH + ')');
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ 320px: all 6 pages fit with no sideways scroll, tab bar fixed at the bottom, 48px+ tap targets');
    }
    // ── 6. Sign out, then Back → homepage (not old tabs behind the sign-in screen) ──
    {
      const state = newState({ user: riya });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.route(u => new URL(u).origin === origin && new URL(u).pathname === '/', r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'index.html'), 'utf8') }));
      await page.waitForSelector('.v-home .subj');
      for (const t of ['custom', 'results', 'home']) { await page.click('#nav [data-tab=' + t + ']'); await page.waitForTimeout(120); }
      await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu'); await page.click('.more-menu a[href="#/me"]'); await page.waitForSelector('.me-card');
      await page.click('[data-act=signout]'); await page.waitForSelector('#sheet.on [data-out]'); await page.click('[data-out]');
      await page.waitForFunction(() => document.body.dataset.screen === 'auth');
      assert.equal(new URL(page.url()).hash, '', 'old tab cleared from the address bar');
      await page.goBack(); await page.waitForURL(u => new URL(u).pathname === '/');
      assert.equal(await page.locator('#app').count(), 0, 'homepage shown, not the test series');
      assert.deepEqual(errors.filter(e => !/ViewTransition opt-in disabled/.test(e)), []); await page.close();
      console.log('✓ sign out: Back goes straight to the homepage');
    }
    // ── 7. Picking chapters never redraws the screen; a 2-chapter code stops covering a bigger cart ──
    {
      const state = newState({ user: riya, paymentsReady: false });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await page.click('#nav [data-tab=custom]');
      await page.waitForSelector('.v-custom .row.pick');
      await page.click('[data-cboard=CBSE]'); await page.waitForSelector('[data-cboard=CBSE][aria-selected=true]');   // the fixture student is ICSE
      // Mark the screen: a full redraw would replace these elements.
      await page.evaluate(() => { document.querySelector('.v-custom').dataset.mark = '1'; document.querySelector('.row.pick[data-ch="5"]').dataset.mark = '1'; });
      // Taps done in the page itself, so the test runner never scrolls for us.
      const scrollBefore = await page.evaluate(() => { const v = document.getElementById('view'); v.scrollTop = 200; return v.scrollTop; });
      for (const i of [0, 1, 2, 1]) await page.evaluate(n => document.querySelector('.row.pick[data-ch="' + n + '"]').click(), i);
      const kept = await page.evaluate(() => ({ view: document.querySelector('.v-custom').dataset.mark, row: document.querySelector('.row.pick[data-ch="5"]').dataset.mark, scroll: document.getElementById('view').scrollTop,
        picked: [...document.querySelectorAll('.row.pick[aria-pressed=true]')].map(b => b.dataset.ch), bar: document.querySelector('.cart-bar b').textContent, chip: document.querySelector('[data-csub=Science] i').textContent }));
      assert.equal(kept.view, '1', 'screen not redrawn'); assert.equal(kept.row, '1', 'other rows untouched'); assert.equal(kept.scroll, scrollBefore, 'scroll position kept');
      assert.deepEqual(kept.picked, ['0', '2']); assert.match(kept.bar, /2 chapters · ₹398/); assert.equal(kept.chip, '2', 'subject count updated');
      await page.click('[data-call]'); await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => document.querySelector('.v-custom').dataset.mark), '1', 'Select all does not redraw either');
      await page.click('[data-call]');                                  // Clear
      assert.equal(await page.locator('.cart-bar').count(), 0, 'cart bar goes away when empty');
      // 2 chapters → apply the 2-chapter code → ₹0.
      await page.click('.row.pick[data-ch="0"]'); await page.click('.row.pick[data-ch="1"]');
      await page.click('[data-cart]'); await page.waitForSelector('#sheet.on .contact-card');
      await page.fill('#promoInput', 'tnctwo2'); await page.click('[data-promo-apply]'); await page.waitForSelector('#sheet .promo.ok');
      assert.match(await page.textContent('#sheet .total'), /₹0/);
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      // Add 2 Mathematics chapters → the code no longer covers the cart.
      await page.click('[data-csub=Mathematics]'); await page.click('.row.pick[data-ch="0"]'); await page.click('.row.pick[data-ch="1"]');
      await page.click('[data-cart]'); await page.waitForSelector('#sheet.on .promo.warn');
      assert.match(await page.textContent('#sheet .promo.warn'), /TNCTWO2 covers up to 2 chapters — remove 2 to use it/);
      assert.match(await page.textContent('#sheet .total'), /₹796/, 'full price shown, not ₹0');
      assert.equal(await page.locator('#sheet [data-buy]:has-text("₹0")').count(), 0, 'no ₹0 order button');
      await snap(page, 'promo-limit-cart-390');
      // Applying it fresh on the 4-chapter cart is refused by the server.
      await page.click('#sheet .promo.warn [data-promo-remove]'); await page.waitForSelector('#sheet .promo-box');
      await page.fill('#promoInput', 'TNCTWO2'); await page.click('[data-promo-apply]');
      await page.waitForFunction(() => /covers up to 2 chapters/.test(document.querySelector('#promoMsg').textContent));
      assert.deepEqual(errors, []); await page.close();
      console.log('✓ custom test: chapter taps update in place (no redraw, scroll kept); a 2-chapter code stops covering a 4-chapter cart and is refused if re-applied');
    }
    // A background database refresh must never resurrect a signed-out account.
    for (const switchAccount of [false, true]) {
      const state = newState({ user: riya, results, profiles: { riya: profile, meera: { ...profile, uid: 'meera', name: 'Meera Iyer' } } });
      const { page, errors } = await open(browser, origin, state);
      await page.route('**/assets/js/online-series.js*', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'assets/js/online-series.js'), 'utf8') + '\nwindow.__review={S,refresh,signOutNow};' }));
      await page.reload(); await page.waitForSelector('.v-home .subj');
      let release, started;
      const gate = new Promise(r => { release = r; }), waiting = new Promise(r => { started = r; });
      await page.route('https://firestore.googleapis.com/**', async r => {
        if ((r.request().headers().authorization || '').includes('tok-riya')) { started(); await gate; }
        await r.fallback();
      });
      await page.evaluate(() => { window.__oldRefresh = window.__review.refresh(); }); await waiting;
      await page.evaluate(() => window.__review.signOutNow());
      assert.equal(await page.locator('#view').textContent(), '', 'private dashboard DOM cleared on logout');
      if (switchAccount) { await page.click('#googleBtn'); await page.waitForSelector('.v-home:has-text("Meera")'); }
      release(); await page.evaluate(() => window.__oldRefresh);
      const current = await page.evaluate(() => ({ screen: document.body.dataset.screen, uid: window.__review.S.user?.uid || null, sessionUid: window.__review.S.session?.uid || null, text: document.getElementById('view').innerText }));
      assert.equal(current.screen, switchAccount ? 'app' : 'auth');
      assert.equal(current.uid, switchAccount ? 'meera' : null);
      assert.equal(current.sessionUid, switchAccount ? 'meera' : null);
      assert.ok(!current.text.includes('Riya'), 'old student never returns');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ delayed refresh after logout/account switch: no old dashboard or session restored');
  } finally { await browser.close(); server.close(); }
  console.log('All stress checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
`;
const run = new Module(file, module); run.filename = file; run.paths = module.paths;
run._compile(src.replace("if (b.action === 'verify-payment') { state.unlocked.push('phy1');", "if (b.action === 'verify-payment' && state.failVerify) return route.fulfill({ status: 400, json: { error: 'We could not confirm this payment.' } });\n      if (b.action === 'verify-payment') { state.unlocked.push('phy1');") + main, file);
