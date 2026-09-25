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
    { loc: `${base}/about`, priority: '0.8' },
    { loc: `${base}/blog`, priority: '0.8' },
    { loc: `${base}/contact`, priority: '0.7' },
    { loc: `${base}/specialties`, priority: '0.7' },
    { loc: `${base}/privacy`, priority: '0.3' },
    { loc: `${base}/terms`, priority: '0.3' },
    { loc: `${base}/services/revenue-cycle-management`, priority: '0.9' },
    { loc: `${base}/services/medical-coding`, priority: '0.9' },
    { loc: `${base}/services/medical-billing`, priority: '0.9' },
    { loc: `${base}/services/denial-management`, priority: '0.8' },
    { loc: `${base}/services/provider-credentialing`, priority: '0.8' },
    { loc: `${base}/services/payer-enrollment`, priority: '0.8' },
    { loc: `${base}/services/eligibility-verification`, priority: '0.8' },
    { loc: `${base}/services/credentialing-tracking`, priority: '0.8' },
    { loc: `${base}/services/prior-authorization`, priority: '0.8' },
    { loc: `${base}/services/caqh-management`, priority: '0.8' },
    { loc: `${base}/services/hospital-privileging`, priority: '0.8' },
    { loc: `${base}/services/medicare-pecos`, priority: '0.8' },
    { loc: `${base}/services/medicaid-enrollment`, priority: '0.8' },
    { loc: `${base}/services/claims-management`, priority: '0.8' },
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
