// /api/blog.js - FIXED FOR HIMATECH
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO || 'himatechrcm/himatechrcm.com'; // apna repo name yahan check karo
  const FILE_PATH = 'data/blog.json'; // jahan blog posts save hote hain

  if (req.method === 'GET') {
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
        cache: 'no-store'
      });
      if (!ghRes.ok) return res.status(200).json([]);
      const file = await ghRes.json();
      const content = Buffer.from(file.content, 'base64').toString('utf-8');
      return res.status(200).json(JSON.parse(content));
    } catch(e) {
      return res.status(200).json([]);
    }
  }

  if (req.method === 'POST') {
    try {
      const { action, posts, post, postId } = req.body;
      
      // Get current file SHA
      let sha = null;
      let currentPosts = [];
      try {
        const ghGet = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
          headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
        });
        if (ghGet.ok) {
          const data = await ghGet.json();
          sha = data.sha;
          currentPosts = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
        }
      } catch {}

      let finalPosts = currentPosts;
      if (action === 'create' && posts) finalPosts = posts;
      else if (action === 'create' && post) finalPosts = [post, ...currentPosts];
      else if (action === 'update' && posts) finalPosts = posts;
      else if (action === 'delete' && postId) finalPosts = currentPosts.filter(p => String(p.id) !== String(postId));
      else if (posts) finalPosts = posts;

      const updatedContent = Buffer.from(JSON.stringify(finalPosts, null, 2)).toString('base64');

      const ghPut = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Blog ${action}: ${post?.title || postId || 'update'}`,
          content: updatedContent,
          sha: sha
        })
      });

      const result = await ghPut.json();
      if (!ghPut.ok) {
        console.error('GitHub error:', result);
        return res.status(ghPut.status).json({ error: result.message || 'GitHub save failed', details: result });
      }

      return res.status(200).json({ success: true, posts: finalPosts });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
}
