/* Footer responsiveness and native disclosure checks; external services are blocked. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'home-footer');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [320, 390, 430, 600, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'footer.test') return route.abort();
        const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
        const contentType = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
      });
      await page.addInitScript(() => sessionStorage.setItem('tnc-splash-seen', '1'));
      await page.goto('http://footer.test/');
      const footer = page.locator('.site-footer');
      await footer.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const closedCount = await footer.locator('details:not([open])').count();
      assert.equal(closedCount, width <= 600 ? 2 : 0);
      const box = await footer.boundingBox();
      assert(box.height < 400, `Footer too tall at ${width}: ${box.height}`);
      const overflow = await footer.evaluate(el => [...el.querySelectorAll('*')].filter(e => {
        if (!e.getClientRects().length) return false;
        const r = e.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1;
      }).map(e => e.className));
      assert.deepEqual(overflow, [], `Footer overflow at ${width}`);
      await footer.screenshot({ path: path.join(out, `footer-${width}.png`) });
      if (width <= 600) {
        const summary = footer.locator('summary').first();
        await summary.focus();
        await page.keyboard.press('Enter');
        assert(await footer.locator('details').first().getAttribute('open') !== null);
        assert(await footer.getByRole('link', { name: 'NEET Coaching', exact: true }).isVisible());
        for (const link of await footer.locator('.footer-group').first().getByRole('link').all()) {
          assert((await link.boundingBox()).height >= 44, 'Course link touch target too small');
        }
        await footer.screenshot({ path: path.join(out, `footer-expanded-${width}.png`) });
        await summary.focus();
        await page.keyboard.press('Space');
        assert.equal(await footer.locator('details:not([open])').count(), 2);
        await page.setViewportSize({ width: 1024, height: 900 });
        assert.equal(await footer.locator('details[open]').count(), 2, 'Links must reopen at desktop width');
      }
      console.log(`${width}px: ${Math.round(box.height)}px footer; layout and disclosures passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
