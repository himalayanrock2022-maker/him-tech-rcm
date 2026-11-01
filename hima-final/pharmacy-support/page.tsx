export default function PharmacySupport() {
  return (
    <main style={{fontFamily:'sans-serif'}}>
      <section style={{background:'linear-gradient(rgba(26,10,10,.82),rgba(26,10,10,.82)), url(/assets/images/hero-home.jpg) center/cover', color:'white', padding:'80px 20px', textAlign:'center'}}>
        <p style={{letterSpacing:'2px', fontSize:'12px', color:'#ffb3c1'}}>PHARMACY SUPPORT SERVICES</p>
        <h1 style={{fontSize:'42px', fontWeight:800, margin:'10px 0'}}>HIPAA Compliant Call Center for Independent Pharmacies</h1>
        <p>EST Hours | Refill Reminders | Free Delivery Campaign Support | Prior Auth & Customer Support</p>
      </section>

      <section style={{padding:'60px 20px', maxWidth:'1100px', margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px'}}>
        <div style={{border:'1px solid #eee', padding:'24px', borderRadius:'16px'}}><h3>HIPAA Compliant</h3><p>BAA Signed, Call Recording, Secure CRM, DNC Scrubbed</p></div>
        <div style={{border:'1px solid #eee', padding:'24px', borderRadius:'16px'}}><h3>EST Hours Coverage</h3><p>Pakistan 8PM-4AM = US 9AM-5PM EST, US Caller ID</p></div>
        <div style={{border:'1px solid #eee', padding:'24px', borderRadius:'16px'}}><h3>Refill Reminders & Retention</h3><p>Reduce missed refills, bring back old patients with free delivery info</p></div>
        <div style={{border:'1px solid #eee', padding:'24px', borderRadius:'16px'}}><h3>Free Delivery Campaigns</h3><p>Compliant outreach, no pressure selling, opt-out included</p></div>
      </section>

      <section style={{textAlign:'center', padding:'40px'}}>
        <h2>Ready to reduce missed refills?</h2>
        <p>We work on flat monthly fee — no per-prescription commission (Anti-Kickback Compliant)</p>
        <a href="/contact" style={{background:'#842135', color:'white', padding:'12px 24px', borderRadius:'8px', textDecoration:'none'}}>Get 3-Day Free Trial</a>
      </section>
    </main>
  )
}