/* Shared, dependency-free portal navigation and in-memory collection browser. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const subject = value => ({math:'Mathematics',maths:'Mathematics',mathematics:'Mathematics',computer:'Computer Science','computer science':'Computer Science'}[String(value || '').toLowerCase().trim()] || String(value || 'General').trim());
  const field = (item, key) => {
    if (key === 'subject') return Array.isArray(item.subjects) && !item.subject ? item.subjects.map(subject) : subject(item.subject);
    if (key === 'class') return String(item.class || item.classGrade || 'Unassigned');
    if (key === 'board') return item.targetBoard || item.board || 'All boards';
    if (key === 'chapter') return item.chapter || item.chapterName || item.unit || 'General / full syllabus';
    if (key === 'module') return item.module || 'General';
    return String(item[key] || 'General');
  };
  const values = (item, key) => [].concat(field(item, key));
  const matches = (item, key, value) => !value || values(item, key).includes(value) || (key === 'board' && 'targetBoard' in item && !item.targetBoard);
  const searchable = item => Object.values(item).filter(v => typeof v === 'string' || Array.isArray(v)).join(' ').toLowerCase();
  let sequence = 0;
  function subjectIcon(name) {
    const icons={Physics:'<ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',Chemistry:'<path d="M8 3h8M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 15h10"/>',Mathematics:'<path d="M4 20h16M6 20V4M6 16c7 0 4-10 13-10M15 4h4v4"/>',Biology:'<path d="M19 4C9 3 3 9 5 16c8 3 15-2 14-12ZM4 21 15 10"/>','Computer Science':'<path d="m8 6-5 6 5 6m8-12 5 6-5 6M14 4l-4 16"/>',English:'<path d="m4 20 6-16 6 16M6 14h8M18 7h4m-2-2v12"/>'};
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+(icons[name]||'<path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15"/>')+'</svg>';
  }

  // Filtering and pagination only rerender the current page, never refetch data.
  function collection(options) {
    const host = typeof options.host === 'string' ? $(options.host) : options.host;
    if (!host) return;
    const key = options.key || host.id;
    if (!host._portalStates) host._portalStates = {};
    const state = host._portalStates[key] || (host._portalStates[key] = {filters:{}, search:'', page:0});
    clearBrowser(host);
    const box = document.createElement('section');
    box.className = 'portal-browser';
    box.setAttribute('aria-label', options.title || 'Find content');
    const id = 'portal-browser-' + (++sequence);
    const facets = options.facets || ['class','board','subject','chapter','module'];
    const size = options.pageSize || (window.matchMedia('(max-width:600px)').matches ? 4 : 6);
    const items = options.items || [];
    const searchIndex = new Map(items.map(item => [item, searchable(item)]));
    box.innerHTML = '<div class="portal-browser-top"><div><span class="portal-eyebrow">'+esc(options.eyebrow || 'YOUR WORKSPACE')+'</span><h2>'+esc(options.title || 'Find what you need')+'</h2></div><button type="button" class="portal-reset" data-reset>Reset</button></div><label class="portal-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="'+esc(options.searchLabel || 'Search by title, subject or chapter')+'" placeholder="'+esc(options.searchLabel || 'Search by title, subject or chapter')+'" value="'+esc(state.search)+'"></label><div class="portal-filters"></div><div class="portal-path"></div><button type="button" class="portal-refine">Change filters</button><div class="portal-choices"></div><div class="portal-pagination"><span role="status" aria-live="polite"></span><div><button type="button" data-page="-1" aria-label="Previous page">←</button><button type="button" data-page="1" aria-label="Next page">→</button></div></div>';
    if(options.drill){const steps=document.createElement('ol');steps.className='portal-steps';steps.setAttribute('aria-label','Content path');box.querySelector('.portal-browser-top').after(steps);}
    const anchor = options.before ? $(options.before) : host;
    anchor.before(box);
    host._portalBrowser = box;
    host._portalCurrentKey = key;
    const loaders = {testListWrap:document.body.dataset.portal === 'teacher' ? 'loadMyTests' : 'loadTestList',pdfListWrap:'loadPdfList',lcTeacherList:'loadTeacherClasses',studentTableBody:'loadStudents',subjListWrap:'loadMySubjectiveTests'};
    if (loaders[host.id]) {
      const refresh=document.createElement('button');refresh.type='button';refresh.className='portal-reset';refresh.textContent='Refresh';refresh.onclick=()=>window[loaders[host.id]]?.();
      const actions=document.createElement('div');actions.className='portal-browser-actions';actions.append(refresh,box.querySelector('[data-reset]'));box.querySelector('.portal-browser-top').append(actions);
    }
    const filterWrap = box.querySelector('.portal-filters');
    facets.forEach((name, index) => {
      const label = document.createElement('label');
      label.textContent = (options.labels && options.labels[name]) || name[0].toUpperCase() + name.slice(1);
      const select = document.createElement('select');
      select.id = id + '-' + name;
      label.htmlFor = select.id;
      select.dataset.facet = name;
      select.addEventListener('change', () => {
        state.filters[name] = select.value;
        facets.slice(index + 1).forEach(next => {state.filters[next] = '';});
        state.page = 0; draw();
      });
      label.append(select); filterWrap.append(label);
    });
    const search = box.querySelector('input');
    let timer;
    host._portalDispose = () => clearTimeout(timer);
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => {state.search = search.value.trim().toLowerCase(); state.page = 0; draw();}, 120); });
    box.querySelector('[data-reset]').onclick = () => {clearTimeout(timer);state.filters = {}; state.search = ''; state.page = 0; state.refine=false;search.value = ''; draw();};
    box.querySelector('.portal-refine').onclick=()=>{state.refine=!state.refine;draw();};
    box.querySelectorAll('[data-page]').forEach(button => {button.onclick = () => {state.page += Number(button.dataset.page); draw();};});

    function draw() {
      if (host._portalBrowser !== box) return;
      let upstream = items;
      facets.forEach(name => {
        const select = filterWrap.querySelector('[data-facet="'+name+'"]');
        const choices = Array.from(new Set(upstream.flatMap(item => values(item,name)))).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
        if (state.filters[name] && !choices.includes(state.filters[name])) state.filters[name] = '';
        select.innerHTML = '<option value="">All '+esc(name === 'class' ? 'classes' : name === 'category' ? 'types' : name + 's')+'</option>' + choices.map(value => '<option value="'+esc(value)+'">'+esc((name === 'class' && /^\d+$/.test(value) ? 'Class ' : '') + value)+'</option>').join('');
        select.value = state.filters[name] || '';
        upstream = upstream.filter(item => matches(item, name, state.filters[name]));
      });
      let filtered = upstream.filter(item => !state.search || searchIndex.get(item).includes(state.search));
      const choices = box.querySelector('.portal-choices');
      choices.replaceChildren();
      const hierarchy = Array.isArray(options.drill) ? options.drill : ['subject','chapter'];
      const stage = options.drill && !state.search ? hierarchy.find(name=>!state.filters[name]) : null;
      const leaf = options.drill && !stage && !state.search;
      box.dataset.stage=stage||'content';
      const steps=box.querySelector('.portal-steps');
      if(steps){const route=[...hierarchy,'content'];const current=stage?route.indexOf(stage):route.length-1;steps.innerHTML=route.map((name,index)=>'<li'+(index===current?' aria-current="step"':'')+(index<current?' class="complete"':'')+'><b aria-hidden="true">'+(index<current?'✓':index+1)+'</b>'+esc(name[0].toUpperCase()+name.slice(1))+'</li>').join('');steps.hidden=!!state.search;}
      box.querySelector('.portal-refine').hidden = !leaf;
      box.querySelector('.portal-refine').textContent = state.refine ? 'Hide filters' : 'Change class, subject or chapter';
      box.querySelector('.portal-refine').setAttribute('aria-expanded',String(!!state.refine));
      // Reveal deeper controls only after the parent is chosen. Search always
      // provides a direct route to content, including legacy ungrouped records.
      filterWrap.hidden = stage === hierarchy[0] && !!options.drill;
      filterWrap.querySelectorAll('select').forEach(select=>{
        const name=select.dataset.facet;
        select.parentElement.hidden=(leaf&&!state.refine&&name!=='module')||(name==='chapter'&&!state.filters.subject&&!state.search)||(name==='module'&&!state.filters.chapter&&!state.search);
      });
      const path = facets.filter(name => state.filters[name]).map(name => state.filters[name]);
      box.querySelector('.portal-path').textContent = path.length ? path.join('  /  ') : options.drill ? 'Choose a '+hierarchy[0]+' to begin, or search directly.' : 'Narrow your list with the filters above.';
      let total;
      if (stage && filtered.length) {
        const groups = new Map();
        filtered.forEach(item => values(item,stage).forEach(value => groups.set(value,(groups.get(value)||0)+1)));
        const entries = Array.from(groups).sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true}));
        total = entries.length;
        state.page = Math.max(0, Math.min(state.page, Math.ceil(total/size)-1));
        entries.slice(state.page*size,(state.page+1)*size).forEach(([value,count],index) => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'portal-choice';
          button.innerHTML = '<span class="portal-choice-icon" aria-hidden="true">'+(stage === 'class' ? esc(value) : stage === 'subject' ? subjectIcon(value) : '↳')+'</span><span><strong>'+esc((stage==='class'?'Class ':'')+value)+'</strong><small>'+count+' '+(count===1?'item':'items')+'</small></span><span aria-hidden="true">→</span>';
          button.onclick = () => {state.filters[stage] = value; state.page=0; draw();}; choices.append(button);
        });
        options.render([]);
      } else {
        total = filtered.length;
        state.page = Math.max(0, Math.min(state.page, Math.ceil(total/size)-1));
        options.render(filtered.slice(state.page*size,(state.page+1)*size));
        host.querySelectorAll('.test-card[onclick]').forEach(card=>{card.tabIndex=0;card.setAttribute('role','button');card.onkeydown=event=>{if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();card.click();}};});
        if (!total) choices.innerHTML = '<div class="portal-empty"><strong>No matches yet</strong><p>Try another subject or chapter, a shorter search, or reset your filters.</p></div>';
      }
      const pages = Math.max(1, Math.ceil(total/size));
      box.querySelector('[role="status"]').textContent = total ? total+' '+(stage === 'class' ? 'classes' : stage ? stage+'s' : 'items')+' · Page '+(state.page+1)+' of '+pages : '0 items';
      box.querySelector('[data-page="-1"]').disabled = state.page === 0;
      box.querySelector('[data-page="1"]').disabled = state.page >= pages-1;
      document.dispatchEvent(new CustomEvent('portal:collection-rendered',{detail:box}));
    }
    draw();
  }

  // Keep roster inputs in the DOM so marks and attendance survive searches/pages.
  function roster(id) {
    const host = $(id);
    if (!host) return;
    if (host._portalBrowser) { host._portalBrowser.remove(); host._portalBrowser = null; }
    const rows = Array.from(host.querySelectorAll('tbody > tr'));
    if (!rows.length) return;
    rows.forEach(row=>{const name=row.querySelector('.student-name')?.textContent.trim()||'student';row.querySelectorAll('input').forEach(input=>{const label=input.hasAttribute('data-attn-present')?'Mark present':input.hasAttribute('data-offline-score')?'Marks':input.hasAttribute('data-offline-remark')?'Remark':'Answer sheet URL';input.setAttribute('aria-label',label+' for '+name);});});
    const box = document.createElement('div'); box.className = 'portal-roster-tools';
    box.innerHTML = '<label class="portal-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search students by name or ID" placeholder="Find student by name or ID"></label><div class="portal-pagination"><span role="status" aria-live="polite"></span><div><button type="button" data-prev aria-label="Previous students">←</button><button type="button" data-next aria-label="Next students">→</button></div></div><p class="portal-draft-note">Entries stay selected when you search or change pages.</p>';
    host.before(box); host._portalBrowser = box;
    if (host.querySelector('[data-attn-present]')) {
      const selectPage=document.createElement('button');selectPage.type='button';selectPage.className='portal-reset';selectPage.textContent='Mark this page present';
      selectPage.onclick=()=>{host.querySelectorAll('[data-attn-present]').forEach(input=>{if(!input.closest('tr').hidden)input.checked=true;});draw();};box.append(selectPage);
    }
    let page = 0, query = '';
    function draw() {
      const found = rows.filter(row => row.textContent.toLowerCase().includes(query));
      const size=window.matchMedia('(max-width:600px)').matches?(id==='offlineStudentsWrap'?3:5):8;
      const pages = Math.max(1,Math.ceil(found.length/size)); page=Math.max(0,Math.min(page,pages-1));
      const shown = new Set(found.slice(page*size,page*size+size));
      rows.forEach(row => {row.hidden = !shown.has(row);});
      const marked = host.querySelectorAll('[data-attn-present]:checked').length;
      const scores = Array.from(host.querySelectorAll('[data-offline-score]')).filter(input=>input.value !== '').length;
      box.querySelector('[role="status"]').textContent = found.length+' students · '+(page+1)+' / '+pages+(marked?' · '+marked+' selected':'')+(scores?' · '+scores+' marks entered':'');
      box.querySelector('[data-prev]').disabled=page===0; box.querySelector('[data-next]').disabled=page===pages-1;
      const master=host.querySelector('thead input[type="checkbox"]');
      if(master) {const visible=Array.from(host.querySelectorAll('[data-attn-present]')).filter(b=>!b.closest('tr').hidden); master.checked=visible.length>0&&visible.every(b=>b.checked); master.indeterminate=visible.some(b=>b.checked)&&!master.checked; master.title='Select students on this page';}
    }
    box.querySelector('input').oninput = event => {query=event.target.value.trim().toLowerCase();page=0;draw();};
    box.querySelector('[data-prev]').onclick=()=>{page--;draw();}; box.querySelector('[data-next]').onclick=()=>{page++;draw();};
    host.addEventListener('input', draw); // old listener is replaced on the next load
    if(host._rosterDraw) host.removeEventListener('input',host._rosterDraw);
    host._rosterDraw=draw; draw();
  }

  function tasks(id, panes, initial) {
    const host = $(id); if (!host || host._portalTasks) return;
    const tabs=document.createElement('div'); tabs.className='portal-task-tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Workspace views');
    panes=panes.filter(p=>p.element); if(panes.length<2)return;
    function select(index) {panes.forEach((p,i)=>{p.element.hidden=i!==index; const b=tabs.children[i]; b.setAttribute('aria-selected',String(i===index)); b.tabIndex=i===index?0:-1;});}
    panes.forEach((pane,i)=>{const button=document.createElement('button');button.type='button';button.textContent=pane.label;button.setAttribute('role','tab');if(!pane.element.id)pane.element.id='portal-pane-'+(++sequence);button.id=pane.element.id+'-tab';button.setAttribute('aria-controls',pane.element.id);pane.element.setAttribute('role','tabpanel');pane.element.setAttribute('aria-labelledby',button.id);button.onclick=()=>select(i);button.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=(i+(e.key==='ArrowRight'?1:-1)+panes.length)%panes.length;select(next);tabs.children[next].focus();}};tabs.append(button);});
    host.prepend(tabs);host._portalTasks={select,panes};select(initial||0);
  }

  // Fetch every REST list page. Never persist private portal data on disk.
  async function fetchList(url, init) {
    const documents=[]; let next=url;
    while(next) {const response=await fetch(next,init);const data=await response.json();if(!response.ok||data.error)throw new Error(data.error?.message||'Could not load records. Please retry.');documents.push(...(data.documents||[]));if(data.nextPageToken){const u=new URL(url,location.href);u.searchParams.set('pageToken',data.nextPageToken);next=u.href;}else next='';}
    return {documents};
  }
  const scripts = new Map();
  function loadScript(url) {if(!scripts.has(url))scripts.set(url,new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=url;tag.onload=resolve;tag.onerror=()=>{scripts.delete(url);tag.remove();reject(new Error('Could not load file reader. Check your connection and retry.'));};document.head.append(tag);}));return scripts.get(url);}
  function clearBrowser(host) {
    host=typeof host==='string'?$(host):host;
    if (!host) return;
    host._portalDispose?.();
    host._portalDispose=null;
    host._portalBrowser?.remove();
    host._portalBrowser=null;
    host._portalCurrentKey=null;
  }
  window.PortalUI={collection,roster,tasks,esc,subject,field,fetchList,loadScript,clearBrowser};

  function init() {
    const role=document.body.dataset.portal; if(!role)return;
    const sidebar=$('sidebar');if(!sidebar)return;
    const config={student:[['chapterwise','Learn','book'],['onlinetest','Tests','check'],['liveclasses','Classes','video'],['chatbot','Ask AI','spark']],teacher:[['tests','Tests','book'],['liveclasses','Classes','video'],['attendance','Attendance','check'],['offline-results','Marks','chart']],admin:[['overview','Home','home'],['all-students','Students','users'],['upload-material','Content','book'],['attendance','Attendance','check']]};
    const paths={book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2',check:'M8 3h8v4H8z M7 5H4v16h16V5h-3 M8 13l3 3 5-6',video:'M3 5h12v14H3z M15 10l6-4v12l-6-4',spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',chart:'M4 20V10 M11 20V4 M18 20v-7',home:'M3 11l9-8 9 8 M5 10v11h14V10 M10 21v-7h4v7',users:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 3a4 4 0 0 1 0 8 M18 14a4 4 0 0 1 4 4v3',more:'M4 6h16 M4 12h16 M4 18h16'};
    const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ '<path d="'+paths[name]+'"/></svg>';
    const nav=document.createElement('nav');nav.className='portal-bottom-nav';nav.setAttribute('aria-label','Primary navigation');
    config[role].forEach(([section,label,symbol])=>{const button=document.createElement('button');button.type='button';button.dataset.section=section;button.innerHTML=icon(symbol)+'<span>'+label+'</span>';button.onclick=()=>{sidebar.querySelector('[data-section="'+section+'"]')?.click();window.scrollTo({top:0,behavior:'instant'});};nav.append(button);});
    const more=document.createElement('button');more.type='button';more.innerHTML=icon('more')+'<span>More</span>';more.setAttribute('aria-controls','sidebar');more.setAttribute('aria-expanded','false');more.onclick=()=>{$('menuToggle')?.click();};nav.append(more);document.body.append(nav);
    const input=document.createElement('input');input.type='search';input.placeholder='Find a tool…';input.setAttribute('aria-label','Find a portal tool');input.className='portal-tool-search';sidebar.prepend(input);
    const items=Array.from(sidebar.querySelectorAll('.sidebar-item'));
    input.oninput=()=>{items.forEach(item=>{item.hidden=!item.textContent.toLowerCase().includes(input.value.toLowerCase());});};
    items.forEach(item=>{if(item.tagName!=='A'){item.setAttribute('role','button');item.tabIndex=0;item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();item.click();}});}});
    function sync() {
      const active=sidebar.querySelector('.sidebar-item.active')?.dataset.section;
      document.body.dataset.activeSection=active||'';
      const learn=role==='student'&&['chapterwise','notes','module','mock'].includes(active);
      nav.querySelectorAll('[data-section]').forEach(button=>{
        button.setAttribute('aria-current',(button.dataset.section===active||(button.dataset.section==='chapterwise'&&learn))?'page':'false');
      });
      items.forEach(item=>item.setAttribute('aria-current',item.dataset.section===active?'page':'false'));
      const open=sidebar.classList.contains('open');
      more.setAttribute('aria-expanded',String(open));
      $('menuToggle')?.setAttribute('aria-expanded',String(open));
      // Only synchronize navigation. Content is owned by its section renderer;
      // navigation must never reveal an old browser after an empty/error result.
      if(role==='student') {
        const tabs=$('portalStudyTabs');
        if(tabs) {
          tabs.hidden=!learn;
          tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.section===active)));
        }
      }
    }
    new MutationObserver(sync).observe(sidebar,{attributes:true,attributeFilter:['class'],subtree:true});sync();
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.classList.contains('open')){$('sidebarOverlay')?.click();more.focus();}});
    document.querySelectorAll('.field').forEach(container=>{const label=container.querySelector('label');const control=container.querySelector('input,select,textarea');if(label&&control?.id&&!label.htmlFor)label.htmlFor=control.id;});
    document.dispatchEvent(new Event('portal:ready'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
