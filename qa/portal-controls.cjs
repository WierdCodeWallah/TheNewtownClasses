/* Reuse the offline Firebase fixtures; no production reads or writes. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const file = path.resolve(__dirname, 'portal-smoke.cjs');
process.env.PORTAL_SURFACES = 'student,teacher,admin';
const marker = "   await page.waitForSelector('.portal-bottom-nav');";
const checks = String.raw`
   if(role==='admin') {
    assert.equal(await page.locator('#newClass').evaluate(el=>getComputedStyle(el.closest('.app-input-field')).opacity),'1','disabled placeholder option does not dim enabled select');
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.locator('#sidebar [data-section="add-student"]').click();
   } else if(role==='teacher') {
    await page.getByRole('tab',{name:'Create test',exact:true}).click();
   }
   const target=page.locator(role==='admin'?'#newName':role==='teacher'?'#testClass':'.portal-search input').first();
   await target.waitFor({state:'visible'});
   for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    const before=await target.evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontSize,height:el.getBoundingClientRect().height,shadow:s.boxShadow};});
    assert.equal(before.font,'16px',role+' readable input size at '+width);
    assert(before.height>=48,role+' touch target at '+width);
    await target.focus();
    if(role==='student') {
     assert.equal(await target.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px','search has one outer border');
     assert.notEqual(await target.evaluate(el=>getComputedStyle(el.closest('.portal-search')).boxShadow),'none','search focus ring');
    } else {
     assert(await target.evaluate(el=>el.closest('.app-input-field').matches(':focus-within')),'whole field responds to focus');
     assert.equal(await target.evaluate(el=>getComputedStyle(el.closest('.app-input-field'),'::before').animationName),'field-orbit','active border animates');
     assert.equal(await target.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px','integrated field has one surface');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),role+' form overflow at '+width);
    await page.screenshot({path:path.join(out,'controls-'+role+'-'+width+'.png'),fullPage:true});
   }
   if(role==='admin') {
    await page.getByLabel('Student Full Name *',{exact:true}).fill('Fixture student');
    await page.locator('#addStudentForm').getByLabel('Class *',{exact:true}).selectOption('11');
    await page.locator('#addStudentForm').getByLabel('Physics',{exact:true}).check();
    assert.equal(await page.locator('#newClass').inputValue(),'11');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#newSubjectsGroup label')).backgroundColor==='rgb(235, 242, 255)');
    assert(await page.locator('#newSubjectsGroup').getAttribute('aria-labelledby'),'choice group is named');
    await page.getByRole('button',{name:'Clear',exact:true}).click();
    assert.equal(await page.locator('#newName').inputValue(),'');
    assert.equal(await page.locator('#newName').evaluate(el=>el.closest('.app-input-field').classList.contains('has-value')),false,'reset clears filled surface state');
    assert.equal(await page.locator('#addStudentForm').getByLabel('Physics',{exact:true}).isChecked(),false,'native form reset preserved');
   }
   await page.evaluate(()=>{
    const field=document.createElement('div');field.className='field';field.id='fixture-dynamic-field';
    field.innerHTML='<label>Fixture dynamic answer</label><textarea rows="2"></textarea><p>Fixture hint</p>';
    document.querySelector('.main-content').append(field);
   });
   const dynamic=page.getByLabel('Fixture dynamic answer',{exact:true});
   await dynamic.fill('A dynamically loaded answer');
   assert(await dynamic.getAttribute('aria-describedby'),'dynamic hint association');
   assert((await dynamic.boundingBox()).height>=108,'textarea writing space');
   assert.equal(await dynamic.evaluate(el=>el.closest('.app-input-field').querySelectorAll('.app-field-icon').length),1,'dynamic fields have one decorative icon');
   assert.equal(await dynamic.evaluate(el=>el.closest('.app-input-field').classList.contains('has-value')),true,'typing updates surface state');
   await page.screenshot({path:path.join(out,'controls-'+role+'-textarea.png'),fullPage:true});
   await page.locator('#fixture-dynamic-field').evaluate(el=>el.remove());
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await target.evaluate(el=>getComputedStyle(el).transitionDuration),'0s','reduced motion');
   await target.focus();
   assert.equal(await target.evaluate(el=>getComputedStyle(el.closest('.app-input-field')||el.closest('.portal-search'),el.closest('.app-input-field')?'::before':'::after').animationName),'none','animated border respects reduced motion');
   assert.deepEqual(errors,[],role+' runtime errors');
   console.log(role+': controls, focus, labels, dynamic hints, reduced motion and 320/390/768/1440px passed');
   await page.close();continue;
`;
const source = fs.readFileSync(file, 'utf8');
if (!source.includes(marker)) throw new Error('Smoke fixture insertion point changed');
const run = new Module(file, module);
run.filename = file;
run.paths = module.paths;
run._compile(source.replace(marker, marker + checks), file);
