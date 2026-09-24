/* Visual atmosphere only. No auth, fetching, timers or changes to portal data. */
(function () {
  'use strict';
  function start() {
    const body=document.body;
    if(!body.dataset.portal&&!body.dataset.login)return;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)');
    const motionKey='ntc:ambient-motion';
    let paused=false;
    try{paused=localStorage.getItem(motionKey)==='paused';}catch(_){}
    const ambient=document.createElement('div');ambient.className='portal-ambient';ambient.setAttribute('aria-hidden','true');
    ambient.innerHTML='<i></i><i></i><i></i><div class="ambient-grid"></div>';
    body.prepend(ambient);
    const orb=()=>'<div class="ai-orb" aria-hidden="true"><div class="ai-orb-halo"></div><div class="ai-orb-ring ring-one"></div><div class="ai-orb-ring ring-two"></div><div class="ai-orb-core"><div class="ai-orb-light"></div><svg viewBox="0 0 100 100" fill="none"><path d="M50 19 58 41 81 50 58 58 50 81 42 58 19 50 42 41Z" fill="currentColor"/><path d="M18 23h10m-5-5v10M76 74h8m-4-4v8" stroke="currentColor" stroke-width="1.5"/></svg></div><i class="orb-satellite"></i></div>';
    const paths={
      book:'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4z M12 5v15',
      check:'M8 3h8v4H8z M6 5H4v16h16V5h-2 M8 13l3 3 5-6',
      chart:'M4 20V10m7 10V4m7 16v-7',
      video:'M3 5h12v14H3z M15 10l6-4v12l-6-4z',
      spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
      layers:'m12 3 10 5-10 5L2 8z M2 12l10 5 10-5M2 16l10 5 10-5',
      target:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      chat:'M4 4h16v12H9l-5 4z M8 8h8M8 12h5',
      user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a7 7 0 0 1 14 0v2',
      home:'m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7'
    };
    const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.layers)+'"/></svg>';
    const iconMap={chapterwise:'book',notes:'book',module:'layers',mock:'target',onlinetest:'check',results:'chart',attendance:'check',answersheet:'spark',answersheets:'spark',liveclasses:'video','live-classes':'video',recordings:'video',chatbot:'spark',doubts:'chat',profile:'user',tests:'book','offline-results':'chart',overview:'home','all-students':'user','upload-material':'layers'};
    document.querySelectorAll('.sidebar-item[data-section]').forEach(item=>{const el=item.querySelector('.icon');if(el)el.innerHTML=icon(iconMap[item.dataset.section]);});
    document.querySelectorAll('.logo').forEach(logo=>{const mark=document.createElement('span');mark.className='portal-brand-mark';mark.setAttribute('aria-hidden','true');mark.innerHTML=icon('spark');logo.prepend(mark);});
    const hero=document.querySelector(body.dataset.portal==='student'?'.page-header':'.teacher-studio-hero');
    if(hero){hero.classList.add('atmosphere-hero');hero.insertAdjacentHTML('beforeend',orb());}
    document.querySelectorAll('.experience-hero').forEach(el=>{el.classList.add('atmosphere-feature');el.insertAdjacentHTML('beforeend',orb());});
    document.querySelectorAll('.teacher-profile-hero').forEach(el=>el.insertAdjacentHTML('beforeend',orb()));
    if(body.dataset.login){
      const scene=document.querySelector('.study-scene');
      const admin=body.dataset.login==='admin';
      if(scene){scene.innerHTML=orb()+'<span class="orbit-label orbit-label-one">'+icon('book')+(admin?'Manage classes':'Learn by subject')+'</span><span class="orbit-label orbit-label-two">'+icon(admin?'user':'spark')+(admin?'Support teachers':'Understand with AI')+'</span><span class="orbit-label orbit-label-three">'+icon('chart')+(admin?'Track progress':'See your progress')+'</span>';}
    }
    const toggle=document.querySelector('.scene-toggle')||document.createElement('button');
    toggle.type='button';toggle.classList.add('atmosphere-toggle');toggle.removeAttribute('onclick');
    if(!toggle.isConnected)document.querySelector('#sidebar')?.append(toggle);
    function syncMotion(){
      const off=paused||reduce.matches;
      body.classList.toggle('motion-paused',off);
      body.classList.toggle('motion-sleeping',document.hidden);
      toggle.setAttribute('aria-pressed',String(off));
      toggle.setAttribute('aria-label',off?'Play animation':'Pause animation');
      toggle.innerHTML=icon('spark')+'<span>'+(off?'Play animation':'Pause animation')+'</span>';
      toggle.disabled=reduce.matches;
    }
    toggle.onclick=()=>{paused=!paused;try{localStorage.setItem(motionKey,paused?'paused':'playing');}catch(_){}syncMotion();};
    reduce.addEventListener('change',syncMotion);document.addEventListener('visibilitychange',syncMotion);syncMotion();
    function enter(nodes){
      if(paused||reduce.matches||document.hidden)return;
      Array.from(nodes).slice(0,6).forEach((node,index)=>{
        if(!node||!node.isConnected||!node.getClientRects().length)return;
        node.getAnimations().filter(animation=>animation.id==='portal-enter').forEach(animation=>animation.cancel());
        node.animate([{opacity:.65,translate:'0 9px'},{opacity:1,translate:'0 0'}],{id:'portal-enter',duration:260,delay:index*25,easing:'cubic-bezier(.2,.8,.2,1)'});
      });
    }
    document.addEventListener('portal:collection-rendered',event=>enter(event.detail.querySelectorAll('.portal-choice')));
    document.addEventListener('click',event=>{
      if(!event.target.closest('.sidebar-item[data-section],.portal-task-tabs button'))return;
      requestAnimationFrame(()=>enter(document.querySelectorAll('.atmosphere-hero,.tab-content.active>.card,.experience-hero')));
    });
    // Keep decorative spheres confined to headers; never cover text or forms.
    document.querySelectorAll('.empty-icon').forEach(el=>{el.innerHTML=icon('layers');el.setAttribute('aria-hidden','true');});
    document.querySelectorAll('.ada-avatar-core').forEach(el=>el.innerHTML=icon('spark'));
    // Dynamic chat welcome is created after login, so observe only its message
    // container and enhance each welcome once, without rerendering any messages.
    const messages=document.getElementById('chatMessages');
    if(messages){
      const decorate=()=>{const badge=messages.querySelector('.ada-welcome-icon');if(badge&&!badge.querySelector('.ai-orb'))badge.innerHTML=orb();};
      new MutationObserver(decorate).observe(messages,{childList:true});decorate();
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
