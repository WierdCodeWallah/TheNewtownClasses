/* ════════════════════════════════════════
   The NewTown Classes – Main JavaScript
   PRO ENHANCED VERSION
   ════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── 1. SCROLL FADE-UP + SLIDE ANIMATIONS ── */
  const fadeObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        // Stagger children cards
        const cards = e.target.querySelectorAll('.course-card, .topper-card, .why-item, .testi-card, .faq-item');
        cards.forEach((card, i) => {
          card.style.transitionDelay = `${i * 0.08}s`;
          card.classList.add('visible');
        });
      }
    });
  }, { threshold: 0.08 });

  document.querySelectorAll('.fade-up, .courses-grid, .toppers-grid, .why-grid, .testi-grid, .faq-list').forEach(el => fadeObserver.observe(el));


  /* ── 2. ANIMATED STAT COUNTERS ── */
  const statObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && !e.target.dataset.counted) {
        e.target.dataset.counted = 'true';
        const nums = e.target.querySelectorAll('.stat-num');
        nums.forEach(num => {
          const text = num.textContent;
          const match = text.match(/(\d+)/);
          if (!match) return;
          const target = parseInt(match[1]);
          const suffix = text.replace(match[1], '');
          let current = 0;
          const step = Math.max(1, Math.floor(target / 60));
          const timer = setInterval(() => {
            current += step;
            if (current >= target) {
              current = target;
              clearInterval(timer);
            }
            num.textContent = current + suffix;
          }, 20);
        });
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.hero-stats').forEach(el => statObserver.observe(el));


  /* ── 3. MOBILE HAMBURGER MENU ── */
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('open');
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
      });
    });
  }


  /* ── 4. NAV SCROLL EFFECTS ── */
  const nav = document.querySelector('nav');
  const sections = document.querySelectorAll('section[id]');
  const navLinksAll = document.querySelectorAll('.nav-links a');

  // Shrink nav on scroll (RAF-throttled)
  let lastScroll = 0;
  let navTicking = false;
  window.addEventListener('scroll', () => {
    if (!navTicking) {
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        if (nav) {
          nav.classList.toggle('nav-scrolled', scrollY > 80);
          if (scrollY > lastScroll && scrollY > 300) {
            nav.style.transform = 'translateY(-100%)';
          } else {
            nav.style.transform = 'translateY(0)';
          }
          lastScroll = scrollY;
        }
        navTicking = false;
      });
      navTicking = true;
    }
  }, { passive: true });

  // Active nav link highlight
  const linkObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        navLinksAll.forEach(l => l.classList.remove('active'));
        const id = e.target.id;
        const activeLink = document.querySelector(`.nav-links a[href="#${id}"]`);
        if (activeLink) activeLink.classList.add('active');
      }
    });
  }, { threshold: 0.3, rootMargin: '-80px 0px -50% 0px' });

  sections.forEach(s => linkObserver.observe(s));


  /* ── 5. SCROLL PROGRESS BAR ── */
  const progressBar = document.createElement('div');
  progressBar.className = 'scroll-progress';
  document.body.appendChild(progressBar);

  let progressTicking = false;
  window.addEventListener('scroll', () => {
    if (!progressTicking) {
      requestAnimationFrame(() => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = (scrollTop / docHeight) * 100;
        progressBar.style.width = progress + '%';
        progressTicking = false;
      });
      progressTicking = true;
    }
  }, { passive: true });


  /* ── 6. PARALLAX ORB MOVEMENT ── */
  const orbs = document.querySelectorAll('.orb');
  window.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 30;
    const y = (e.clientY / window.innerHeight - 0.5) * 30;
    orbs.forEach((orb, i) => {
      const factor = i === 0 ? 1 : -0.7;
      orb.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
    });
  }, { passive: true });


  /* ── 7. TILT EFFECT ON CARDS ── */
  document.querySelectorAll('.course-card, .topper-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(800px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-6px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });


  /* ── 8. FLOATING PARTICLES (removed) ── */


  /* ── 9. SMOOTH REVEAL HEADER ON LOAD ── */
  document.body.classList.add('loaded');


  /* ── 10. FAQ ACCORDION ── */
  document.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const item   = btn.parentElement;
      const isOpen = item.classList.contains('open');

      document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));

      if (!isOpen) item.classList.add('open');
    });
  });


  /* ── 11. FORM INPUT FOCUS ANIMATIONS ── */
  document.querySelectorAll('.form-group input, .form-group select, .form-group textarea').forEach(input => {
    input.addEventListener('focus', () => {
      input.parentElement.classList.add('focused');
    });
    input.addEventListener('blur', () => {
      input.parentElement.classList.remove('focused');
    });
  });

});
