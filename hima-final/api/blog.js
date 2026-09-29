export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const TOKEN = process.env.GITHUB_TOKEN;
  const OWNER = 'him-tech-rcm';
  const REPO = 'hima-final';
  const PATH = 'data/blog.json';
  const BRANCH = process.env.GITHUB_BRANCH || 'master'; // tumhara branch master hai

  try {
    const { action, post, postId } = req.body;
    if (!post && action !== 'delete') return res.status(400).json({ error: 'post missing' });

    // 1. Pehle GitHub se current file lao - agar fail hua to overwrite MAT karo
    const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      cache: 'no-store'
    });

    if (!getRes.ok && getRes.status !== 404) {
      const errText = await getRes.text();
      return res.status(500).json({ error: `GitHub fetch failed ${getRes.status} - ABORT to save data`, details: errText });
    }

    let current = [];
    let sha = null;
    if (getRes.ok) {
      const file = await getRes.json();
      sha = file.sha;
      current = JSON.parse(Buffer.from(file.content, 'base64').toString());
      if (!Array.isArray(current)) current = [];
    }

    // SAFETY: Agar sha hai lekin current empty hai to ye bug hai - abort karo
    if (sha && current.length === 0 && getRes.ok) {
      return res.status(500).json({ error: 'File empty but sha exists - aborting to prevent data loss' });
    }

    let finalPosts = [];
    if (action === 'create') {
      finalPosts = [post, ...current];
    } else if (action === 'update') {
      finalPosts = current.map(p => String(p.id) === String(postId || post.id) ? post : p);
    } else if (action === 'delete') {
      finalPosts = current.filter(p => String(p.id) !== String(postId));
    }

    // Duplicate id hatao
    finalPosts = [...new Map(finalPosts.map(p => [String(p.id), p])).values()];

    const putRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      body: JSON.stringify({
        message: `blog ${action} - ${post?.title || postId} - ${Date.now()}`,
        content: Buffer.from(JSON.stringify(finalPosts, null, 2)).toString('base64'),
        branch: BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    if (!putRes.ok) {
      const e = await putRes.text();
      return res.status(500).json({ error: 'GitHub PUT failed', details: e });
    }

    return res.status(200).json({ success: true, count: finalPosts.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
