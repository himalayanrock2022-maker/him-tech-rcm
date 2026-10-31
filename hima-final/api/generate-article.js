
export const runtime = "nodejs";

function countWords(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function cleanHtml(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, 'href="#"');
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel."
    });
  }

  try {
    const { topic, password } = req.body || {};

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return res.status(400).json({
        error: "Please enter an article topic."
      });
    }

    const expectedPassword =
      process.env.BLOG_ADMIN_PASSWORD || "himatech2026";

    if (password !== expectedPassword) {
      return res.status(401).json({
        error: "Admin authentication failed."
      });
    }

    const prompt = `
You are a senior human-style healthcare content strategist
and SEO writer for Hima Tech RCM, serving US healthcare providers.

Write a completely original, deeply informative article about:
"${topic.trim()}"

STRICT REQUIREMENTS:

LENGTH:
- Write 700–800 visible words.
- Count headings, paragraphs and FAQs.
- Do not count HTML tags or SEO metadata.

KEYWORDS:
- Generate 3 relevant target keywords.
- Each target keyword or exact keyphrase may appear ONLY ONCE
  in the entire article.
- Do not repeat target keywords in headings, paragraphs,
  FAQs or conclusion.
- Use natural synonyms instead.
- Avoid keyword stuffing.

STRUCTURE:
- Include exactly one H1.
- Use meaningful H2 sections.
- Use H3 subsections where useful.
- Include an introduction, detailed discussion,
  practical conclusion and exactly 3 FAQs.

HUMANIZED WRITING:
- Sound like an experienced healthcare professional.
- Use natural sentence variety and paragraph lengths.
- Avoid robotic wording, generic filler and repetitive transitions.
- Be clear, engaging, thoughtful and practical.

ORIGINALITY:
- Create fresh explanations, examples and analysis.
- Do not copy or closely paraphrase existing articles.
- Do not invent statistics, studies, sources or quotations.
- Do not claim plagiarism has been independently verified.

SOCIAL DISCUSSION INSIGHTS:
- Reflect relevant themes, concerns, questions and opinions
  commonly discussed in public healthcare and professional
  social media conversations.
- Summarize discussion themes in your own words.
- Never include names, usernames or account identities.
- Never invent direct quotations or claim live research
  was conducted when it was not.
- Do not present opinions as established facts.

INFORMATION QUALITY:
- Write for US physicians, clinics, hospitals and practice managers.
- Explain practical challenges and real-world implications.
- Include useful examples and actionable recommendations.
- Avoid unsupported medical, legal or financial claims.

SEO:
- Generate an SEO title, meta description, slug, excerpt
  and 3 target keywords.
- Keep SEO metadata outside the article word count.

HTML:
- Return clean HTML using h1, h2, h3, p, ul, ol, li,
  strong, em and blockquote.
- Include exactly 3 FAQs.
- No scripts, styles, images or event handlers.

FINAL CHECK:
- Verify 700–800 article words.
- Check each target keyword appears exactly once.
- Check heading hierarchy and remove repetition.
- Return valid JSON only, without Markdown fences.

JSON FORMAT:
{
  "title": "Article title",
  "slug": "article-url-slug",
  "excerpt": "Short excerpt",
  "seoTitle": "SEO title",
  "seoDescription": "Meta description",
  "keywords": ["keyword one", "keyword two", "keyword three"],
  "contentHtml": "<h1>Title</h1><p>Article...</p>"
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: prompt }] }
          ],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(502).json({
        error: data.error?.message || "Gemini generation failed."
      });
    }

    const rawText = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

    if (!rawText) {
      return res.status(502).json({
        error: "Gemini returned an empty response."
      });
    }

    const article = JSON.parse(rawText);
    article.contentHtml = cleanHtml(article.contentHtml);

    const wordCount = countWords(article.contentHtml);

    return res.status(200).json({
      success: true,
      article: {
        ...article,
        wordCount
      }
    });

  } catch (error) {
    console.error("Article generation error:", error);

    return res.status(500).json({
      error: "Article generation failed. Please try again."
    });
  }
}
