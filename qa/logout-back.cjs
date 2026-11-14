/* Sign out, then press Back — for the student, teacher and admin portals.
   Expected: Sign out → login page → Back → the homepage (/), never the dashboard
   (not even a cached copy of it), and the signed-out portal stays closed.
   Reuses the fixtures and Firebase fakes of portal-smoke.cjs; nothing touches
   production. Run with Playwright on NODE_PATH: node qa/logout-back.cjs */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const file = path.resolve(__dirname, 'portal-smoke.cjs');
let src = fs.readFileSync(file, 'utf8');
// Routing from the smoke test, reused as-is.
const routeStart = src.indexOf("await page.route('**/*',async route=>{");
const routeEnd = src.indexOf("   const file=isLogin?", routeStart);
const routeCode = src.slice(routeStart, routeEnd);
src = src.slice(0, src.indexOf('(async()=>{'));
// Sign-out survives page loads in this test (real Firebase keeps it in storage).
// The static server also serves the homepage at "/" (history navigations bypass page routes in some cases).
src = src.replace('if(!file.startsWith(root+path.sep))', 'if(file!==root&&!file.startsWith(root+path.sep))');
src = src.replace('currentUser:window.__isLogin?null:', "currentUser:(window.__isLogin||sessionStorage.getItem('fixtureSignOutCalls'))?null:");
const main = String.raw`
const shots = path.join(__dirname, 'artifacts', 'logout-back'); fs.mkdirSync(shots, { recursive: true });
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    for (const role of (process.env.LOGOUT_ROLES || 'student,teacher,admin').split(',')) {
      for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        const errors = []; const writes = []; let reads = 0; const isLogin = false;
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(({ role, fixture }) => { window.__role = role; window.__fixtures = fixture; window.__isLogin = false; }, { role, fixture });
        ${routeCode}
        // Clean URLs used by the portals, served from the real files (registered last, so they win).
        await page.route('**/login/' + role, r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, role + '-login.html'), 'utf8') }));
        await page.route(u => new URL(u).origin === origin && new URL(u).pathname === '/', r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'index.html'), 'utf8') }));
        // Homepage → (login) → dashboard, like a real visit.
        await page.goto(origin + '/');
        await page.goto(origin + '/' + (role === 'admin' ? 'admin-panel.html' : role + '-dashboard.html'));
        await page.waitForSelector('#sidebar [data-section]', { state: 'attached' });
        await page.waitForTimeout(600);
        // Open two other sections so the dashboard has its own Back history.
        const sections = await page.$$eval('#sidebar [data-section]', els => els.map(e => e.dataset.section).filter(Boolean));
        for (const s of sections.slice(1, 3)) { await page.evaluate(name => document.querySelector('#sidebar [data-section="' + name + '"]').click(), s); await page.waitForTimeout(250); }
        // Sign out the way a user does.
        if (role === 'student') {
          if (!await page.locator('.ntc-pf-logout').isVisible()) await page.getByRole('button', { name: 'Open profile', exact: true }).click();
          await page.locator('.ntc-pf-logout').click();
        } else if (role === 'teacher') {
          if (!await page.locator('#profileLogoutBtn').isVisible()) await page.evaluate(() => document.querySelector('#sidebar [data-section="profile"]').click());
          await page.locator('#profileLogoutBtn').click();
        } else if (await page.locator('#logoutBtn').isVisible()) await page.locator('#logoutBtn').click();
        else await page.evaluate(() => window.adminLogout());
        await page.locator('.ntc-out-sheet').getByRole('button', { name: 'Sign out', exact: true }).click();
        const t0 = Date.now();
        await page.waitForURL('**/login/' + role);
        assert.ok(Date.now() - t0 >= 600, role + ': goodbye screen is not cut short (' + (Date.now() - t0) + 'ms)');
        await page.waitForTimeout(400);
        // Back → homepage, not the dashboard.
        await page.goBack(); await page.waitForLoadState('load'); await page.waitForTimeout(700);
        const at = new URL(page.url());
        const onDash = await page.locator('#sidebar [data-section]').count();
        await page.screenshot({ path: path.join(shots, role + '-' + width + '-after-back.png') });
        assert.equal(at.pathname, '/', role + ' ' + width + ': Back after sign-out goes to the homepage (was ' + at.pathname + ')');
        assert.equal(await page.locator('#tnc-splash:visible').count(), 0, role + ': no launch screen when coming back to the homepage');
        assert.equal(onDash, 0, role + ' ' + width + ': the dashboard is not shown after Back');
        // Forward / Back again never reopen a signed-in dashboard.
        await page.goBack(); await page.waitForTimeout(500);
        assert.equal(await page.locator('#sidebar [data-section]').count(), 0, role + ': a second Back does not reveal the dashboard');
        // Chrome logs this itself whenever a page with @view-transition hands over to the homepage (no opt-in); page code cannot catch it.
        assert.deepEqual(errors.filter(e => !/Failed to fetch|NetworkError|ViewTransition opt-in disabled/.test(e)), [], role + ' errors');
        await page.close();
        console.log('✓ ' + role + ' ' + width + 'px: Sign out → login → Back → homepage; dashboard never shown again');
      }
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e.message || e); server.close(); process.exitCode = 1; });
`;
const run = new Module(file, module); run.filename = file; run.paths = module.paths;
run._compile(src + main, file);
