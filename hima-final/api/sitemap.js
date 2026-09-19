const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'himalayanrock2022-maker/him-tech-rcm';
const FILE_PATH = 'hima-final/blog.json';
const BRANCH = 'master';

async function getBlogs() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return [];
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

module.exports = async function handler(req, res) {
  try {
    const blogs = await getBlogs();
    const base = 'https://www.himatechrcm.com';

    let urls = `
  <url><loc>${base}/</loc><priority>1.0</priority></url>
  <url><loc>${base}/about.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/blog.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/contact.html</loc><priority>0.7</priority></url>
  <url><loc>${base}/specialties.html</loc><priority>0.7</priority></url>
  <url><loc>${base}/services/medical-billing.html</loc><priority>0.9</priority></url>
  <url><loc>${base}/services/medical-coding.html</loc><priority>0.9</priority></url>
  <url><loc>${base}/services/revenue-cycle-management.html</loc><priority>0.9</priority></url>
  <url><loc>${base}/services/denial-management.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/services/provider-credentialing.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/services/payer-enrollment.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/services/eligibility-verification.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/services/credentialing-tracking.html</loc><priority>0.8</priority></url>
  <url><loc>${base}/services/prior-authorization.html</loc><priority>0.8</priority></url>
`;

    blogs.forEach(b => {
      const slug = b.slug || b.id;
      if (slug) {
        urls += `  <url><loc>${base}/blog.html?slug=${slug}</loc><priority>0.6</priority></url>\n`;
      }
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.status(200).send(xml);

  } catch (err) {
    res.status(500).send(err.message);
  }
};
