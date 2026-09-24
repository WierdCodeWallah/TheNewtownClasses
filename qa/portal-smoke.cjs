/* Offline browser smoke test. All authentication, cloud reads and writes are
   intercepted with fixtures; this script cannot write to production Firebase.
   Run with Playwright available on NODE_PATH: node qa/portal-smoke.cjs */
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const out=path.join(__dirname,'artifacts');fs.mkdirSync(out,{recursive:true});
const chapters=Array.from({length:30},(_,i)=>({docId:'chapter-'+i,class:'11',subject:i%2?'Mathematics':'Physics',chapterName:'Chapter '+(Math.floor(i/4)+1),module:'Practice '+(i%2+1),category:'chapterwise',contentType:'regular',targetBoard:'CBSE',pdfUrl:'https://example.test/material.pdf',fileType:'pdf'}));
chapters.push({...chapters[0],docId:'hidden-board',chapterName:'ICSE private',targetBoard:'ICSE'},{...chapters[0],docId:'hidden-track',chapterName:'JEE private',contentType:'jee'},{...chapters[0],docId:'hidden-subject',chapterName:'Biology private',subject:'Biology'});
chapters.push({...chapters[0],docId:'notes-only',category:'notes',chapterName:'Only in notes'});
const students=Array.from({length:32},(_,i)=>({uid:'student-'+i,studentId:'NTC'+String(i).padStart(3,'0'),name:'Student '+String(i).padStart(2,'0'),class:i>25?'12':'11',board:i%2?'ICSE':'CBSE',subjects:['Physics','Maths'],enrollmentType:'normal',phone:'0000000000'}));
const tests=Array.from({length:24},(_,i)=>({testId:'test-'+i,testName:'Practice test '+i,class:i>19?'12':'11',subject:i%2?'Mathematics':'Physics',chapter:'Chapter '+(Math.floor(i/4)+1),module:'Module '+(i%2+1),targetBoard:'CBSE',testType:'regular',teacherUid:'teacher-demo',createdBy:'teacher-demo',teacherEmail:'teacher@example.test',isActive:true,totalQ:10,totalMarks:20,timeLimit:30,activeCycle:1,createdAt:new Date().toISOString()}));
const liveClasses=Array.from({length:14},(_,i)=>({id:'live-'+i,className:'Live lesson '+i,classGrade:'11',subject:'Physics',targetBoard:i%2?'CBSE':'ICSE',teacherUid:'teacher-demo',teacherName:'Aarav Sen',status:'scheduled',scheduledTs:Date.now()+3600000+i*60000,durationMins:60,zoomJoinUrl:'https://zoom.us/j/123456789',date:'2026-09-26',time:'18:00'}));
const fixture={chapters,students,tests,liveClasses,teachers:[{uid:'teacher-demo',name:'Aarav Sen',email:'teacher@example.test',subjects:['Physics','Maths']}]};
const field=v=>Array.isArray(v)?{arrayValue:{values:v.map(field)}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v??'')};
const documentOf=(collection,item)=>({name:'projects/fixture/databases/(default)/documents/'+collection+'/'+(item.uid||item.docId||item.testId||item.id),fields:Object.fromEntries(Object.entries(item).map(([k,v])=>[k,field(v)]))});
const firestore=`
export const getFirestore=()=>({}); export const collection=(_,name)=>({name}); export const doc=(_, ...names)=>({name:names.join('/')});
export const where=(key,op,value)=>({key,op,value}); export const orderBy=()=>({}); export const query=(ref,...conditions)=>({...ref,conditions});
export async function getDoc(ref){return {exists:()=>ref.name.startsWith('admins/'),data:()=>({isAdmin:true}),id:ref.name.split('/').pop()};}
export async function getDocs(ref){let data=window.__fixtures[ref.name]||[];if(ref.name==='chapters'&&location.search.includes('notes-only'))data=data.filter(x=>x.category==='notes');for(const c of ref.conditions||[])if(c.key&&c.op==='==')data=data.filter(x=>x[c.key]===c.value);const docs=data.map((x,i)=>({id:x.docId||x.testId||x.uid||String(i),data:()=>x}));return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn)};}
export const setDoc=async()=>{},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'fixture-new'}),serverTimestamp=()=>new Date();
`;
const auth=`export const getAuth=()=>({currentUser:window.__isLogin?null:{uid:window.__role+'-demo',email:window.__role+'@example.test',getIdToken:async()=> 'fixture-only'},authStateReady:async()=>{}});export const onAuthStateChanged=(auth,fn)=>{setTimeout(()=>fn(auth.currentUser),0);return ()=>{};};export const signOut=async(auth)=>{auth.currentUser=null;sessionStorage.setItem('fixtureSignOutCalls',String(Number(sessionStorage.getItem('fixtureSignOutCalls')||0)+1));};export const signInWithEmailAndPassword=async()=>{throw Object.assign(new Error('Fixture invalid credentials'),{code:'auth/invalid-credential'});};export const updatePassword=async()=>{};export const setPersistence=async()=>{},browserLocalPersistence={};`;
const server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:process.env.PORTAL_BROWSER || 'chrome'});
 try {
  for(const surface of (process.env.PORTAL_SURFACES||'student-login,teacher-login,admin-login,student,teacher,admin').split(',')){
   const isLogin=surface.endsWith('-login'),role=surface.split('-')[0];
   const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
   const capture=page.screenshot.bind(page);
   page.screenshot=async options=>{if(options.fullPage)await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));return capture({animations:'disabled',...options});};
   const errors=[];const writes=[];let reads=0;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(({role,fixture,isLogin})=>{window.__role=role;window.__fixtures=fixture;window.__isLogin=isLogin;},{role,fixture,isLogin});
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    const fulfill=body=>route.fulfill({contentType:'text/javascript',body});
    if(url.pathname.endsWith('/firebase-config.js'))return fulfill("export const FIREBASE_CONFIG={projectId:'fixture',apiKey:'fixture'};export const FCM_VAPID_KEY='';export const initAppCheck=async()=>{};");
    if(url.pathname.endsWith('/firebase-app.js'))return fulfill('export const initializeApp=()=>({});');
    if(url.pathname.endsWith('/firebase-auth.js'))return fulfill(auth);
    if(url.pathname.endsWith('/firebase-firestore.js'))return fulfill(firestore);
    if(url.pathname.endsWith('/firebase-messaging.js'))return fulfill('export const getMessaging=()=>({}),getToken=async()=>null,onMessage=()=>{},isSupported=async()=>false;');
    if(url.hostname==='firestore.googleapis.com'){
     const docPath=url.pathname.split('/documents/')[1]||'';
     if(route.request().method()!=='GET'){writes.push({path:docPath,body:route.request().postDataJSON()});return route.fulfill({json:{}});}
     reads++;
     if(docPath==='students/student-demo')return route.fulfill({json:documentOf('students',{uid:'student-demo',name:'Riya Sharma',studentId:'NTC001',class:'11',board:'CBSE',subjects:['Physics','Maths'],enrollmentType:'normal'})});
     if(docPath==='teachers/teacher-demo')return route.fulfill({json:documentOf('teachers',fixture.teachers[0])});
     if(docPath==='students/student-demo/attendance') {
      const now=new Date(),prefix=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-';
      return route.fulfill({json:{documents:[1,2,3].map((day)=>documentOf('attendance',{id:String(day),date:prefix+String(day).padStart(2,'0'),subject:'Physics',subjectKey:'physics',status:day===3?'absent':'present'}))}});
     }
     if(docPath.includes('/attendance/'))return route.fulfill({status:404,json:{error:{message:'Not found'}}});
     if(fixture[docPath])return route.fulfill({json:{documents:fixture[docPath].map(item=>documentOf(docPath,item))}});
     if(docPath.startsWith('testResults/'))return route.fulfill({status:404,json:{}});
     return route.fulfill({json:{documents:[]}});
    }
    if(url.pathname==='/fixture-pages')return route.fulfill({json:url.searchParams.has('pageToken')?{documents:[{id:'second'}]}:{documents:[{id:'first'}],nextPageToken:'next-page'}});
    if(url.pathname==='/.netlify/functions/ask-gemini')return route.fulfill({json:{answer:'A force is a push or pull. Let’s work through one example together.'}});
    if(url.origin===origin)return route.continue();
    if(url.hostname==='example.test')return route.fulfill({body:'PDF fixture'});
    // No external connections from the smoke test, including notifications.
    if(route.request().resourceType()==='script')return fulfill('window.emailjs={init(){},send:async()=>({})};');
    return route.fulfill({body:'',contentType:'text/plain'});
   });
   const file=isLogin?surface+'.html':role==='admin'?'admin-panel.html':role+'-dashboard.html';
   await page.goto(origin+'/'+file);
   if(isLogin) {
    await page.waitForSelector('.login-role-switch');
    const password=page.locator(role==='student'?'#password':'#loginPassword');
    await password.fill('fixture-password');await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await password.getAttribute('type'),'text');
    await page.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await password.getAttribute('type'),'password');
    await page.locator(role==='student'?'#studentId':'#loginEmail').fill(role==='student'?'NTC001':'teacher@example.test');
    if(role==='student')await page.locator('#classSelect').selectOption('11');
    await page.locator('#loginBtn').click();await page.waitForFunction(()=>document.querySelector('#loginError').textContent.includes('Invalid'));
    assert(await page.locator('#loginBtn').isEnabled(),'login recovers after a failed attempt');
    await page.getByRole('button',{name:'Pause animation'}).click();
    assert.equal(await page.locator('.study-scene .ai-orb-core').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.getByRole('button',{name:'Play animation'}).click();
    assert.notEqual(await page.locator('.study-scene .ai-orb-core').evaluate(el=>getComputedStyle(el).animationName),'none','AI illustration animates');
    for(const width of [320,390,1440]) {
     await page.setViewportSize({width,height:900});
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),surface+' overflow at '+width);
     await page.screenshot({path:path.join(out,surface+'-'+width+'.png'),fullPage:true});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.study-scene .ai-orb-core').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.locator('.scene-toggle').isVisible(),false);
    assert.deepEqual(errors,[],surface+' runtime errors');
    console.log(surface+': phone/desktop, fields, error recovery, password visibility and reduced motion passed');
    await page.close();continue;
   }
   await page.waitForSelector('.portal-bottom-nav');
   if(role==='student'||role==='teacher') {
    const dashboardUrl=page.url();
    for(const width of [390,1440]) {
     await page.setViewportSize({width,height:844});
     await page.locator('.logo').click();
     assert.equal(await page.locator('.logo').getAttribute('href'),null,'dashboard brand is not an exit link');
     if(role==='student'&&await page.locator('.breadcrumb-home').isVisible())await page.locator('.breadcrumb-home').click();
     assert.equal(page.url(),dashboardUrl,'accidental header/Home click stays on the dashboard');
     assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixtureSignOutCalls')),null,'header/Home does not sign out');
    }
    await page.setViewportSize({width:390,height:844});
   }
   if(role==='student'){
    await page.waitForSelector('.portal-choice');
    assert.equal(await page.locator('.portal-choice').count(),2,'only enrolled subjects appear');
    await page.getByRole('button',{name:/Physics.*items/}).click();
    await page.locator('.portal-choice').first().click();
    assert((await page.locator('#testGrid .test-card').count())>0,'chapter contains material');
    assert(!(await page.locator('.main-content').innerText()).includes('private'),'restricted materials stay hidden');
    const before=reads;await page.locator('.portal-search input').fill('no-such-chapter');await page.waitForTimeout(180);
    assert.equal(await page.locator('#testGrid .test-card').count(),0);assert.equal(reads,before,'search performs no cloud reads');
    await page.locator('.portal-reset').click();
    await page.screenshot({path:path.join(out,'student-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().top>0);
    const menu=await page.locator('#sidebar').boundingBox();
    assert(menu.x>=-1&&Math.abs(menu.width-390)<1&&menu.y>0,'More opens as a phone-width bottom sheet');
    await page.screenshot({path:path.join(out,'student-more-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Pause animation'}).click();
    assert.equal(await page.locator('.portal-ambient>i').first().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.getByRole('button',{name:'Play animation'}).click();
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#sidebar')).visibility==='hidden');
    await page.locator('.portal-bottom-nav [data-section="onlinetest"]').click();await page.waitForSelector('.portal-browser h2');
    await page.waitForFunction(()=>document.querySelector('.portal-browser h2')?.textContent==='Your test library');
    await page.getByRole('button',{name:/Physics.*items/}).click();await page.locator('.portal-choice').first().click();
    assert((await page.locator('#testGrid .test-card').count())<=6);
    await page.locator('.portal-bottom-nav [data-section="chatbot"]').click();await page.waitForSelector('#chatInput');
    const composer=await page.locator('#chatInput').boundingBox();const bottom=await page.locator('.portal-bottom-nav').boundingBox();
    assert(composer.y+composer.height<=bottom.y,'AI composer stays above mobile navigation');
    await page.locator('.portal-bottom-nav [data-section="chapterwise"]').click();
    // Reproduce the reported /learn/ case: Notes has a PDF, other material tabs
    // are empty. A navigation observer must not resurrect the Notes browser.
    await page.goto(origin+'/learn/?notes-only');
    await page.waitForSelector('#emptyState');
    await page.locator('#portalStudyTabs [data-section="notes"]').click();
    await page.waitForSelector('.portal-choice');
    await page.getByRole('button',{name:/Physics.*item/}).click();
    await page.locator('.portal-choice').first().click();
    await page.locator('#testGrid .test-card').click();
    await page.waitForSelector('#pdfViewer.open');
    await page.locator('#portalStudyTabs [data-section="chapterwise"]').click();
    await page.waitForSelector('#emptyState');
    assert.equal(await page.locator('.portal-browser:visible').count(),0,'Notes browser must not leak into empty Practice');
    assert.equal(await page.locator('#testGrid .test-card').count(),0,'Practice must not contain a Notes PDF');
    assert.equal(await page.locator('#pdfViewer').isVisible(),false,'switching tabs closes the document viewer');
    assert.equal(await page.locator('#pdfFrame').getAttribute('src'),'about:blank','switching tabs unloads the previous PDF');
    async function selectStudentTab(section) {
      const item=page.locator('#sidebar [data-section="'+section+'"]');
      const more=page.getByRole('button',{name:'More',exact:true});
      if(await more.isVisible()&&!await page.locator('#sidebar').evaluate(node=>node.classList.contains('open')))await more.click();
      await item.click();
    }
    async function openNotesPdf() {
      await selectStudentTab('notes');
      await page.waitForFunction(()=>document.querySelector('#testGrid')._portalCurrentKey==='materials-notes');
      const notesBrowser=page.locator('.main-content > .portal-browser');
      await notesBrowser.locator('[data-reset]').click();
      await notesBrowser.locator('.portal-choice').first().click();
      await notesBrowser.locator('.portal-choice').first().click();
      assert.equal(await page.locator('#testGrid .test-card h3').textContent(),'Only in notes');
      await page.locator('#testGrid .test-card').click();
      await page.waitForSelector('#pdfViewer.open');
    }
    for(const width of [390,1440]) {
      await page.setViewportSize({width,height:900});
      for(const section of ['chapterwise','module','mock','onlinetest','results','liveclasses','recordings','attendance','answersheet','chatbot']) {
        await openNotesPdf();
        await selectStudentTab(section);
        if(['chapterwise','module','mock','results'].includes(section))await page.waitForSelector('#emptyState');
        if(section==='onlinetest')await page.waitForFunction(()=>document.querySelector('#testGrid')._portalCurrentKey==='online-tests');
        assert.equal(await page.locator('#pdfViewer').isVisible(),false,section+' must close Notes PDF at '+width+'px');
        assert.equal(await page.locator('#pdfFrame').getAttribute('src'),'about:blank');
        assert(!(await page.locator('#testGrid').innerText()).includes('Only in notes'),section+' must not contain Notes cards');
        const visibleKeys=await page.locator('.main-content > .portal-browser:visible').evaluateAll(nodes=>nodes.map(node=>node.nextElementSibling?._portalCurrentKey));
        assert.deepEqual(visibleKeys,section==='onlinetest'?['online-tests']:[],section+' must not reuse the Notes browser');
        assert.equal(await page.locator('#sidebar .sidebar-item.active').getAttribute('data-section'),section);
      }
    }
    // A pending search and detached old controls cannot repaint another tab.
    await openNotesPdf();
    await page.evaluate(()=>{
      const browser=document.querySelector('#testGrid')._portalBrowser;
      window.__oldNotesBrowser=browser;
      const input=browser.querySelector('input');input.value='no match';input.dispatchEvent(new Event('input'));
      document.querySelector('#sidebar [data-section="module"]').click();
    });
    await page.waitForSelector('#emptyState');await page.waitForTimeout(180);
    await page.evaluate(()=>window.__oldNotesBrowser.querySelector('[data-reset]').click());
    assert.equal(await page.evaluate(()=>window.__oldNotesBrowser.isConnected),false,'previous controls are disposed');
    assert.equal(await page.locator('#testGrid .test-card').count(),0,'detached callbacks cannot restore Notes');
    assert.equal(await page.locator('.main-content > .portal-browser').count(),0);

    // Hold Results at its last cloud read, change to Notes, then finish the old
    // request. Its empty response must not clear or label the new Notes view.
    let releaseResults,startedResults;
    const resultsGate=new Promise(resolve=>{releaseResults=resolve;});
    const resultsStarted=new Promise(resolve=>{startedResults=resolve;});
    const delayedResults='**/students/student-demo/offlineResults?*';
    await page.route(delayedResults,async route=>{startedResults();await resultsGate;await route.fulfill({json:{documents:[]}});});
    await selectStudentTab('results');await resultsStarted;
    await openNotesPdf();
    const responsePromise=page.waitForResponse(response=>response.url().includes('/students/student-demo/offlineResults?'));
    releaseResults();await (await responsePromise).finished();await page.waitForTimeout(180);
    assert.equal(await page.locator('#emptyState').isVisible(),false,'late empty Results response must not overwrite Notes');
    assert.equal(await page.locator('#testGrid .test-card').count(),1,'Notes survives an older request completing');
    await page.unroute(delayedResults);
    await selectStudentTab('chapterwise');
    console.log('student: Notes PDF → all 10 other tabs checked on phone and desktop; delayed-response and stale-control regressions passed');
    await page.setViewportSize({width:390,height:844});
    await selectStudentTab('attendance');await page.waitForSelector('.attn-day');
    assert.equal(await page.locator('#attendancePresent').textContent(),'2');
    assert.equal(await page.locator('#attendanceAbsent').textContent(),'1');
    assert.equal(await page.locator('#attendanceRate').textContent(),'67%');
    await page.getByRole('button',{name:'Previous month',exact:true}).click();assert.equal(await page.locator('#attendancePresent').textContent(),'0');
    await page.getByRole('button',{name:'Next month',exact:true}).click();
    await page.locator('#attnStudentSubject').selectOption('Maths');assert.equal(await page.locator('#attendanceRate').textContent(),'—');
    await page.locator('#attnStudentSubject').selectOption('Physics');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,'attendance-student-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Open profile',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.ntc-pf-name').textContent==='Riya Sharma');
    assert.equal(await page.locator('[data-pf="board"]').textContent(),'CBSE');
    await page.screenshot({path:path.join(out,'profile-student-mobile.png')});
    await page.keyboard.press('Shift+Tab');assert(await page.locator('.ntc-pf-logout').evaluate(el=>el===document.activeElement),'profile traps focus');
    await page.keyboard.press('Escape');assert(await page.locator('.ntc-pf-btn').evaluate(el=>el===document.activeElement),'profile restores focus');
    await selectStudentTab('chatbot');
    await page.waitForSelector('.ada-chip');
    assert.equal(await page.locator('.ada-welcome').evaluate(el=>getComputedStyle(el).opacity),'1','welcome is painted, not merely attached');
    await page.screenshot({path:path.join(out,'chat-student-mobile.png')});
    await page.locator('.ada-chip').first().click();assert((await page.locator('#chatInput').inputValue()).length>0);
    await page.locator('#chatSendBtn').click();await page.waitForFunction(()=>document.querySelector('#chatMessages').textContent.includes('A force is a push or pull'));
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.ada-msg-bot').last().evaluate(el=>getComputedStyle(el).opacity),'1','chat remains visible with reduced motion');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert(await page.locator('#chatSendBtn').isEnabled());
    const inputBox=await page.locator('#chatInput').boundingBox(),navBox=await page.locator('.portal-bottom-nav').boundingBox();assert(inputBox.y+inputBox.height<=navBox.y,'chat composer above bottom navigation');
    // Populate results only after the empty-result race checks above.
    await page.evaluate(()=>localStorage.setItem('ntc_myResults_student-demo',JSON.stringify(Array.from({length:15},(_,i)=>({testId:'saved-'+i,testName:'Forces practice '+(i+1),subject:i===14?'Maths':'Physics',topic:i%2?'Motion':'Forces',submittedAt:new Date().toISOString(),score:16,finalScore:16,totalMarks:20,pct:80,class:'11',source:'online',cycleAttempted:1})))));
    await selectStudentTab('results');await page.waitForSelector('#resultSubjectFilter');
    await page.locator('#resultSubjectFilter').selectOption('Physics');
    assert.equal(await page.locator('#resultCardsWrap .test-card').count(),3,'phone results are paginated');
    const firstTitle=await page.locator('#resultCardsWrap h3').first().textContent();
    await page.getByRole('button',{name:'Next results',exact:true}).click();assert.notEqual(await page.locator('#resultCardsWrap h3').first().textContent(),firstTitle);
    await page.locator('#resultTopicFilter').selectOption('Forces');assert((await page.locator('#resultPager').textContent()).includes('1 / 3'),'filter resets results page');
    await page.locator('#resultModeFilter').selectOption('offline');assert.equal(await page.locator('#resultCardsWrap .test-card').count(),0);
    await page.locator('#resultModeFilter').selectOption('all');
    await page.screenshot({path:path.join(out,'results-student-mobile.png'),fullPage:true});
    for(const width of [320,1440]) {
      await page.setViewportSize({width,height:900});
      for(const section of ['results','attendance','chatbot']) {
        await selectStudentTab(section);
        if(section==='results')await page.waitForSelector('#resultSubjectFilter');
        if(section==='attendance')assert(await page.locator('#attnCalendarWrap').evaluate(el=>{const box=el.getBoundingClientRect();return box.right<=innerWidth&&Array.from(el.querySelectorAll('.attn-day')).every(day=>day.getBoundingClientRect().right<=box.right-10);}), 'calendar cells must fit, not clip at '+width);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),section+' overflow at '+width);
        await page.screenshot({path:path.join(out,section+'-student-'+width+'.png'),fullPage:section!=='chatbot'});
      }
    }
    console.log('student: attendance totals/months, profile focus, chat reply, results filters and pagination passed');
   }
   if(role==='teacher'){
    await page.waitForSelector('#tab-tests .portal-choice');
    assert.equal(await page.locator('#testClass').isVisible(),false,'test form starts hidden');
    await page.getByRole('button',{name:/Class 11.*items/}).click();
    await page.getByRole('button',{name:/Physics.*items/}).click();await page.locator('#tab-tests .portal-choice').first().click();
    assert((await page.locator('#testListWrap .test-list-item').count())<=4);
    await page.getByRole('tab',{name:'Create test',exact:true}).click();
    assert(await page.locator('#testClass').isVisible());
    await page.getByRole('button',{name:'Continue to questions'}).click();assert(await page.locator('#uploadZone').isVisible());
    await page.locator('.portal-bottom-nav [data-section="offline-results"]').click();
    await page.locator('#offlineClass').selectOption('11');await page.locator('#offlineSubject').selectOption('Physics');await page.locator('#offlineBoard').selectOption('CBSE');
    await page.getByRole('button',{name:'Load Students',exact:true}).click();await page.waitForSelector('[data-offline-score]');
    await page.locator('[data-offline-score="student-0"]').fill('18');
    await page.locator('.portal-roster-tools input').fill('Student 20');assert.equal(await page.locator('#offlineStudentsWrap tbody tr:visible').count(),1);
    await page.locator('[data-offline-score="student-20"]').fill('17');
    await page.locator('.portal-roster-tools input').fill('');assert.equal(await page.locator('[data-offline-score="student-0"]').inputValue(),'18');
    assert.equal(await page.locator('#offlineStudentsWrap tbody tr:visible').count(),3);
    await page.locator('#offlineTestName').fill('Fixture practice');await page.locator('#offlineTotalMarks').fill('20');
    await page.getByRole('button',{name:'Save Marks',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#offlineMsg').textContent.includes('Saved 2'));
    assert.equal(writes.filter(x=>x.path.includes('offlineResults')).length,2,'marks from both pages saved');
    const priorWrites=writes.length;await page.locator('#offlineBoard').selectOption('ICSE');await page.getByRole('button',{name:'Save Marks',exact:true}).click();assert.equal(writes.length,priorWrites,'changed cohort cannot reuse old roster');
    await page.locator('.portal-bottom-nav [data-section="attendance"]').click();await page.locator('.attn-class-box[value="11"]').check();await page.locator('#attnSubject').selectOption('Physics');await page.locator('#attnBoard').selectOption('CBSE');
    await page.getByRole('button',{name:'Load Students',exact:true}).click();await page.waitForSelector('[data-attn-present]');
    await page.locator('[data-attn-present="student-0"]').check();await page.locator('#attnStudentsCard .portal-roster-tools input').fill('Student 20');await page.locator('[data-attn-present="student-20"]').check();
    await page.getByRole('button',{name:'Save Attendance',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#attnSaveMsg').textContent.includes('2 marked'));
    assert.equal(writes.filter(x=>x.path.includes('/attendance/')).length,2,'attendance selections survive filters');
    assert.equal(await page.locator('#attendanceSetup').getAttribute('open'),null,'loaded roster collapses setup');
    await page.screenshot({path:path.join(out,'attendance-teacher-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'More',exact:true}).click();await page.locator('#sidebar [data-section="profile"]').click();
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await page.locator('#teacherProfileName').textContent(),'Aarav Sen');
    await page.screenshot({path:path.join(out,'profile-teacher-mobile.png'),fullPage:true});
    await page.locator('.portal-bottom-nav [data-section="liveclasses"]').click();await page.waitForSelector('#tab-liveclasses .portal-browser');
    assert.equal(await page.locator('#lcName').isVisible(),false,'scheduling form does not push the class list down');
    await page.getByRole('tab',{name:'Schedule class',exact:true}).click();assert(await page.locator('#lcChapter').isVisible());assert(await page.locator('#lcModule').isVisible());
    await page.locator('.portal-bottom-nav [data-section="tests"]').click();await page.getByRole('tab',{name:'Test library',exact:true}).click();
    await page.locator('#tab-tests .portal-reset').filter({hasText:'Reset'}).click();
    assert.equal(await page.locator('#tab-tests .portal-choice').count(),2,'reset returns to class choices');
    await page.screenshot({path:path.join(out,'teacher-mobile.png'),fullPage:true});
   }
   if(role==='admin'){
    await page.waitForSelector('#studentTableBody tr',{state:'attached'});
    await page.locator('.portal-bottom-nav [data-section="all-students"]').click();
    await page.locator('.portal-filters [data-facet="class"]').selectOption('11');await page.locator('.portal-filters [data-facet="board"]').selectOption('CBSE');
    assert((await page.locator('#studentTableBody tr:not(.group-header)').count())<=8);
    await page.locator('.portal-search input').fill('Student 20');await page.waitForTimeout(180);assert.equal(await page.locator('#studentTableBody tr:not(.group-header)').count(),1);
    await page.locator('.portal-bottom-nav [data-section="upload-material"]').click();await page.waitForSelector('#tab-upload-material .portal-choice');assert.equal(await page.locator('#pdfClass').isVisible(),false);
    await page.getByRole('button',{name:/Class 11.*items/}).click();await page.getByRole('button',{name:/Physics.*items/}).click();await page.locator('#tab-upload-material .portal-choice').first().click();
    assert((await page.locator('#pdfListWrap tbody tr').count())<=4);
    await page.locator('#tab-upload-material .portal-reset').filter({hasText:'Reset'}).click();
    assert.equal(await page.locator('#tab-upload-material .portal-choice').count(),1,'material reset returns to classes');
    await page.screenshot({path:path.join(out,'admin-mobile.png'),fullPage:true});
    await page.getByRole('tab',{name:'Add material',exact:true}).click();assert(await page.locator('#pdfModule').isVisible());
    await page.getByRole('button',{name:'More',exact:true}).click();await page.locator('#sidebar [data-section="live-classes"]').click();await page.waitForSelector('#tab-live-classes .portal-browser');
    assert((await page.locator('#tab-live-classes tbody tr').count())<=4,'admin schedule is paginated');
   }
   const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth,width:innerWidth}));assert(overflow.body<=overflow.width+2,role+' horizontal overflow '+JSON.stringify(overflow));
   const paging=await page.evaluate(()=>PortalUI.fetchList('/fixture-pages',{}));assert.equal(paging.documents.length,2,'all REST pages are loaded');
   await page.setViewportSize({width:320,height:740});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),role+' small-phone overflow');
   await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,role+'-desktop.png'),fullPage:true});
   assert.deepEqual(errors,[],role+' runtime errors');
   console.log(role+': 320/390/1440px, navigation, filters, pagination and workflows passed');
   if(role==='student'||role==='teacher') {
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixtureSignOutCalls')),null,'ordinary portal workflows never sign out');
    await page.route('**/login/'+role,route=>route.fulfill({contentType:'text/html',body:'Signed out fixture'}));
    if(role==='student') {
     await page.getByRole('button',{name:'Open profile',exact:true}).click();
     await page.locator('.ntc-pf-logout').click();
    } else {
     await page.locator('#sidebar [data-section="profile"]').click();
     page.once('dialog',dialog=>dialog.accept());
     await page.locator('#profileLogoutBtn').click();
    }
    await page.waitForURL('**/login/'+role);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixtureSignOutCalls')),'1','explicit sign out still ends the session');
    console.log(role+': accidental header/Home clicks stay put; only explicit Sign out ends the session');
   }
   await page.close();
  }
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
