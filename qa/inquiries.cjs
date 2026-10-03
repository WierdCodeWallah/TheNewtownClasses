/* Offline browser checks: Firebase, Google sign-in and all network traffic are
   replaced with fixtures. No production accounts or submissions are created. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.join(__dirname, 'artifacts');
fs.mkdirSync(out, { recursive: true });
const app = 'export const initializeApp=(_,name)=>({name});';
const auth = `
const user={uid:'google-fixture',email:'parent@example.test',displayName:'Parent Name',getIdToken:async()=> 'fixture',getIdTokenResult:async()=>({claims:{email_verified:true,firebase:{sign_in_provider:window.__provider||'google.com'}}})};
const state={currentUser:location.pathname.includes('admin-panel')?{...user,uid:'admin-fixture'}:null};
let callback;
export const getAuth=()=>state;
export const onAuthStateChanged=(_,fn)=>{callback=fn;setTimeout(()=>fn(state.currentUser),0);return ()=>{};};
export class GoogleAuthProvider {setCustomParameters() {}}
export async function signInWithPopup(){if(window.__authError){throw {code:window.__authError};}state.currentUser=user;await callback(user);return {user};}
export const signOut=async()=>{state.currentUser=null;callback(null);};
export const updatePassword=async()=>{},signInWithEmailAndPassword=async()=>{};
`;
const firestore = `
let sequence=0;
export const getFirestore=()=>({}),collection=(_,name)=>({name}),doc=(ref,...names)=>({name:names.length?names.join('/'):ref.name+'/new-'+(++sequence),id:names.at(-1)||'new-'+sequence});
export const query=ref=>ref,orderBy=()=>({}),serverTimestamp=()=>({__timestamp:true});
export const getDoc=async ref=>({exists:()=>ref.name.startsWith('admins/'),data:()=>({isAdmin:true}),id:ref.name.split('/').pop()});
export const getDocs=async()=>({docs:[],size:0,empty:true,forEach(){}});
export async function setDoc(ref,data){window.__attempts=(window.__attempts||[]).concat({id:ref.id,data});if(window.__saveError)throw Error('fixture');await new Promise(r=>setTimeout(r,100));return window.fixtureWrite(ref.id,data);}
export async function updateDoc(ref,data){if(window.__updateError)throw Error('fixture');return window.fixtureUpdate(ref.id,data);}
export const deleteDoc=async()=>{},addDoc=async()=>({id:'fixture'});
export function onSnapshot(ref,options,next,error){window.__snapshotError=()=>error(Error('fixture'));window.__emit=(rows,fromCache=false)=>next({docs:rows.map(row=>({id:row.id,data:()=>({...row,createdAt:row.timestamp?{toDate:()=>new Date(row.createdAt)}:row.createdAt})})),metadata:{fromCache}});window.__emit(window.__rows);return ()=>{window.__emit=()=>{};};}
`;
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  const errors = [], writes = [];
  let rows = [{id:'legacy',name:'Earlier Student',phone:'9876543210',email:'legacy@example.test',course:'NEET Preparation',currentClass:'Class 11',message:'Earlier inquiry',createdAt:'2025-01-01T00:00:00Z',status:'New',source:'Website'}], admin;
  async function page() {
    const page = await browser.newPage({ viewport: {width:390,height:844} });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(rows => { window.__rows = rows; }, rows);
    await page.exposeFunction('fixtureWrite', async (id, data) => {
      writes.push({id,data}); rows.push({...data,id,timestamp:true,createdAt:'2026-10-04T06:00:00Z'});
      if (admin) await admin.evaluate(rows => window.__emit(rows), rows);
    });
    await page.exposeFunction('fixtureUpdate', async (id, data) => {
      rows = rows.map(row => row.id === id ? {...row,...data,updatedAt:'2026-10-04T07:00:00Z'} : row);
      await admin.evaluate(rows => window.__emit(rows), rows);
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const js = body => route.fulfill({contentType:'text/javascript',body});
      if (url.pathname.endsWith('/firebase-app.js')) return js(app);
      if (url.pathname.endsWith('/firebase-auth.js')) return js(auth);
      if (url.pathname.endsWith('/firebase-firestore.js')) return js(firestore);
      if (url.pathname.endsWith('/firebase-config.js')) return js("export const FIREBASE_CONFIG={projectId:'fixture',apiKey:'fixture'},STAFF_APP='ntc-staff';export const initAppCheck=async()=>{},adoptLegacyStaffSession=async()=>{};");
      if (url.hostname === 'firestore.googleapis.com') return route.fulfill({json:{documents:[]}});
      if (url.origin === origin) return route.continue();
      if (route.request().resourceType() === 'script') return js('');
      return route.fulfill({body:'',contentType:'text/plain'});
    });
    return page;
  }
  try {
    admin = await page(); await admin.goto(origin + '/admin-panel.html');
    await admin.waitForFunction(() => document.querySelector('#inquiryBadge').textContent === '1');
    await admin.locator('#inquiryNoticeOpen').click();
    assert.equal(await admin.locator('.inquiry-item').count(), 1);
    assert.match(await admin.locator('.inquiry-item time').textContent(), /2025.*5:30.*IST/);
    const home = await page(); await home.goto(origin + '/index.html#contact');
    await home.waitForFunction(() => !document.querySelector('#enquiryGoogle').disabled);
    assert(await home.locator('#enquiryFields').isHidden());
    await home.evaluate(() => document.querySelector('#enquiryForm').dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})));
    assert.equal(writes.length,0);
    await home.locator('#enquiryOpen').click();
    await home.locator('#enquiryDialog').waitFor();
    for (const width of [320,390,1440]) {
      await home.setViewportSize({width,height:950});
      await home.locator('#enquiryDialog').scrollIntoViewIfNeeded();
      await home.locator('#enquiryDialog').screenshot({path:path.join(out,`inquiry-signin-${width}.png`)});
      assert(await home.locator('#enquiryDialog').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth + 1), 'sign-in layout at '+width);
    }
    await home.evaluate(() => window.__authError = 'auth/popup-closed-by-user');
    await home.locator('#enquiryGoogle').click();
    await home.waitForFunction(() => document.querySelector('#cmsEnquiryMsg').textContent.includes('cancelled'));
    assert(await home.locator('#enquiryFields').isHidden());
    await home.evaluate(() => { window.__authError=null; window.__provider='password'; });
    await home.locator('#enquiryGoogle').click();
    await home.waitForFunction(() => document.querySelector('#cmsEnquiryMsg').textContent.includes('verify'));
    assert(await home.locator('#enquiryFields').isHidden(),'a non-Google token never unlocks the form');
    await home.evaluate(() => window.__provider='google.com');
    await home.locator('#enquiryGoogle').click(); await home.locator('#enquiryFields').waitFor();
    assert.equal(await home.locator('#enquiryEmail').textContent(),'parent@example.test');
    await home.locator('#enquiryName').fill('Student <img src=x onerror=alert(1)>');
    await home.locator('#enquiryPhone').fill('12345');
    await home.locator('#enquiryNext').click();
    assert.equal(writes.length,0); assert.match(await home.locator('#cmsEnquiryMsg').textContent(),/10-digit/);
    assert.equal(await home.locator('#enquiryPhone').getAttribute('aria-invalid'),'true');
    await home.locator('#enquiryPhone').fill('+91 98765 43210');
    // Close, reopen, and Android/browser Back preserve the draft and scroll position.
    await home.locator('#enquiryClose').click();
    await home.waitForFunction(()=>!history.state?.enquirySheet);
    await home.locator('#enquiryOpen').click();
    assert.equal(await home.locator('#enquiryPhone').inputValue(),'+91 98765 43210');
    await home.goBack(); await home.waitForFunction(()=>!document.querySelector('#enquiryDialog').open);
    await home.locator('#enquiryOpen').click();
    for (const viewport of [{width:320,height:568},{width:390,height:844},{width:390,height:400},{width:844,height:390}]) {
      await home.setViewportSize(viewport);
      await home.locator('#enquiryPhone').focus();
      await home.waitForFunction(()=>{const r=document.querySelector('#enquiryPhone').getBoundingClientRect(),s=document.querySelector('#enquiryScroll').getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=s.bottom+1;});
      assert(await home.locator('#enquiryNext').evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0&&r.height>=48;}),'action stays within a reduced keyboard viewport');
      await home.screenshot({path:path.join(out,`inquiry-app-student-${viewport.width}-${viewport.height}.png`)});
    }
    await home.locator('#enquiryNext').click();
    assert(await home.locator('#enquiryName').isHidden());
    await home.locator('#enquiryNext').click();
    assert.equal(writes.length,0,'cannot skip course selection');
    await home.locator('#enquiryCourse').selectOption('NEET Preparation');
    await home.locator('#enquiryClass').selectOption('Class 11');
    await home.locator('#enquiryBack').click();
    assert.equal(await home.locator('#enquiryPhone').inputValue(),'+91 98765 43210');
    await home.locator('#enquiryNext').click();
    assert.equal(await home.locator('#enquiryCourse').inputValue(),'NEET Preparation');
    await home.locator('#enquiryNext').click();
    assert.match(await home.locator('#enquiryReview').textContent(),/Student <img/);
    assert.equal(await home.locator('#enquiryReview img').count(),0);
    await home.locator('#enquiryMessage').fill('Please arrange a demo.\n<script>alert(1)</script>');
    for (const width of [320,390,1440]) {
      await home.setViewportSize({width,height:1000});
      await home.locator('#enquiryDialog').screenshot({path:path.join(out,`inquiry-form-${width}.png`)});
      assert(await home.locator('#enquiryDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'form layout at '+width);
    }
    await home.evaluate(() => window.__saveError=true);
    await home.locator('#enquirySubmit').click();
    await home.waitForFunction(() => document.querySelector('#cmsEnquiryMsg').textContent.includes('retry'));
    assert.match(await home.locator('#enquiryName').inputValue(),/Student/);
    assert(await home.locator('#enquirySubmit').isEnabled());
    await home.evaluate(() => window.__saveError=false);
    await home.locator('#enquirySubmit').click();
    await home.locator('#enquirySuccess').waitFor();
    assert.equal(writes.length,1); assert.equal(writes[0].data.phone,'9876543210');
    assert.equal(writes[0].data.email,'parent@example.test'); assert.equal(writes[0].data.uid,'google-fixture');
    assert.deepEqual(writes[0].data.createdAt,{__timestamp:true});
    const attempts=await home.evaluate(()=>window.__attempts);assert.equal(attempts[0].id,attempts[1].id,'retry reuses the same document');
    await admin.waitForFunction(() => document.querySelector('#inquiryBadge').textContent === '2');
    assert.match(await admin.locator('#inquiryAnnouncement').textContent(), /1 new website inquiry/);
    assert.match(await admin.locator('.inquiry-item').first().textContent(), /Student <img/);
    assert.equal(await admin.locator('.inquiry-item img,.inquiry-item script').count(),0,'inquiry text cannot create HTML');
    assert.match(await admin.locator('.inquiry-item time').first().textContent(), /2026.*11:30.*IST/);
    await admin.evaluate(()=>window.__updateError=true);
    await admin.locator('.inquiry-item select').first().selectOption('Contacted');
    await admin.waitForFunction(()=>document.querySelector('#inquiryError').textContent.includes('Could not update'));
    assert.equal(await admin.locator('.inquiry-item select').first().inputValue(),'New');
    await admin.evaluate(()=>window.__updateError=false);
    await admin.locator('.inquiry-item select').first().selectOption('Contacted');
    await admin.waitForFunction(() => document.querySelector('#inquiryBadge').textContent === '1');
    await admin.locator('#inquiryFilter').selectOption('Contacted'); assert.equal(await admin.locator('.inquiry-item').count(),1);
    await admin.locator('#inquirySearch').fill('no-match'); assert.equal(await admin.locator('.inquiry-item').count(),0);
    await admin.locator('#inquirySearch').fill(''); await admin.locator('#inquiryFilter').selectOption('');
    for(const width of [320,390,1440]) {
      await admin.setViewportSize({width,height:1000});
      assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'admin layout at '+width);
      await admin.screenshot({path:path.join(out,`inquiry-inbox-${width}.png`),fullPage:true});
    }
    const many=Array.from({length:25},(_,i)=>({...rows[0],id:'older-'+i,status:'Closed'}));
    rows.push(...many); await admin.evaluate(rows=>window.__emit(rows),rows);
    assert.equal(await admin.locator('.inquiry-item').count(),20); await admin.locator('#inquiryNext').click(); assert.equal(await admin.locator('.inquiry-item').count(),7);
    await admin.evaluate(()=>window.__snapshotError()); assert.match(await admin.locator('#inquiryError').textContent(),/Could not load/);
    await admin.locator('#inquiryRetry').click(); await admin.waitForFunction(()=>document.querySelector('#inquiryError').textContent==='');
    await home.locator('#enquiryAgain').click(); await home.locator('#enquirySwitch').click(); await home.locator('#enquiryAuth').waitFor();
    assert(await home.locator('#enquiryFields').isHidden());
    await home.locator('#enquiryClose').click();
    await home.waitForFunction(()=>!history.state?.enquirySheet);
    await home.keyboard.press('Escape');
    await home.locator('a.btn-primary[href="#contact"]').first().click();
    assert(await home.locator('#enquiryDialog').isVisible(),'homepage demo CTA opens the app flow');
    await home.keyboard.press('Escape');
    await home.waitForFunction(()=>!document.querySelector('#enquiryDialog').open);
    assert(await home.evaluate(()=>document.body.style.position !== 'fixed'),'closing restores page scrolling');
    await home.emulateMedia({reducedMotion:'reduce'});
    await home.waitForFunction(()=>!history.state?.enquirySheet);
    await home.locator('#enquiryOpen').click();
    assert.equal(await home.locator('#enquiryDialog').evaluate(el=>getComputedStyle(el).animationName),'none');
    // A clean fixture preview for visual review, without creating another submission.
    await home.setViewportSize({width:390,height:844});
    await home.locator('#enquiryGoogle').click();
    await home.locator('#enquiryName').fill('Riya Sharma');
    await home.locator('#enquiryPhone').fill('9876543210');
    await home.locator('#enquiryStudentTitle').focus();
    await home.screenshot({path:path.join(out,'inquiry-mobile-preview.png')});
    assert.deepEqual(errors,[]);
    console.log('Passed: app steps, draft preservation, browser Back, reduced keyboard viewports, reduced motion, Google gate, cancellation, validation, retry, submission, live admin notification, legacy/new dates, safe rendering, status/error recovery, search, pagination and 320/390/1440px layouts.');
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
