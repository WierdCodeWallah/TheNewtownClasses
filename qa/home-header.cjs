/* Local homepage header checks. External services are blocked; no cloud writes. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'home-header');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    const widths = process.env.HEADER_WIDTHS ? process.env.HEADER_WIDTHS.split(',').map(Number) : [320, 360, 375, 390, 414, 430, 768, 844, 1024, 1100, 1440, 1920];
    for (const width of widths) {
      const mobile = width < 1100;
      const height = width === 844 ? 390 : 900;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'header.test') return route.abort();
        const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
        const contentType = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType, body: fs.readFileSync(file) });
      });
      await page.addInitScript(() => sessionStorage.setItem('tnc-splash-seen', '1'));
      await page.goto('http://header.test/');
      await page.locator('.prep-ribbon.is-ready').waitFor();
      assert.equal((await page.locator('.site-brand strong').textContent()).replace(/\s+/g, ' ').trim(), 'THE NEWTOWN CLASSES');
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.prep-chip-featured.is-highlighted').count(), 1, 'highlight exactly one course');
      if (width === 390) {
        for (const name of ['JEE', 'Olympiad', 'Class 7–12 · CBSE / ICSE']) {
          await page.waitForFunction(expected => document.querySelector('.prep-chip-featured.is-highlighted')?.textContent === expected, name, { timeout: 4500 });
          await page.waitForTimeout(450);
          const chip = await page.locator('.prep-chip-featured.is-highlighted').boundingBox();
          const rail = await page.locator('.prep-ribbon-window').boundingBox();
          assert(chip.x >= rail.x - 1 && chip.x + chip.width <= rail.x + rail.width - 10, 'active course is clipped on phone');
          assert(await page.evaluate(() => scrollY === 0), 'course highlight moved the page');
        }
        await page.screenshot({ path: path.join(out, 'highlight-390.png') });
        await page.locator('.prep-motion').tap();
        const pausedCourse = await page.locator('.is-highlighted').textContent();
        await page.waitForTimeout(3200);
        assert.equal(await page.locator('.is-highlighted').textContent(), pausedCourse, 'pause failed');
        await page.locator('.prep-motion').tap();
        await page.waitForFunction(() => document.querySelector('.is-highlighted')?.textContent === 'NEET', null, { timeout: 4500 });
        await page.locator('.prep-ribbon-window').tap();
        assert.equal(await page.locator('.prep-motion').getAttribute('aria-pressed'), 'true', 'manual browsing should pause highlights');
      }
      for (const selector of ['.site-brand', '.site-header', '.prep-ribbon', '.prep-ribbon-intro']) {
        const box = await page.locator(selector).boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= width + 1, `${selector} overflows at ${width}`);
      }
      if (mobile) {
        const ribbon = await page.locator('.prep-ribbon').boundingBox();
        if (width <= 600) assert((await page.locator('.prep-ribbon-inner').boundingBox()).height <= 105, 'phone course strip is too tall');
        assert(ribbon.y + ribbon.height <= 420, 'welcome header takes too much phone space');
        assert.equal(await page.locator('.prep-ribbon-track').evaluate(el => getComputedStyle(el).animationName), 'none');
        assert.equal(await page.locator('.site-nav').isVisible(), false);
        await page.locator('.site-menu-toggle').tap();
        assert.equal(await page.locator('.site-menu-toggle').getAttribute('aria-expanded'), 'true');
        assert(await page.locator('.site-nav').isVisible());
        await page.locator('.site-login-toggle').tap();
        assert(await page.locator('.site-login-links').isVisible());
        const menu = await page.locator('.site-nav').boundingBox();
        const brand = await page.locator('.site-brand').boundingBox();
        assert(brand.y >= 0, 'sticky header scrolled out of view while opening login');
        assert(menu.y >= 0, 'menu top is clipped');
        assert(menu.y + menu.height <= height + 1, 'menu exceeds available height');
        if (width === 390) await page.screenshot({ path: path.join(out, 'menu-390.png') });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.site-login-links').isVisible(), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.site-nav').isVisible(), false);
        assert(await page.locator('.site-menu-toggle').evaluate(el => el === document.activeElement));
        await page.locator('.site-menu-toggle').tap();
        await page.locator('.site-utility').tap();
        assert.equal(await page.locator('.site-menu-toggle').getAttribute('aria-expanded'), 'false');
        // Native scrolling must expose the final program.
        await page.locator('.prep-ribbon-window').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        const last = await page.locator('.prep-ribbon-group').first().locator('li').last().boundingBox();
        assert(last.x >= 0 && last.x + last.width <= width, 'last course is unreachable');
        await page.locator('.prep-ribbon-window').evaluate(el => { el.scrollLeft = 0; });
      } else {
        await page.locator('.site-login-toggle').click();
        assert(await page.locator('.site-login-links').isVisible());
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.site-login-links').isVisible(), false);
        assert.equal(await page.locator('.prep-ribbon-track').evaluate(el => getComputedStyle(el).animationName), 'none');
      }
      if (await page.locator('.prep-next').isVisible()) {
        assert((await page.locator('.prep-next').boundingBox()).height >= 44, 'small course control target');
        await page.locator('.prep-next').click();
        await page.waitForFunction(() => document.querySelector('.prep-ribbon-window').scrollLeft > 20);
        await page.locator('.prep-ribbon-window').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await page.waitForFunction(() => document.querySelector('.prep-next').classList.contains('is-end'));
        await page.locator('.prep-next').click();
        await page.waitForFunction(() => document.querySelector('.prep-ribbon-window').scrollLeft < 2);
      } else {
        assert(await page.locator('.prep-ribbon-window').evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'hidden control prevents course access');
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(out, `home-${width}.png`) });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => !document.querySelector('.prep-chip-featured.is-highlighted'), null, { timeout: 1500 });
      assert.equal(await page.locator('.prep-ribbon-track').evaluate(el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.locator('.prep-chip-featured.is-highlighted').count(), 0, 'reduced motion must not cycle courses');
      assert.equal(await page.locator('.prep-motion').isVisible(), false);
      if (await page.locator('.prep-next').isVisible()) {
        await page.locator('.prep-ribbon-window').evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }));
        await page.waitForFunction(() => !document.querySelector('.prep-next').classList.contains('is-end'));
        await page.locator('.prep-next').click();
        await page.waitForFunction(() => {
          const el = document.querySelector('.prep-ribbon-window');
          return el.scrollLeft > Math.min(20, (el.scrollWidth - el.clientWidth) / 2);
        });
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`${width}px: layout, navigation, course access, motion and reduced motion passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
