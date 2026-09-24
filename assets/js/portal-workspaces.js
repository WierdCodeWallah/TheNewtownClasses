/* Focused workspaces composed from existing forms; all original actions remain. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  function splitList(tabId,listId,labels) {
    const tab=$(tabId),list=$(listId); if(!tab||!list)return;
    const form=list.closest('.card');if(!form)return;
    const browse=document.createElement('div');browse.className='card';
    // The heading and divider immediately above the list belong to the old layout.
    const oldTitle=list.previousElementSibling;
    if(oldTitle&&!oldTitle.querySelector('input,button,select')) {const divider=oldTitle.previousElementSibling;if(divider?.tagName==='HR')divider.remove();oldTitle.remove();}
    if(list._portalBrowser)browse.append(list._portalBrowser);
    browse.append(list);tab.append(browse);
    const extra=Array.from(tab.children).filter(el=>el.classList.contains('card')&&el!==form&&el!==browse);
    const panes=[{label:labels[0],element:browse,key:'browse'},{label:labels[1],element:form,key:'create'},...extra.map(el=>({label:'Review queue',element:el,key:'review'}))];
    PortalUI.tasks(tabId,panes);
  }
  PortalUI.openTask=function(id,key){const task=$(id)?._portalTasks;if(!task)return;const index=task.panes.findIndex(p=>p.key===key);if(index>=0)task.select(index);};
  function detailsAround(element,title) {
    if(!element||element.closest('details'))return;
    const details=document.createElement('details');details.className='portal-advanced';
    const summary=document.createElement('summary');summary.textContent=title;element.before(details);details.append(summary,element);
  }
  function orderFields(ids) {
    const first=$(ids[0]);const grid=first?.closest('.field-grid,.form-grid');if(!grid)return;
    ids.slice().reverse().forEach(id=>{const field=$(id)?.closest('.field');if(field&&field.parentElement===grid)grid.prepend(field);});
  }
  function start() {
    const role=document.body.dataset.portal;
    if(role==='student') {
      const section=$('pageDesc');if(section)section.textContent='Choose a subject, then a chapter. Everything you need, in one place.';
      // The old exam-track pills were cosmetic: actual entitlement checks run in
      // ContentAccess. Keep navigation focused on real categories instead.
      document.querySelector('.cat-section')?.remove();
      const tabs=document.createElement('div');tabs.id='portalStudyTabs';tabs.className='portal-task-tabs portal-study-tabs';tabs.setAttribute('aria-label','Learning resources');
      [['chapterwise','Practice'],['notes','Notes'],['module','Modules'],['mock','Mocks']].forEach(([key,label])=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.section=key;button.setAttribute('aria-pressed',String(key==='chapterwise'));button.onclick=()=>document.querySelector('#sidebar [data-section="'+key+'"]').click();tabs.append(button);});
      document.querySelector('.page-header')?.after(tabs);
      return;
    }
    if(role==='teacher') {
      const attendanceTab=$('tab-attendance');
      const attendanceForm=$('attnBoard')?.closest('.card');
      if(attendanceTab&&attendanceForm) {
        const hero=document.createElement('div');hero.className='experience-hero';
        hero.innerHTML='<span class="experience-kicker">CLASSROOM CHECK-IN</span><h2>Start with who’s here.</h2><p>Choose your class, find a student and record today’s attendance.</p>';
        attendanceTab.prepend(hero);
        const setup=document.createElement('details');setup.className='attendance-setup';setup.id='attendanceSetup';setup.open=true;
        const summary=document.createElement('summary');summary.innerHTML='Choose your class <small>Class → board → subject</small>';
        attendanceForm.before(setup);setup.append(summary,attendanceForm);
        attendanceForm.querySelector('.card-title').textContent='Class details';
        const rosterTitle=$('attnStudentsCard')?.querySelector('.card-title');if(rosterTitle)rosterTitle.textContent='Today’s register';
        const save=$('attnStudentsCard')?.querySelector('[onclick="saveAttendance()"]');save?.parentElement.classList.add('attendance-save-bar');
        document.addEventListener('portal:attendance-loaded',()=>{
          const classes=Array.from(document.querySelectorAll('.attn-class-box:checked')).map(box=>box.value).join(', ');
          summary.firstChild.textContent='Class '+classes+' · '+$('attnSubject').value;
          summary.querySelector('small').textContent=($('attnBoard').value==='ALL'?'All boards':$('attnBoard').value)+' · Change class or subject';
          setup.open=false;
        });
      }
      splitList('tab-tests','testListWrap',['Test library','Create test']);
      splitList('tab-answersheets','subjListWrap',['Assignments','Create assignment']);
      const live=$('tab-liveclasses');const cards=live?Array.from(live.children).filter(el=>el.classList.contains('card')):[];
      if(cards.length===2)PortalUI.tasks(live.id,[{label:'Scheduled classes',element:cards[1],key:'browse'},{label:'Schedule class',element:cards[0],key:'create'}]);
      detailsAround($('negWrong')?.closest('.field-grid')?.parentElement,'Scoring options · negative marking');
      const formats=$('uploadZone')?.nextElementSibling;
      if(formats?.textContent.includes('Supported Formats'))detailsAround(formats,'File formatting guide');
      const studio=$('studioToday');if(studio)studio.textContent='Your classes, tests and students. One focused workspace.';
      orderFields(['testClass','testTargetBoard','testSubject','testChapter','testModule','testTopic']);
      orderFields(['offlineClass','offlineBoard','offlineSubject','offlineTopic']);
      orderFields(['lcGrade','lcTargetBoard','lcSubject','lcChapter','lcModule','lcName']);
      orderFields(['subjClass','subjTargetBoard','subjSubject']);
      // Short steps keep the test editor usable on phones without discarding inputs.
      const builder=$('testClass')?.closest('.card');const method=$('panel-upload')?.parentElement;
      if(builder&&method) {
        const setup=document.createElement('div'),questions=document.createElement('div');
        setup.id='test-setup-step';questions.id='test-questions-step';
        const fields=$('testClass').closest('.field-grid');fields.before(setup);setup.append(fields);
        const advanced=$('negWrong')?.closest('details');if(advanced)setup.append(advanced);
        const info=$('autoSectionInfo');if(info)setup.append(info);
        method.before(questions);questions.append(method);
        const publish=builder.querySelector('[onclick="publishTest()"]')?.parentElement;if(publish)questions.append(publish);
        const steps=document.createElement('div');steps.id='test-builder-steps';setup.before(steps);steps.append(setup,questions);
        PortalUI.tasks(steps.id,[{label:'1 · Details',element:setup},{label:'2 · Questions & publish',element:questions}]);
        const next=document.createElement('button');next.type='button';next.className='btn btn-primary';next.textContent='Continue to questions →';next.style.marginTop='16px';next.onclick=()=>{steps._portalTasks.select(1);steps.scrollIntoView({block:'start'});};setup.append(next);
      }
    }
    if(role==='admin') {
      splitList('tab-upload-material','pdfListWrap',['Content library','Add material']);
      orderFields(['pdfClass','pdfTargetBoard','pdfSubject','pdfChapterName','pdfModule','pdfCategory']);
      // Replace the duplicate legacy controls with the collection browser.
      ['searchInput','filterBoard','filterSubject'].forEach(id=>{if($(id))$(id).hidden=true;});
      const students=$('studentTableBody')?.closest('.table-wrap');
      if(students) {students.id='adminStudentBrowserAnchor';const hint=students.previousElementSibling;if(hint?.textContent.includes('horizontally'))hint.hidden=true;}
    }
    // Class comes first for attendance in both staff portals.
    const classField=$('attnClassBoxes')?.closest('.field');if(classField)classField.parentElement.prepend(classField);
    const attendance=$('attnBoard')?.closest('.card')?.querySelector('.card-sub');
    if(attendance)attendance.textContent='Choose class, board and subject to load your roster.';
    const markHelp=$('attnStudentsCard')?.querySelector('.card-sub');
    if(markHelp)markHelp.textContent='Select students who are present, then save. Saved attendance is locked for today.';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
