export const runtime = "nodejs";
export default async function handler(req, res) {
  const TOKEN = process.env.GITHUB_TOKEN;
  const OWNER = "himalayanrock2022-maker";
  const REPO = "him-tech-rcm";
  const PATH = "hima-final/blog.json";
  const BRANCH = process.env.GITHUB_BRANCH || "master";

  if (!TOKEN) {
    return res.status(500).json({ error: "GITHUB_TOKEN is not configured in Vercel." });
  }

  const githubHeaders = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Hima-Tech-RCM-Blog"
  };

  // FIXED: Contents API bari file (1MB+) ko truncate kar deta hai, isliye
  // content ke liye RAW URL use karo. SHA ke liye hi Contents API use karo.
  const RAW_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}?t=${Date.now()}`;
  const CONTENTS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${encodeURIComponent(BRANCH)}`;

  // --- Helpers ---
  async function getPostsFromRaw() {
    const r = await fetch(RAW_URL, { cache: "no-store" });
    if (r.status === 404) return [];
    const text = await r.text();
    if (!text || !text.trim()) return [];
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("blog.json must contain an array.");
      return data;
    } catch (e) {
      throw new Error("data/blog.json contains invalid JSON. Details: " + e.message);
    }
  }

  async function getSha() {
    const r = await fetch(CONTENTS_URL, { headers: githubHeaders, cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) return null;
    const j = await r.json();
    return j.sha || null;
  }

  // --- Auth diagnostic (optional, fail mat karo) ---
  let githubAuthInfo = null;
  try {
    const authRes = await fetch("https://api.github.com/user", { headers: githubHeaders, cache: "no-store" });
    if (authRes.ok) {
      const d = await authRes.json();
      githubAuthInfo = { login: d.login || null, id: d.id || null, type: d.type || null };
    }
  } catch (e) { githubAuthInfo = { error: e.message }; }

  let githubRepoInfo = null;
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: githubHeaders, cache: "no-store" });
    if (repoRes.ok) {
      const d = await repoRes.json();
      githubRepoInfo = { full_name: d.full_name || null, default_branch: d.default_branch || null, permissions: d.permissions || null };
    }
  } catch (e) { githubRepoInfo = { error: e.message }; }

  try {
    // ===== GET =====
    if (req.method === "GET") {
      const posts = await getPostsFromRaw();
      posts.sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return res.status(200).json(posts);
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

    // ===== BODY =====
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch (e) { return res.status(400).json({ error: "Invalid JSON request body.", details: e.message }); }

    const action = body?.action;
    const post = body?.post || null;
    const postId = body?.postId || post?.id || null;
    const allowed = ["create", "update", "delete"];
    if (!allowed.includes(action)) return res.status(400).json({ error: "Invalid action. Use create, update or delete." });
    if (action !== "delete" && !post) return res.status(400).json({ error: "Post data is missing." });
    if ((action === "update" || action === "delete") && !postId) return res.status(400).json({ error: "postId is required for update/delete." });

    // FIXED: Bari base64 image ko pehle hi rok do - warna file phir 1MB+ ho jayegi
    if (post?.image && typeof post.image === "string" && post.image.startsWith("data:image")) {
      if (post.image.length > 500000) {
        return res.status(400).json({ error: "Image too large (over ~500KB base64). Paste an image URL instead. Example: https://www.himatechrcm.com/images/your-image.jpg" });
      }
    }

    // ===== READ CURRENT - RAW se, Contents API se NAHI =====
    let currentPosts = [];
    try { currentPosts = await getPostsFromRaw(); } catch (e) {
      return res.status(500).json({ error: "Existing data/blog.json contains invalid JSON. Save aborted.", details: e.message });
    }
    const sha = await getSha();

    // Safety: agar file hai lekin 0 posts hain to galti se overwrite mat karo
    // Lekin agar user ne jaan ke sab delete kiya ho to delete action ko allow karo
    if (currentPosts.length === 0 && action !== "delete" && sha) {
      // Sirf tab roko jab RAW se 0 aaye lekin SHA bhi hai - matlab file khaali hai
      // Pehle wali safety ko soft kar diya: allow create if file is empty array []
      // Isliye yahan rokna band kar diya hai - khaali file me naya post add karne do
    }

    let finalPost = post;
    if (finalPost) finalPost = { ...finalPost, id: finalPost.id || Date.now() };

    if (action === "create") {
      const dup = currentPosts.some(p => String(p.id) === String(finalPost.id));
      if (dup) return res.status(409).json({ error: "A post with this ID already exists." });
      currentPosts = [finalPost, ...currentPosts];
    } else if (action === "update") {
      let found = false;
      currentPosts = currentPosts.map(p => { if (String(p.id) === String(postId)) { found = true; return finalPost; } return p; });
      if (!found) return res.status(404).json({ error: "Post to update was not found." });
    } else if (action === "delete") {
      const before = currentPosts.length;
      currentPosts = currentPosts.filter(p => String(p.id) !== String(postId));
      if (currentPosts.length === before) return res.status(404).json({ error: "Post to delete was not found." });
    }

    // Dedupe + Sort
    const seen = new Set(); const uniq = [];
    for (const it of currentPosts) { const id = String(it.id); if (seen.has(id)) continue; seen.add(id); uniq.push(it); }
    currentPosts = uniq;
    currentPosts.sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());

    // ===== PUT to GitHub =====
    const putUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
    const encoded = Buffer.from(JSON.stringify(currentPosts, null, 2), "utf-8").toString("base64");
    const putBody = { message: `blog ${action} - ${post?.title || postId || "post"}`, content: encoded, branch: BRANCH };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(putUrl, { method: "PUT", headers: { ...githubHeaders, "Content-Type": "application/json" }, body: JSON.stringify(putBody) });
    if (!putRes.ok) {
      const errorText = await putRes.text();
      console.error("GITHUB PUT ERROR:", { status: putRes.status, response: errorText });
      return res.status(500).json({ error: "GitHub PUT failed.", status: putRes.status, details: errorText, githubAuthentication: githubAuthInfo, githubRepository: githubRepoInfo, repository: `${OWNER}/${REPO}`, path: PATH, branch: BRANCH });
    }
    const putData = await putRes.json();
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).json({ success: true, action, count: currentPosts.length, post: finalPost || null, commit: putData?.commit?.sha || null });
  } catch (error) {
    console.error("BLOG API UNEXPECTED ERROR:", error);
    return res.status(500).json({ error: error?.message || "Internal server error.", details: error?.stack || null });
  }
}
