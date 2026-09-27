// /api/blog.js - FINAL FIXED
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO; // Vercel Env se hi lo, fallback mat rakho
  const FILE_PATH = 'data/blog.json';

  if(!REPO) return res.status(500).json({error: 'GITHUB_REPO env missing'});
  
  // GET
  if (req.method === 'GET') {
    const ghRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }, cache: 'no-store'
    });
    if (!ghRes.ok) return res.status(200).json([]);
    const file = await ghRes.json();
    return res.status(200).json(JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')));
  }

  // POST
  if (req.method === 'POST') {
    const { action, posts, post, postId } = req.body;
    // get sha
    let sha = undefined;
    let current = [];
    const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
    });
    if(getRes.ok){
      const d = await getRes.json();
      sha = d.sha;
      current = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8'));
    }

    let finalPosts = posts || current;
    if(action === 'delete') finalPosts = current.filter(p => String(p.id) !== String(postId));
    if(action === 'create' && post && !posts) finalPosts = [post, ...current];

    const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `blog ${action}`,
        content: Buffer.from(JSON.stringify(finalPosts, null, 2)).toString('base64'),
        sha
      })
    });
    const result = await putRes.json();
    if(!putRes.ok) return res.status(putRes.status).json(result);
    return res.status(200).json({success: true, posts: finalPosts});
  }
}
