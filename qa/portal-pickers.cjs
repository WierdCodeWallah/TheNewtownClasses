/* Exercise the real shared picker using the smoke suite's offline fixtures. */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const file = path.resolve(__dirname, 'portal-smoke.cjs');
process.env.PORTAL_SURFACES = 'student,teacher,admin';
const marker = "   await page.waitForSelector('.portal-bottom-nav');";
const checks = String.raw`
   if(role==='admin') {
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.locator('#sidebar [data-section="add-student"]').click();
   } else if(role==='teacher') await page.getByRole('tab',{name:'Create test',exact:true}).click();
   // Student filters can be dynamically replaced; also test a long loaded select.
   if(role==='student') await page.evaluate(()=>{
    const field=document.createElement('div'); field.className='field'; field.id='picker-fixture';
    field.innerHTML='<label>Practice topic<select id="pickerTopics"><option disabled value="">Choose topic</option>'+Array.from({length:25},(_,i)=>'<option value="'+i+'">Topic '+(i+1)+'</option>').join('')+'</select></label>';
    document.querySelector('.main-content').prepend(field);
   });
   const selector=role==='admin'?'#newClass':role==='teacher'?'#testClass':'#pickerTopics';
   const target=page.locator(selector),dialog=page.locator('#portal-app-picker');
   for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    await target.click(); await dialog.waitFor({state:'visible'});
    if(role==='student') assert.equal(await dialog.locator('h2').textContent(),'Practice topic','wrapping label excludes option text');
    assert.equal(await target.getAttribute('aria-expanded'),'true');
    assert(await page.locator('.app-picker-options').evaluate(el=>el===document.activeElement),'list focus avoids opening mobile keyboard');
    const box=await dialog.boundingBox();
    assert(box.x>=0&&box.x+box.width<=width+1,'picker fits viewport');
    if(width<=600) assert(box.y+box.height>=899,'mobile sheet reaches bottom');
    assert.equal(await dialog.getByRole('option').count(),await target.evaluate(el=>[...el.options].filter(o=>!o.disabled&&!o.parentElement.disabled&&!o.hidden).length),'only enabled options are offered');
    await page.screenshot({path:path.join(out,'picker-'+role+'-'+width+'.png'),fullPage:false});
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await dialog.waitFor({state:'hidden'});
    const expected=await target.evaluate(el=>[...el.options].filter(o=>!o.disabled&&!o.parentElement.disabled).at(-1).value);
    assert.equal(await target.inputValue(),expected,'keyboard selection commits native value');
    assert(await target.evaluate(el=>el===document.activeElement),'focus restored');
    await target.click(); await dialog.waitFor({state:'visible'});
    assert.equal(await dialog.locator('[aria-selected=true]').count(),1,'current option is marked');
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    assert.equal(await target.inputValue(),expected,'cancel preserves value');
   }
   await page.setViewportSize({width:390,height:900});
   if(role==='admin') {
    await page.locator('#newClass').click();
    await dialog.getByRole('option',{name:'Class 11',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert(await page.locator('#newEnrollmentType').evaluate(el=>[...el.options].some(o=>o.value==='jee')),'class change updates dependent enrollment options');
    await page.getByRole('button',{name:'Clear',exact:true}).click();
    assert.equal(await target.inputValue(),'','reset preserves native default');
   }
   if(role==='student') {
    await target.click(); const search=dialog.getByRole('searchbox');
    await search.fill('Topic 18');assert.equal(await dialog.getByRole('option').count(),1);
    await dialog.getByRole('option',{name:'Topic 18',exact:true}).click(); await dialog.waitFor({state:'hidden'});
    assert.equal(await target.inputValue(),'17');
    await target.click();await search.fill('no match');assert(await dialog.getByText('No matches. Try another word.').isVisible());
    await search.fill('');
    await target.evaluate(el=>{el.innerHTML='<option value="fresh">Fresh topic</option>';});
    await dialog.getByRole('option',{name:'Fresh topic',exact:true}).waitFor();
    await target.evaluate(el=>{el.disabled=true;});await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.body.classList.contains('app-picker-open')),false,'disabled source releases scroll lock');
    await target.evaluate(el=>{el.disabled=false;});
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   await target.click();assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),'none');
   await dialog.getByRole('button',{name:'Close choices'}).click();await dialog.waitFor({state:'hidden'});
   assert.deepEqual(errors,[],role+' picker runtime errors');
   console.log(role+': phone sheets, desktop popovers, keyboard/cancel/focus, native values and reduced motion passed');
   await page.close();continue;
`;
const source = fs.readFileSync(file, 'utf8');
if (!source.includes(marker)) throw new Error('Smoke fixture insertion point changed');
const run = new Module(file, module); run.filename = file; run.paths = module.paths;
run._compile(source.replace(marker, marker + checks), file);
