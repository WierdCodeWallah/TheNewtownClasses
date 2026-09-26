/* Browser Back/Forward regressions, using offline authentication fixtures. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.resolve(__dirname,'portal-smoke.cjs');
process.env.PORTAL_SURFACES='student,teacher,admin';
const marker="   await page.waitForSelector('.portal-bottom-nav');";
const checks=String.raw`
   const originalUrl=page.url();
   const start=await page.evaluate(()=>document.body.dataset.activeSection);
   const next=role==='student'?'liveclasses':role==='teacher'?'attendance':'all-students';
   const last=role==='student'?'chatbot':role==='teacher'?'offline-results':'upload-material';
   await page.locator('.portal-bottom-nav [data-section="'+next+'"]').click();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,next);
   await page.locator('.portal-bottom-nav [data-section="'+last+'"]').click();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,last);
   assert(await page.locator('.portal-back-button').isVisible(),'phone Back is visible, including chat');
   await page.goBack();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,next);
   await page.goForward();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,last);
   await page.locator('.portal-back-button').click();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,next);
   await page.locator('.portal-back-button').click();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,start);
   assert(await page.locator('.portal-back-button').isDisabled(),'root Back cannot send user to login');
   assert.equal(page.url(),originalUrl,'menus stay in same authenticated document');
   if(role==='student'||role==='teacher') {
    const choice=page.locator('.portal-choice:visible').first();await choice.waitFor();
    const original=await choice.locator('strong').textContent();
    await choice.click();
    await page.locator('.portal-back-button').click();
    await page.waitForFunction(text=>document.querySelector('.portal-choice strong')?.textContent===text,original);
    assert.equal(await page.locator('.portal-choice:visible strong').first().textContent(),original,'Back restores parent content level');
   }
   if(role==='teacher') {
    await page.getByRole('tab',{name:'Create test',exact:true}).click();
    await page.locator('#testName').fill('Unsaved draft');
    await page.locator('.portal-back-button').click();
    await page.getByRole('tab',{name:'Test library',exact:true}).waitFor();
    assert.equal(await page.getByRole('tab',{name:'Test library',exact:true}).getAttribute('aria-selected'),'true');
    await page.goForward();await page.locator('#testName').waitFor({state:'visible'});
    assert.equal(await page.locator('#testName').inputValue(),'Unsaved draft','Back/Forward preserve form draft');
   }
   // Reload restores the menu without manufacturing another history entry.
   await page.locator('.portal-bottom-nav [data-section="'+next+'"]').click();
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,next);
   const beforeReload=await page.evaluate(()=>history.state.ntcPortalNavigation.index);
   await page.reload();await page.waitForSelector('.portal-bottom-nav');
   await page.waitForFunction(section=>document.body.dataset.activeSection===section,next);
   assert.equal(await page.evaluate(()=>history.state.ntcPortalNavigation.index),beforeReload);
   await page.goBack();await page.waitForFunction(section=>document.body.dataset.activeSection!==section,next);
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixtureSignOutCalls')),null,'Back never signs out');
   await page.setViewportSize({width:320,height:740});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'small phone fits Back bar');
   await page.screenshot({path:path.join(out,'navigation-'+role+'-phone.png'),fullPage:false});
   await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('.portal-back-bar').isVisible(),false,'desktop uses browser history');
   assert.deepEqual(errors,[],role+' navigation runtime errors');
   console.log(role+': browser Back/Forward, phone Back, root safety, nested views, reload and session preservation passed');
   await page.close();continue;
`;
const source=fs.readFileSync(file,'utf8');
if(!source.includes(marker))throw new Error('Smoke fixture insertion point changed');
const run=new Module(file,module);run.filename=file;run.paths=module.paths;
run._compile(source.replace(marker,marker+checks),file);
