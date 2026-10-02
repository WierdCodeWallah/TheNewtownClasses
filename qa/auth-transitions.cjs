/* UI regression checks. Uses the real assets with local auth callbacks only. */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'auth-transitions');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1440,height:900}]) {
      const page = await browser.newPage({ viewport });
      await page.route('**/*', route => route.fulfill({ contentType:'text/html', body:'<title>Local UI fixture</title>' }));
      await page.goto('http://auth-ui.test');
      await page.setContent('<body data-login="student"><div class="login-wrapper"><form class="login-form"><input id="field"><button class="login-btn">Login</button></form></div></body>');
      await page.addStyleTag({ path:path.join(root,'assets/css/auth-transitions.css') });
      await page.addScriptTag({ path:path.join(root,'assets/js/login-boot.js') });
      await page.addScriptTag({ path:path.join(root,'assets/js/portal-logout.js') });
      const fits = async selector => {
        const rect = await page.locator(selector).boundingBox();
        assert(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1, selector + ' exceeds viewport width');
      };
      await page.locator('#field').focus();
      await page.evaluate(() => window.ntcLogin.stage(0));
      await page.waitForTimeout(450);
      assert(await page.locator('.login-wrapper').evaluate(el => el.inert));
      assert(await page.locator('#field').evaluate(el => el !== document.activeElement));
      await fits('.ntc-launch-title');
      await fits('.ntc-launch-dots');
      await page.screenshot({path:path.join(out,`login-${viewport.width}.png`)});
      // Rapid updates must never display an old step or leave its text transparent.
      await page.evaluate(() => { ntcLogin.stage(1); ntcLogin.stage(2); ntcLogin.stage(0); });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.ntc-launch-step').textContent(), 'Signing you in…');
      assert.equal(await page.locator('.ntc-launch-step').evaluate(el => getComputedStyle(el).opacity), '1');
      await page.evaluate(() => window.ntcLogin.hide());
      assert.equal(await page.locator('.login-wrapper').evaluate(el => el.inert), false);
      assert(await page.locator('#field').evaluate(el => el === document.activeElement));
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        window.signOutCalls = 0;
        window.openSheet = () => ntcLogout({role:'student',to:'/signed-out',signOut:() => {
          window.signOutCalls++;
          return new Promise((resolve,reject) => { window.rejectSignOut = reject; });
        }});
        openSheet();
      });
      await page.waitForTimeout(400);
      await fits('.ntc-out-sheet');
      for (const button of ['.ntc-out-yes','.ntc-out-no']) {
        await page.locator(button).scrollIntoViewIfNeeded();
        const rect = await page.locator(button).boundingBox();
        assert(rect.height >= 48 && rect.y >= 0 && rect.y + rect.height <= viewport.height, 'action cannot be reached');
      }
      await page.screenshot({path:path.join(out,`logout-sheet-${viewport.width}.png`)});
      await page.keyboard.press('Escape');
      await page.waitForSelector('.ntc-out-backdrop',{state:'detached'});
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert(await page.locator('#field').evaluate(el => el === document.activeElement));
      await page.evaluate(() => openSheet());
      await page.locator('.ntc-out-yes').click();
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ntc-out-backdrop.on').count(),1,'busy dialog was dismissed');
      assert.equal(await page.evaluate(() => signOutCalls),1);
      await fits('.ntc-bye-title');
      await page.screenshot({path:path.join(out,`goodbye-${viewport.width}.png`)});
      await page.evaluate(() => rejectSignOut(new Error('Offline fixture')));
      await page.waitForSelector('.ntc-bye',{state:'detached'});
      assert(await page.locator('.ntc-out-error').isVisible());
      assert(await page.locator('.ntc-out-yes').isEnabled());
      await page.locator('.ntc-out-no').click();
      await page.waitForSelector('.ntc-out-backdrop',{state:'detached'});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(() => ntcLogin.stage(2));
      assert.equal(await page.locator('.ntc-launch-mark').evaluate(el => getComputedStyle(el,'::after').animationName),'none');
      assert.equal(await page.locator('.ntc-launch-icon').evaluate(el => getComputedStyle(el).animationName),'none');
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(() => document.body.classList.add('motion-paused'));
      assert.equal(await page.locator('.ntc-launch-mark').evaluate(el => getComputedStyle(el,'::after').animationName),'none');
      console.log(`✓ ${viewport.width}×${viewport.height}: layout, keyboard, stages, dismissal, recovery and motion preferences`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
