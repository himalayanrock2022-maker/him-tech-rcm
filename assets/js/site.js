document.addEventListener('DOMContentLoaded', () => {
  const menuBtn = document.querySelector('.menu');
  const mobileMenu = document.querySelector('.mobile-menu');
  const dropdowns = document.querySelectorAll('.navbar .dropdown');

  // 1. MOBILE MENU TOGGLE - SEO FIX (Accessible + Outside Click Close)
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileMenu.classList.toggle('show');
      document.body.style.overflow = mobileMenu.classList.contains('show') ? 'hidden' : '';
    });

    // Bahar click par menu band - UX + Core Web Vitals ke liye zaruri
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.navbar') && mobileMenu.classList.contains('show')) {
        mobileMenu.classList.remove('show');
        document.body.style.overflow = '';
      }
    });
  }

  // 2. DROPDOWN - Sab ek jagah (Pehle ye HTML me tha)
  dropdowns.forEach(drop => {
    const btn = drop.querySelector('button');
    if (!btn) return;
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = drop.classList.contains('open');
      dropdowns.forEach(d => d.classList.remove('open'));
      if (!isOpen) drop.classList.add('open');
    });
  });

  // Dropdown bahar click par band
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.navbar .dropdown')) {
      dropdowns.forEach(d => d.classList.remove('open'));
    }
  });

  // 3. SMOOTH SCROLL
  document.querySelectorAll('[data-scroll]').forEach(a => {
    a.addEventListener('click', e => {
      const el = document.querySelector(a.dataset.scroll);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (mobileMenu) mobileMenu.classList.remove('show');
      }
    });
  });

  // 4. COUNTER ANIMATION - SEO: Sirf jab screen par aaye tab chale (Performance)
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseFloat(el.dataset.count);
          const suffix = el.dataset.suffix || '';
          let current = 0;
          const step = target / 50;
          const timer = setInterval(() => {
            current += step;
            if (current >= target) {
              current = target;
              clearInterval(timer);
            }
            el.textContent = (Number.isInteger(target) ? Math.floor(current) : current.toFixed(1)) + suffix;
          }, 30);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(c => observer.observe(c));
  }

  // 5. FORM SUBMIT - Optimized
  document.querySelectorAll('.demo-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.status');
      if (!btn || !status) return;

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      
      const data = Object.fromEntries(new FormData(form).entries());
      
      try {
        const r = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Unable to send');
        
        status.textContent = 'Thank you. Your request has been received. We will contact you within 24 hours.';
        status.style.display = 'block';
        status.style.color = '#0e9e9a';
        form.reset();
      } catch (err) {
        status.textContent = err.message + ' Please email info@himatechrcm.com.';
        status.style.display = 'block';
        status.style.color = '#842135';
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });
});
