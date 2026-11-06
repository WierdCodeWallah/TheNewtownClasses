(() => {
  const ribbon = document.querySelector('.prep-ribbon');
  if (!ribbon) return;
  const rail = ribbon.querySelector('.prep-ribbon-window');
  const next = ribbon.querySelector('.prep-next');
  const motion = ribbon.querySelector('.prep-motion');
  const featured = [...ribbon.querySelectorAll('.prep-chip-featured')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active = 0, paused = false, visible = false, timer;

  const update = () => {
    const canScroll = rail.scrollWidth > rail.clientWidth + 2;
    const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 3;
    next.hidden = !canScroll;
    next.classList.toggle('is-end', atEnd);
    next.setAttribute('aria-label', atEnd ? 'Back to first courses' : 'See more courses');
  };
  const showCourse = (reveal = false) => {
    featured.forEach((chip, index) => chip.classList.toggle('is-highlighted', !reduced.matches && index === active));
    if (!reveal || reduced.matches) return;
    const bounds = rail.getBoundingClientRect();
    const chip = featured[active].getBoundingClientRect();
    // Scroll this rail only, never the page or a sticky parent.
    if (chip.left < bounds.left + 2 || chip.right > bounds.right - 14) {
      rail.scrollTo({ left: rail.scrollLeft + chip.left - bounds.left - (rail.clientWidth - chip.width) / 2, behavior: 'smooth' });
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    const focus = document.activeElement;
    if (paused || reduced.matches || !visible || document.hidden ||
        document.documentElement.classList.contains('tnc-splash-on') ||
        (ribbon.contains(focus) && focus !== motion)) return;
    timer = setTimeout(() => {
      active = (active + 1) % featured.length;
      showCourse(true);
      schedule();
    }, 3000);
  };
  const setPaused = value => {
    paused = value;
    motion.setAttribute('aria-pressed', String(paused));
    motion.setAttribute('aria-label', paused ? 'Resume course highlights' : 'Pause course highlights');
    schedule();
  };
  const pauseForBrowsing = () => setPaused(true);
  motion.addEventListener('click', () => {
    setPaused(!paused);
    if (!paused) showCourse(true);
  });
  next.addEventListener('click', () => {
    pauseForBrowsing();
    const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 3;
    rail.scrollTo({ left: atEnd ? 0 : rail.scrollLeft + rail.clientWidth * .85, behavior: reduced.matches ? 'instant' : 'smooth' });
  });
  rail.addEventListener('pointerdown', pauseForBrowsing, { passive: true });
  rail.addEventListener('wheel', pauseForBrowsing, { passive: true });
  rail.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) pauseForBrowsing();
  });
  rail.addEventListener('scroll', update, { passive: true });
  ribbon.addEventListener('focusin', schedule);
  ribbon.addEventListener('focusout', () => queueMicrotask(schedule));
  document.addEventListener('visibilitychange', schedule);
  const syncMotion = () => {
    motion.hidden = reduced.matches;
    showCourse();
    schedule();
  };
  reduced.addEventListener('change', syncMotion);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= .5;
      schedule();
    }, { threshold: [0, .5] }).observe(ribbon);
  } else visible = true;
  // Wait for the existing first-visit splash to leave before starting the cycle.
  const splashObserver = new MutationObserver(() => {
    if (!document.documentElement.classList.contains('tnc-splash-on')) {
      splashObserver.disconnect();
      schedule();
    }
  });
  if (document.documentElement.classList.contains('tnc-splash-on')) {
    splashObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(rail);
  else window.addEventListener('resize', update, { passive: true });
  if (document.fonts) document.fonts.ready.then(update);
  ribbon.classList.add('is-ready');
  syncMotion();
  update();
})();
