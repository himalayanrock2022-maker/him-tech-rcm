const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'himalayanrock2022-maker/him-tech-rcm';
const FILE_PATH = 'hima-final/blog.json';
const BRANCH = 'master';

async function getBlogs() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

module.exports = async function handler(req, res) {
  const blogs = await getBlogs();
  const base = 'https://www.himatechrcm.com';

  const staticUrls = [
    { loc: `${base}/`, priority: '1.0' },
    { loc: `${base}/about.html`, priority: '0.8' },
    { loc: `${base}/blog.html`, priority: '0.8' },
    { loc: `${base}/contact.html`, priority: '0.7' },
    { loc: `${base}/specialties.html`, priority: '0.7' },
    { loc: `${base}/privacy.html`, priority: '0.3' },
    { loc: `${base}/terms.html`, priority: '0.3' },
    { loc: `${base}/services/revenue-cycle-management.html`, priority: '0.9' },
    { loc: `${base}/services/medical-coding.html`, priority: '0.9' },
    { loc: `${base}/services/medical-billing.html`, priority: '0.9' },
    { loc: `${base}/services/denial-management.html`, priority: '0.8' },
    { loc: `${base}/services/provider-credentialing.html`, priority: '0.8' },
    { loc: `${base}/services/payer-enrollment.html`, priority: '0.8' },
    { loc: `${base}/services/eligibility-verification.html`, priority: '0.8' },
    { loc: `${base}/services/credentialing-tracking.html`, priority: '0.8' },
    { loc: `${base}/services/prior-authorization.html`, priority: '0.8' },
    { loc: `${base}/services/caqh-management.html`, priority: '0.8' },
    { loc: `${base}/services/hospital-privileging.html`, priority: '0.8' },
    { loc: `${base}/services/medicare-pecos.html`, priority: '0.8' },
    { loc: `${base}/services/medicaid-enrollment.html`, priority: '0.8' },
    { loc: `${base}/services/claims-management.html`, priority: '0.8' },
  ];

  let xmlUrls = '';
  staticUrls.forEach(u => {
    xmlUrls += `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>\n`;
  });

  blogs.forEach(b => {
    const slug = b.slug || b.id;
    if (slug) {
      xmlUrls += `  <url><loc>${base}/blog/${slug}</loc><priority>0.6</priority></url>\n`;
    }
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlUrls}</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(xml);
};
