/* Owner workspace: compact tasks and accessible dialogs. Data stays with the panel. */
(function(){
  'use strict';
  function start(){
    if(document.body.dataset.portal!=='admin')return;
    const $=id=>document.getElementById(id);
    const overview=$('tab-overview');
    const hero=document.createElement('div');hero.className='teacher-studio-hero admin-overview-hero';
    hero.innerHTML='<div class="teacher-studio-copy"><span class="studio-kicker">OWNER WORKSPACE</span><h1>Your campus, in view.</h1><p>Students, teachers and learning. Everything starts here.</p></div>';
    overview.prepend(hero);
    document.querySelectorAll('[data-admin-go]').forEach(button=>button.onclick=()=>document.querySelector('#sidebar [data-section="'+button.dataset.adminGo+'"]').click());
    // Keep the roster visible first; opening a form never discards its values.
    const teachers=$('tab-teachers'),list=$('teacherListWrap'),form=list.closest('.card');
    const browse=document.createElement('div');browse.className='card';
    const title=list.previousElementSibling;if(title){title.previousElementSibling?.matches('hr')&&title.previousElementSibling.remove();title.remove();}
    browse.innerHTML='<div class="card-title">Teacher accounts</div><p class="card-sub">Search your team and manage their teaching subjects.</p><button class="btn btn-outline" type="button" id="adminRefreshTeachers">Refresh</button>';
    browse.append(list);teachers.append(browse);$('adminRefreshTeachers').onclick=()=>window.loadTeacherList();
    PortalUI.tasks(teachers.id,[{label:'Your team',element:browse,key:'browse'},{label:'Add teacher',element:form,key:'create'}]);
    // Separate recording attendance from reading its history.
    const attendance=$('tab-attendance'),setup=$('attnBoard').closest('.card'),roster=$('attnStudentsCard'),history=$('viewAttClass').closest('.card');
    const register=document.createElement('div');register.id='adminRegister';setup.before(register);
    const details=document.createElement('details');details.className='attendance-setup';details.id='adminAttendanceSetup';details.open=true;
    const summary=document.createElement('summary');summary.textContent='Choose class, board & subject';
    details.append(summary,setup);register.append(details,roster);
    history.querySelector('.card-sub').textContent='Choose a student to see their monthly calendar and subject totals.';
    $('viewAttStudent').closest('.field').classList.add('full');
    PortalUI.tasks(attendance.id,[{label:'Mark attendance',element:register,key:'mark'},{label:'Student history',element:history,key:'history'}]);
    document.addEventListener('portal:attendance-loaded',()=>{summary.textContent='Class '+[...document.querySelectorAll('.attn-class-box:checked')].map(box=>box.value).join(', ')+' · '+$('attnSubject').value+' · Change';details.open=false;});
    const ncert=$('tab-ncert'),ncCards=[...ncert.children].filter(el=>el.classList.contains('card'));
    PortalUI.tasks(ncert.id,[{label:'Published chapters',element:ncCards[1],key:'browse'},{label:'Add / edit chapter',element:ncCards[0],key:'create'}]);
    // Occasional maintenance and formatting help should not dominate daily work.
    function fold(el,label){const details=document.createElement('details'),summary=document.createElement('summary');details.className='portal-advanced';summary.textContent=label;el.before(details);details.append(summary,el);}
    fold($('purgeMsg').closest('.card'),'Account maintenance');
    fold($('bulkImportCard').querySelector('.card-sub'),'Spreadsheet format & required columns');
    document.querySelectorAll('.alert').forEach(el=>{el.setAttribute('role','status');el.setAttribute('aria-live','polite');});
    document.querySelectorAll('.form-group').forEach(field=>{const label=field.querySelector('label'),input=field.querySelector('input,select,textarea');if(label&&input?.id)label.htmlFor=input.id;});
    ['rsDate','rsTime','rsDuration'].forEach(id=>$(id).previousElementSibling.htmlFor=id);
    // Give modal forms a scrollable phone surface, focus trap and Escape support.
    let active=null,returnFocus=null,savedOverflow='';
    const configs={rescheduleModal:['Reschedule class',()=>window.closeReschedule()],testResultsModal:['Test results',()=>$('testResultsModal').style.display='none'],editTeacherModal:['Edit teacher subjects',()=>window.closeEditTeacher()]};
    const focusable=el=>[...el.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length);
    function sync(el){
      const open=el.isConnected&&getComputedStyle(el).display!=='none';
      if(open&&active!==el){returnFocus=document.activeElement;active=el;savedOverflow=document.body.style.overflow;document.body.style.overflow='hidden';(focusable(el)[0]||el).focus();}
      if(!open&&active===el){active=null;document.body.style.overflow=savedOverflow;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
    }
    function attach(el){if(el.dataset.dialogReady)return;el.dataset.dialogReady='true';el.classList.add('admin-dialog');el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',configs[el.id][0]);el.tabIndex=-1;
      if(el.id==='testResultsModal')el.querySelector('button').setAttribute('aria-label','Close test results');
      new MutationObserver(()=>sync(el)).observe(el,{attributes:true,attributeFilter:['style']});sync(el);
    }
    ['rescheduleModal','testResultsModal'].forEach(id=>attach($(id)));
    new MutationObserver(records=>records.forEach(record=>{record.addedNodes.forEach(node=>{if(node.id==='editTeacherModal')attach(node);});record.removedNodes.forEach(node=>{if(node===active)sync(node);});})).observe(document.body,{childList:true});
    document.addEventListener('keydown',event=>{if(!active)return;if(event.key==='Escape'){event.preventDefault();configs[active.id][1]();}if(event.key==='Tab'){const nodes=focusable(active),first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();active.focus();}else if(event.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){event.preventDefault();first.focus();}}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
