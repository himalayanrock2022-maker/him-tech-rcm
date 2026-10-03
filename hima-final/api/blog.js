export const runtime = "nodejs";
export default async function handler(req, res) {

  const TOKEN = process.env.GITHUB_TOKEN;

  const OWNER = "himalayanrock2022-maker";
const REPO = "him-tech-rcm";
const PATH = "hima-final/blog.json";

  const BRANCH =
    process.env.GITHUB_BRANCH || "master";


  // =========================================================
  // CONFIG CHECK
  // =========================================================

  if (!TOKEN) {

    return res.status(500).json({
      error:
        "GITHUB_TOKEN is not configured in Vercel."
    });

  }


  const githubUrl =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${encodeURIComponent(BRANCH)}`;


  const githubHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Hima-Tech-RCM-Blog"
};

  try {

    // =======================================================
    // GET
    // =======================================================

    if (req.method === "GET") {

      const getRes =
        await fetch(githubUrl, {

          method: "GET",

          headers:
            githubHeaders,

          cache:
            "no-store"

        });


      // File does not exist
      if (getRes.status === 404) {
  const errorText = await getRes.text();

  return res.status(500).json({
    error: "GitHub returned 404",
    githubUrl: githubUrl,
    details: errorText
  });
}

      if (!getRes.ok) {

        const errorText =
          await getRes.text();

        console.error(
          "GITHUB GET ERROR:",
          {
            status:
              getRes.status,

            response:
              errorText
          }
        );


        return res.status(500).json({

          error:
            "Unable to read blog data from GitHub.",

          status:
            getRes.status,

          details:
            errorText

        });

      }


      const file =
        await getRes.json();


      if (!file.content) {

        return res.status(500).json({

          error:
            "GitHub blog.json has no content."

        });

      }


      let posts;


      try {

        const decoded =
          Buffer
            .from(
              file.content,
              "base64"
            )
            .toString("utf-8");


        posts =
          JSON.parse(decoded);


      } catch (error) {

        return res.status(500).json({

          error:
            "data/blog.json contains invalid JSON.",

          details:
            error.message

        });

      }


      if (!Array.isArray(posts)) {

        return res.status(500).json({

          error:
            "data/blog.json must contain an array."

        });

      }


      // Newest first
      posts.sort(
        function (a, b) {

          const dateA =
            new Date(
              a?.date || 0
            ).getTime();


          const dateB =
            new Date(
              b?.date || 0
            ).getTime();


          return dateB - dateA;

        }
      );


      res.setHeader(
        "Cache-Control",
        "no-store, max-age=0"
      );


      return res
        .status(200)
        .json(posts);

    }


    // =======================================================
    // ONLY POST ALLOWED BELOW
    // =======================================================

    if (req.method !== "POST") {

      return res.status(405).json({

        error:
          "Method not allowed."

      });

    }


    // =======================================================
    // READ REQUEST BODY
    // =======================================================

    let body;


    try {

      body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body;

    } catch (error) {

      return res.status(400).json({

        error:
          "Invalid JSON request body.",

        details:
          error.message

      });

    }


    const action =
      body?.action;


    const post =
      body?.post || null;


    const postId =
      body?.postId ||
      post?.id ||
      null;


    const allowedActions = [
      "create",
      "update",
      "delete"
    ];


    if (
      !allowedActions.includes(action)
    ) {

      return res.status(400).json({

        error:
          "Invalid action. Use create, update or delete."

      });

    }


    if (
      action !== "delete" &&
      !post
    ) {

      return res.status(400).json({

        error:
          "Post data is missing."

      });

    }


    if (
      (
        action === "update" ||
        action === "delete"
      ) &&
      !postId
    ) {

      return res.status(400).json({

        error:
          "postId is required for update/delete."

      });

    }


    // =======================================================
    // READ CURRENT GITHUB FILE
    // =======================================================

    const getRes =
      await fetch(githubUrl, {

        method:
          "GET",

        headers:
          githubHeaders,

        cache:
          "no-store"

      });


    if (
      !getRes.ok &&
      getRes.status !== 404
    ) {

      const errorText =
        await getRes.text();


      console.error(
        "GITHUB READ BEFORE WRITE ERROR:",
        {
          status:
            getRes.status,

          response:
            errorText
        }
      );


      return res.status(500).json({

        error:
          `GitHub fetch failed with status ${getRes.status}. Save aborted.`,

        status:
          getRes.status,

        details:
          errorText

      });

    }


    // =======================================================
    // CURRENT DATA
    // =======================================================

    let currentPosts = [];

    let sha = null;


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
            .from(
              file.content,
              "base64"
            )
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


      if (
        !Array.isArray(currentPosts)
      ) {

        return res.status(500).json({

          error:
            "Existing data/blog.json is not an array. Save aborted."

        });

      }

    }


    // =======================================================
    // SAFETY CHECK
    // =======================================================

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


    // =======================================================
    // NORMALIZE POST
    // =======================================================

    let finalPost =
      post;


    if (finalPost) {

      finalPost = {

        ...finalPost,

        id:
          finalPost.id ||
          Date.now()

      };

    }


    // =======================================================
    // CREATE
    // =======================================================

    if (action === "create") {

      const duplicate =
        currentPosts.some(
          function (existingPost) {

            return (
              String(existingPost.id) ===
              String(finalPost.id)
            );

          }
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


    // =======================================================
    // UPDATE
    // =======================================================

    else if (
      action === "update"
    ) {

      let found =
        false;


      currentPosts =
        currentPosts.map(
          function (existingPost) {

            if (
              String(existingPost.id) ===
              String(postId)
            ) {

              found =
                true;

              return finalPost;

            }


            return existingPost;

          }
        );


      if (!found) {

        return res.status(404).json({

          error:
            "Post to update was not found."

        });

      }

    }


    // =======================================================
    // DELETE
    // =======================================================

    else if (
      action === "delete"
    ) {

      const beforeCount =
        currentPosts.length;


      currentPosts =
        currentPosts.filter(
          function (existingPost) {

            return (
              String(existingPost.id) !==
              String(postId)
            );

          }
        );


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


    // =======================================================
    // REMOVE DUPLICATE IDS
    // =======================================================

    const uniquePosts =
      [];

    const seenIds =
      new Set();


    for (
      const item of currentPosts
    ) {

      const id =
        String(item.id);


      if (
        seenIds.has(id)
      ) {

        continue;

      }


      seenIds.add(id);

      uniquePosts.push(item);

    }


    currentPosts =
      uniquePosts;


    // =======================================================
    // SORT
    // =======================================================

    currentPosts.sort(
      function (a, b) {

        const dateA =
          new Date(
            a?.date || 0
          ).getTime();


        const dateB =
          new Date(
            b?.date || 0
          ).getTime();


        return dateB - dateA;

      }
    );


    // =======================================================
    // PREPARE GITHUB PUT
    // =======================================================

    const putUrl =
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;


    const jsonContent =
      JSON.stringify(
        currentPosts,
        null,
        2
      );


    const encodedContent =
      Buffer
        .from(
          jsonContent,
          "utf-8"
        )
        .toString("base64");


    const putBody = {

      message:
        `blog ${action} - ${post?.title || postId || "post"}`,

      content:
        encodedContent,

      branch:
        BRANCH

    };


    // GitHub requires SHA for existing file
    if (sha) {

      putBody.sha =
        sha;

    }


    // =======================================================
    // GITHUB PUT
    // =======================================================

    const putRes =
      await fetch(
        putUrl,
        {

          method:
            "PUT",

          headers: {

            ...githubHeaders,

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify(
              putBody
            )

        }
      );


    // =======================================================
    // GITHUB PUT ERROR
    // =======================================================

   if (!putRes.ok) {

  const errorText = await putRes.text();

  const permissionHeader =
    putRes.headers.get("X-Accepted-GitHub-Permissions");

  const remaining =
    putRes.headers.get("X-RateLimit-Remaining");

  console.error("GITHUB PUT ERROR:", {
    status: putRes.status,
    statusText: putRes.statusText,
    response: errorText,
    acceptedPermissions: permissionHeader,
    rateLimitRemaining: remaining,
    repo: `${OWNER}/${REPO}`,
    path: PATH,
    branch: BRANCH
  });

  return res.status(500).json({
    error: "GitHub PUT failed.",
    status: putRes.status,
    details: errorText,
    acceptedPermissions: permissionHeader,
    repository: `${OWNER}/${REPO}`,
    path: PATH,
    branch: BRANCH
  });

}

    // =======================================================
    // SUCCESS
    // =======================================================

    const putData =
      await putRes.json();


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
        putData?.commit?.sha ||
        null

    });


  } catch (error) {

    // =======================================================
    // UNEXPECTED SERVER ERROR
    // =======================================================

    console.error(
      "BLOG API UNEXPECTED ERROR:",
      error
    );


    return res.status(500).json({

      error:
        error?.message ||
        "Internal server error.",

      details:
        error?.stack ||
        null

    });

  }

}
