
document.addEventListener('DOMContentLoaded',()=>{
 const menu=document.querySelector('.menu'), mobile=document.querySelector('.mobile-menu');
 if(menu&&mobile) menu.addEventListener('click',()=>mobile.classList.toggle('show'));
 document.querySelectorAll('[data-scroll]').forEach(a=>a.addEventListener('click',e=>{const el=document.querySelector(a.dataset.scroll);if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth'});}}));
 document.querySelectorAll('.demo-form').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();const btn=form.querySelector('button[type=submit]');const status=form.querySelector('.status');btn.disabled=true;btn.textContent='Sending…';const data=Object.fromEntries(new FormData(form).entries());try{const r=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to send');status.textContent='Thank you. Your request has been received.';status.style.display='block';form.reset()}catch(err){status.textContent=err.message+' Please email info@himatechrcm.com.';status.style.display='block'}finally{btn.disabled=false;btn.textContent='Request a Consultation'}}));
});
