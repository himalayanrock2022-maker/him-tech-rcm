const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'himalayanrock2022-maker/him-tech-rcm';
const FILE_PATH = 'hima-final/blog.json';
const BRANCH = 'master';

// SEO FIX: Short URL Map - 301 ke liye
const SHORT_URL_MAP = {
  "when-do-fy-2027-icd-10-pcs-updates-go-into-effect-effective": "fy-2027-pcs-effective-date",
  "icd-10-changes-2027-complete-list-of-new-deleted-revised": "icd-10-changes-2027",
  "medicaid-income-rules-2026-caregiving-self-employment-work": "medicaid-income-rules-2026"
};

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
}

function getShortSlug(originalSlug) {
  if (!originalSlug) return "";
  return SHORT_URL_MAP[originalSlug] || originalSlug;
}

// SEO FIX: Har post me SEO fields auto-add honge
function enrichPost(post) {
  if (!post) return post;
  const rawSlug = post.slug || slugify(post.title || '');
  const finalSlug = getShortSlug(rawSlug);
  const isShortened =!!SHORT_URL_MAP[rawSlug];

  // Auto SEO Title & Description agar nahi hai
  const seoTitle = post.seoTitle || `${post.title} | Hima Tech RCM Blog`;
  const seoDescription = post.seoDescription || (post.excerpt? post.excerpt.substring(0, 155) : `${post.title.substring(0, 120)} - Read latest updates on medical billing and RCM.`);

  return {
   ...post,
    slug: finalSlug,
    // SEO Fields
    seoTitle: seoTitle.substring(0, 60),
    seoDescription: seoDescription.substring(0, 160),
    canonicalUrl: `https://www.himatechrcm.com/blog/${finalSlug}`,
    // Redirect handling
    originalSlug: isShortened? rawSlug : (post.originalSlug || undefined),
    hasRedirect: isShortened,
    shortUrl: `https://www.himatechrcm.com/blog/${finalSlug}`,
    lastModified: post.lastModified || new Date().toISOString()
  };
}

async function getBlogContent() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to get file SHA: ' + res.status);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { sha: data.sha, posts: JSON.parse(content) };
}

async function commitBlog(newPosts, sha, message) {
  const content = Buffer.from(JSON.stringify(newPosts, null, 2)).toString('base64');
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, sha, branch: BRANCH })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to commit');
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { posts } = await getBlogContent();
      // SEO: Sab posts ko enrich karo + short wale ko force short
      const enriched = posts.map(enrichPost).sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
      return res.status(200).json(enriched);
    }

    if (req.method === 'POST') {
      const { posts, action, postId } = req.body;
      const { sha, posts: currentPosts } = await getBlogContent();
      let updatedPosts;

      if (action === 'delete') {
        updatedPosts = currentPosts.filter(p => p.id!== postId);
      } else if (action === 'update') {
        updatedPosts = currentPosts.map(p => p.id === postId? enrichPost({...p,...posts[0], lastModified: new Date().toISOString()}) : enrichPost(p));
      } else {
        // new post add - SEO fields ke saath
        const newEnriched = posts.map(p => enrichPost({...p, date: p.date || new Date().toISOString()}));
        updatedPosts = [...newEnriched,...currentPosts.map(enrichPost)];
      }

      updatedPosts = updatedPosts.map(enrichPost);

      const commitMsg = action === 'delete'? 'Blog: Delete post' : action === 'update'? `Blog: Update post ${postId}` : `Blog: Add "${posts[0]?.title || 'new post'}"`;
      await commitBlog(updatedPosts, sha, commitMsg);
      return res.status(200).json({ success: true, count: updatedPosts.length, posts: updatedPosts });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
