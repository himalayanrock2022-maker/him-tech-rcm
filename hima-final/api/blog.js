export default async function handler(req, res) {
  const TOKEN = process.env.GITHUB_TOKEN;
  const OWNER = "him-tech-rcm";
  const REPO = "hima-final";
  const PATH = "data/blog.json";
  const BRANCH = process.env.GITHUB_BRANCH || "master";

  // ---------------------------------------------------------
  // BASIC CONFIG CHECK
  // ---------------------------------------------------------

  if (!TOKEN) {
    return res.status(500).json({
      error: "GITHUB_TOKEN is not configured in Vercel."
    });
  }

  const githubUrl =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${encodeURIComponent(BRANCH)}`;

  const githubHeaders = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };


  try {

    // =======================================================
    // GET
    // /api/blog
    //
    // Public blog + Blog Builder use this to read posts.
    // =======================================================

    if (req.method === "GET") {

      const getRes = await fetch(githubUrl, {
        method: "GET",
        headers: githubHeaders,
        cache: "no-store"
      });


      // File does not exist yet
      if (getRes.status === 404) {

        return res.status(200).json([]);

      }


      if (!getRes.ok) {

        const errorText =
          await getRes.text();

        return res.status(500).json({
          error: "Unable to read blog data from GitHub.",
          status: getRes.status,
          details: errorText
        });

      }


      const file =
        await getRes.json();


      if (!file.content) {

        return res.status(500).json({
          error: "GitHub blog.json has no content."
        });

      }


      let posts;


      try {

        const decoded =
          Buffer
            .from(file.content, "base64")
            .toString("utf-8");

        posts =
          JSON.parse(decoded);

      } catch (error) {

        return res.status(500).json({
          error: "data/blog.json contains invalid JSON.",
          details: error.message
        });

      }


      if (!Array.isArray(posts)) {

        return res.status(500).json({
          error: "data/blog.json must contain an array."
        });

      }


      /*
       * Newest posts first.
       * We do not modify the GitHub file here.
       */

      posts.sort(function (a, b) {

        const dateA =
          new Date(a?.date || 0).getTime();

        const dateB =
          new Date(b?.date || 0).getTime();

        return dateB - dateA;

      });


      res.setHeader(
        "Cache-Control",
        "no-store, max-age=0"
      );


      return res.status(200).json(posts);

    }


    // =======================================================
    // POST
    // CREATE / UPDATE / DELETE
    // =======================================================

    if (req.method !== "POST") {

      return res.status(405).json({
        error: "Method not allowed"
      });

    }


    // -------------------------------------------------------
    // READ REQUEST BODY
    // -------------------------------------------------------

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;


    const action =
      body?.action;


    const post =
      body?.post || null;


    const postId =
      body?.postId || post?.id || null;


    const allowedActions = [
      "create",
      "update",
      "delete"
    ];


    if (!allowedActions.includes(action)) {

      return res.status(400).json({
        error:
          "Invalid action. Use create, update or delete."
      });

    }


    if (action !== "delete" && !post) {

      return res.status(400).json({
        error: "post missing"
      });

    }


    if (
      (action === "update" || action === "delete") &&
      !postId
    ) {

      return res.status(400).json({
        error:
          "postId is required for update/delete."
      });

    }


    // -------------------------------------------------------
    // GET CURRENT GITHUB FILE
    // -------------------------------------------------------

    const getRes =
      await fetch(githubUrl, {
        method: "GET",
        headers: githubHeaders,
        cache: "no-store"
      });


    /*
     * GitHub API failed.
     *
     * IMPORTANT:
     * Never overwrite the file if we cannot safely read it.
     */

    if (
      !getRes.ok &&
      getRes.status !== 404
    ) {

      const errorText =
        await getRes.text();

      return res.status(500).json({
        error:
          `GitHub fetch failed ${getRes.status}. Save aborted to protect existing posts.`,
        details: errorText
      });

    }


    let currentPosts = [];
    let sha = null;


    // -------------------------------------------------------
    // EXISTING FILE
    // -------------------------------------------------------

    if (getRes.ok) {

      const file =
        await getRes.json();


      sha =
        file.sha || null;


      if (!file.content) {

        return res.status(500).json({
          error:
            "GitHub returned the blog file without content. Save aborted."
        });

      }


      try {

        const decoded =
          Buffer
            .from(file.content, "base64")
            .toString("utf-8");


        currentPosts =
          JSON.parse(decoded);


      } catch (error) {

        return res.status(500).json({
          error:
            "Existing data/blog.json contains invalid JSON. Save aborted.",
          details:
            error.message
        });

      }


      if (!Array.isArray(currentPosts)) {

        return res.status(500).json({
          error:
            "Existing data/blog.json is not an array. Save aborted."
        });

      }

    }


    // -------------------------------------------------------
    // SAFETY CHECK
    // -------------------------------------------------------

    /*
     * If GitHub says the file exists and has a SHA but the
     * parsed file is empty, do NOT overwrite it.
     *
     * This protects your existing posts if something goes
     * wrong while reading the file.
     */

    if (
      getRes.ok &&
      sha &&
      currentPosts.length === 0
    ) {

      return res.status(500).json({
        error:
          "File exists but contains zero posts. Save aborted to prevent data loss."
      });

    }


    // -------------------------------------------------------
    // NORMALIZE POST ID
    // -------------------------------------------------------

    let finalPost = post;


    if (finalPost) {

      finalPost = {
        ...finalPost,
        id:
          finalPost.id ||
          Date.now()
      };

    }


    // -------------------------------------------------------
    // CREATE
    // -------------------------------------------------------

    if (action === "create") {

      /*
       * Prevent accidental duplicate IDs.
       */

      const duplicate =
        currentPosts.some(
          p =>
            String(p.id) ===
            String(finalPost.id)
        );


      if (duplicate) {

        return res.status(409).json({
          error:
            "A post with this ID already exists."
        });

      }


      currentPosts = [
        finalPost,
        ...currentPosts
      ];

    }


    // -------------------------------------------------------
    // UPDATE
    // -------------------------------------------------------

    else if (action === "update") {

      let found = false;


      currentPosts =
        currentPosts.map(function (existingPost) {

          if (
            String(existingPost.id) ===
            String(postId)
          ) {

            found = true;

            return finalPost;

          }

          return existingPost;

        });


      if (!found) {

        return res.status(404).json({
          error:
            "Post to update was not found."
        });

      }

    }


    // -------------------------------------------------------
    // DELETE
    // -------------------------------------------------------

    else if (action === "delete") {

      const beforeCount =
        currentPosts.length;


      currentPosts =
        currentPosts.filter(function (existingPost) {

          return (
            String(existingPost.id) !==
            String(postId)
          );

        });


      if (
        currentPosts.length ===
        beforeCount
      ) {

        return res.status(404).json({
          error:
            "Post to delete was not found."
        });

      }

    }


    // -------------------------------------------------------
    // REMOVE DUPLICATE IDs
    // -------------------------------------------------------

    const uniquePosts =
      [];


    const seenIds =
      new Set();


    for (const item of currentPosts) {

      const id =
        String(item.id);


      if (seenIds.has(id)) {

        continue;

      }


      seenIds.add(id);

      uniquePosts.push(item);

    }


    currentPosts =
      uniquePosts;


    // -------------------------------------------------------
    // SORT NEWEST FIRST
    // -------------------------------------------------------

    currentPosts.sort(function (a, b) {

      const dateA =
        new Date(a?.date || 0).getTime();

      const dateB =
        new Date(b?.date || 0).getTime();

      return dateB - dateA;

    });


    // -------------------------------------------------------
    // WRITE BACK TO GITHUB
    // -------------------------------------------------------

    const putUrl =
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;


    const putBody = {

      message:
        `blog ${action} - ${post?.title || postId || "post"}`,

      content:
        Buffer
          .from(
            JSON.stringify(
              currentPosts,
              null,
              2
            ),
            "utf-8"
          )
          .toString("base64"),

      branch:
        BRANCH

    };


    /*
     * GitHub requires SHA when updating an existing file.
     */

    if (sha) {

      putBody.sha =
        sha;

    }


    const putRes =
      await fetch(putUrl, {

        method: "PUT",

        headers: {
          ...githubHeaders,
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(putBody)

      });


    if (!putRes.ok) {
if (!putRes.ok) {
  const errorText = await putRes.text();

  console.error("GITHUB PUT ERROR:", {
    status: putRes.status,
    response: errorText
  });

  return res.status(500).json({
    error: "GitHub PUT failed.",
    status: putRes.status,
    details: errorText
  });
}


    const putData =
      await putRes.json();


    // -------------------------------------------------------
    // SUCCESS
    // -------------------------------------------------------

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0"
    );


    return res.status(200).json({

      success:
        true,

      action:
        action,

      count:
        currentPosts.length,

      post:
        finalPost || null,

      commit:
        putData?.commit?.sha || null

    });


  } catch (error) {

    console.error(
      "BLOG API ERROR:",
      error
    );


    return res.status(500).json({

      error:
        error.message ||
        "Internal server error"

    });

  }

          }
