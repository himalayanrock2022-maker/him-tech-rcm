const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'himalayanrock2022-maker/him-tech-rcm';
const FILE_PATH = 'hima-final/blog.json';
const BRANCH = 'master';

async function getFileSHA() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) throw new Error('Failed to get file SHA');
  const data = await res.json();
  return data.sha;
}

async function getBlogContent() {
  const sha = await getFileSHA();
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  });
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { sha, posts: JSON.parse(content) };
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { posts } = await getBlogContent();
      return res.status(200).json(posts);
    }

    if (req.method === 'POST') {
      const { posts, action, postId } = req.body;
      const { sha, posts: currentPosts } = await getBlogContent();
      let updatedPosts;

      if (action === 'delete') {
        updatedPosts = currentPosts.filter(p => p.id !== postId);
      } else if (action === 'update') {
        updatedPosts = currentPosts.map(p => p.id === postId ? posts[0] : p);
      } else {
        updatedPosts = [...posts, ...currentPosts];
      }

      const commitMsg = action === 'delete' ? 'Blog: Delete post' : action === 'update' ? 'Blog: Update post' : `Blog: Add "${posts[0]?.title || 'new post'}"`;
      await commitBlog(updatedPosts, sha, commitMsg);
      return res.status(200).json({ success: true, count: updatedPosts.length });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
