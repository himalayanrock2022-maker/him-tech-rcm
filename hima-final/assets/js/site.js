
document.addEventListener('DOMContentLoaded',()=>{
 // Close mobile menu on page load (fix back navigation keeping menu open)
 const mobile=document.querySelector('.mobile-menu');
 if(mobile) mobile.classList.remove('show');

 // Mobile menu toggle
 const menu=document.querySelector('.menu');
 if(menu&&mobile) menu.addEventListener('click',()=>{
  mobile.classList.toggle('show');
 });

 // Close mobile menu when clicking any link
 if(mobile) mobile.querySelectorAll('a').forEach(a=>{
  a.addEventListener('click',()=>mobile.classList.remove('show'));
 });

 // Mobile services dropdown toggle
 if(mobile){
  const svcBtn=mobile.querySelector('strong');
  if(svcBtn){
   svcBtn.style.cursor='pointer';
   svcBtn.style.userSelect='none';
   // Hide services by default on mobile
   const svcLinks=[];
   let next=svcBtn.nextElementSibling;
   while(next&&next.tagName!=='HR'&&next.tagName!=='STRONG'){
    svcLinks.push(next);
    next=next.nextElementSibling;
   }
   svcLinks.forEach(l=>l.style.display='none');
   svcBtn.innerHTML='Services <i class="fa-solid fa-chevron-down" style="font-size:11px;margin-left:6px"></i>';
   svcBtn.addEventListener('click',()=>{
    const visible=svcLinks[0]&&svcLinks[0].style.display!=='none';
    svcLinks.forEach(l=>l.style.display=visible?'none':'block');
    const icon=svcBtn.querySelector('i');
    if(icon) icon.style.transform=visible?'rotate(0deg)':'rotate(180deg)';
   });
  }
 }

 // Smooth scroll
 document.querySelectorAll('[data-scroll]').forEach(a=>a.addEventListener('click',e=>{const el=document.querySelector(a.dataset.scroll);if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth'});}}));

 // Form submission - handled by FormSubmit.co (action on form tag)

 // Animated counting numbers
 function animateCount(el) {
  const target = parseFloat(el.dataset.count);
  const suffix = el.dataset.suffix || '';
  const isDecimal = target % 1 !== 0;
  const duration = 2000;
  const start = performance.now();

  function update(now) {
   const elapsed = now - start;
   const progress = Math.min(elapsed / duration, 1);
   const eased = 1 - Math.pow(1 - progress, 3);
   const current = eased * target;

   if (isDecimal) {
    el.textContent = current.toFixed(1) + suffix;
   } else {
    el.textContent = Math.floor(current).toLocaleString() + suffix;
   }

   if (progress < 1) {
    requestAnimationFrame(update);
   }
  }
  requestAnimationFrame(update);
 }

 // Observe metric elements
 const metricObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
   if (entry.isIntersecting) {
    const strong = entry.target.querySelector('strong[data-count]');
    if (strong && !strong.dataset.animated) {
     strong.dataset.animated = 'true';
     animateCount(strong);
    }
   }
  });
 }, { threshold: 0.5 });

 document.querySelectorAll('.metric').forEach(m => metricObserver.observe(m));

 // Scroll reveal
 const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
   if (entry.isIntersecting) {
    entry.target.classList.add('active');
   }
  });
 }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

 document.querySelectorAll('.card, .step, .trust-item, .specialty, .faq details, .form-card, .service-box').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
 });

 // Navbar scroll effect
 const navbar = document.querySelector('.navbar');
 window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
   navbar.style.boxShadow = '0 4px 30px rgba(139,26,26,.1)';
  } else {
   navbar.style.boxShadow = '0 4px 30px rgba(0,0,0,.06)';
  }
 });
});
