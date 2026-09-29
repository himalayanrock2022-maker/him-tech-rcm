// /api/blog.js - FINAL FIXED V2
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO;
  const FILE_PATH = 'data/blog.json';
  const BRANCH = process.env.GITHUB_BRANCH || 'main';

  if(!REPO) return res.status(500).json({error: 'GITHUB_REPO env missing'});
  if(!GITHUB_TOKEN) return res.status(500).json({error: 'GITHUB_TOKEN env missing'});

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  // GET - blog page ke liye
  if (req.method === 'GET') {
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`, {
        headers, cache: 'no-store'
      });
      if (!ghRes.ok) return res.status(200).json([]);
      const file = await ghRes.json();
      const content = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
      return res.status(200).json(content);
    } catch(e){
      return res.status(200).json([]);
    }
  }

  // POST
  if (req.method === 'POST') {
    try {
      const { action, post, postId } = req.body;

      // current data + sha lao
      let sha = undefined;
      let current = [];
      const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`, { headers });
      if(getRes.ok){
        const d = await getRes.json();
        sha = d.sha;
        current = JSON.parse(Buffer.from(d.content, 'base64').toString('utf-8'));
        if(!Array.isArray(current)) current = [];
      }

      let finalPosts = [...current];

      if(action === 'delete'){
        finalPosts = current.filter(p => String(p.id)!== String(postId));
      }
      else if(action === 'create' && post){
        finalPosts = [post,...current];
      }
      else if(action === 'update' && post){
        const id = postId || post.id;
        finalPosts = current.map(p => String(p.id) === String(id)? post : p);
        // agar map me nahi mila to add kar do
        if(!current.find(p => String(p.id) === String(id))){
          finalPosts = [post,...current];
        }
      }

      const body = {
        message: `blog ${action} - ${post?.slug || postId || 'update'} - ${new Date().toISOString()}`,
        content: Buffer.from(JSON.stringify(finalPosts, null, 2)).toString('base64'),
        branch: BRANCH
      };
      if(sha) body.sha = sha;

      const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body)
      });

      const result = await putRes.json();
      if(!putRes.ok) return res.status(putRes.status).json(result);

      return res.status(200).json({success: true, posts: finalPosts});
    } catch(e){
      return res.status(500).json({error: e.message});
    }
  }

  return res.status(405).json({error: 'Method not allowed'});
}
