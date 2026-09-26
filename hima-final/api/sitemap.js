const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'himalayanrock2022-maker/him-tech-rcm';
const FILE_PATH = 'hima-final/blog.json';
const BRANCH = 'master';

// Wahi short URL map jo aapne blog API me use kiya
const SHORT_URL_MAP = {
  "when-do-fy-2027-icd-10-pcs-updates-go-into-effect-effective": "fy-2027-pcs-effective-date",
  "icd-10-changes-2027-complete-list-of-new-deleted-revised": "icd-10-changes-2027",
  "medicaid-income-rules-2026-caregiving-self-employment-work": "medicaid-income-rules-2026"
};

function getShortSlug(slug) {
  return SHORT_URL_MAP[slug] || slug;
}

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

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toISOString().split('T')[0]; // YYYY-MM-DD
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

module.exports = async function handler(req, res) {
  const blogs = await getBlogs();
  const base = 'https://www.himatechrcm.com';
  const today = formatDate(new Date());

  // SEO FIX: Saare static URLs with lastmod + changefreq
  const staticUrls = [
    { loc: `${base}/`, priority: '1.0', changefreq: 'daily', lastmod: today },
    { loc: `${base}/about`, priority: '0.8', changefreq: 'monthly', lastmod: today },
    { loc: `${base}/blog`, priority: '0.9', changefreq: 'daily', lastmod: today },
    { loc: `${base}/contact`, priority: '0.8', changefreq: 'monthly', lastmod: today },
    { loc: `${base}/audit`, priority: '0.8', changefreq: 'monthly', lastmod: today },
    { loc: `${base}/specialties`, priority: '0.7', changefreq: 'monthly', lastmod: today },
    // Services - High Priority
    { loc: `${base}/services/medical-billing`, priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/revenue-cycle-management`, priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/medical-coding`, priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/provider-credentialing`, priority: '0.9', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/payer-enrollment`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/denial-management`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/eligibility-verification`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/claims-management`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/prior-authorization`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/caqh-management`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/medicare-pecos`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/medicaid-enrollment`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/hospital-privileging`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    { loc: `${base}/services/credentialing-tracking`, priority: '0.8', changefreq: 'weekly', lastmod: today },
    // Tools
    { loc: `${base}/tools/patient-bill-defender`, priority: '0.7', changefreq: 'monthly', lastmod: today },
    { loc: `${base}/tools/doctor-rcm-portal`, priority: '0.7', changefreq: 'monthly', lastmod: today },
    { loc: `${base}/privacy`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${base}/terms`, priority: '0.3', changefreq: 'yearly', lastmod: today },
    { loc: `${base}/hipaa`, priority: '0.3', changefreq: 'yearly', lastmod: today },
  ];

  let xmlUrls = '';
  staticUrls.forEach(u => {
    xmlUrls += ` <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>\n`;
  });

  // SEO FIX: Blog posts - Sirf short slug, lastmod ke saath
  const uniqueSlugs = new Set();
  blogs.forEach(b => {
    if (!b.slug &&!b.id) return;
    if (b.status === 'draft') return; // Draft ko sitemap me mat dalo

    let slug = b.slug || b.id;
    slug = getShortSlug(slug); // Long ko short me convert

    if (uniqueSlugs.has(slug)) return; // Duplicate rokna
    uniqueSlugs.add(slug);

    const lastmod = formatDate(b.lastModified || b.date || b.updatedAt || new Date());
    xmlUrls += ` <url>
    <loc>${base}/blog/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>\n`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlUrls}</urlset>`;

  // SEO FIX: Caching + Correct Headers
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
