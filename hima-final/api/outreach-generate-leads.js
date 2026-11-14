
import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const maxDuration = 60;

const COOKIE_NAME = "hima_outreach_session";

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function hasValidSession(req) {
  const secret = process.env.OUTREACH_SESSION_SECRET;
  if (!secret) return false;

  const item = (req.headers.cookie || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith(COOKIE_NAME + "="));

  if (!item) return false;

  const parts = item.slice(COOKIE_NAME.length + 1).split(".");
  if (parts.length !== 2) return false;

  const [expires, signature] = parts;

  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;

  const expected = createHmac("sha256", secret)
    .update(expires)
    .digest("hex");

  return safeEqual(signature, expected);
}

function clean(value, max = 250) {
  return String(value || "").trim().slice(0, max);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS outreach_leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT,
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      npi TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Needs Review',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE outreach_leads ALTER COLUMN email DROP NOT NULL`;
  await sql`ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS npi TEXT NOT NULL DEFAULT ''`;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_email_unique
    ON outreach_leads (LOWER(email))
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_npi_unique
    ON outreach_leads (npi) WHERE npi <> ''
  `;
}

// FREE DUCKDUCKGO SEARCH
async function searchClinics(state, specialty) {
  const searches = [
    `${specialty} clinics in ${state} USA official website`,
    `${specialty} medical practice ${state} contact`,
    `independent family medicine primary care doctors ${state}`
  ];

  const results = new Map();

  for (const query of searches) {
    const searchUrl =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query);

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HimaTechRCM/1.0)",
        "Accept": "text/html"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(
        "Free search service returned HTTP " + response.status +
        ". Please try again later."
      );
    }

    const html = await response.text();

    const regex =
      /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while ((match = regex.exec(html)) !== null) {
      let link = match[1];

      try {
        const parsed = new URL(link, "https://html.duckduckgo.com");

        const redirected = parsed.searchParams.get("uddg");
        if (redirected) link = decodeURIComponent(redirected);

        const websiteUrl = new URL(link);

        if (!["http:", "https:"].includes(websiteUrl.protocol)) continue;

        const host = websiteUrl.hostname.toLowerCase();

        const blocked = [
          "facebook.com",
          "instagram.com",
          "linkedin.com",
          "twitter.com",
          "x.com",
          "yelp.com",
          "healthgrades.com",
          "webmd.com",
          "mapquest.com",
          "yellowpages.com",
          "doximity.com",
          "vitals.com",
          "zocdoc.com",
          "duckduckgo.com"
        ];

        if (
          blocked.some(domain =>
            host === domain || host.endsWith("." + domain)
          )
        ) continue;

        const title = decodeHtml(match[2]);

        if (!title || !host.includes(".")) continue;

        if (!results.has(host)) {
          results.set(host, {
            name: clean(title.replace(/\s+/g, " "), 200),
            website: websiteUrl.origin,
            city: "",
            state,
            phone: "",
            specialty
          });
        }
      } catch {
        continue;
      }
    }

    if (results.size >= 20) break;
  }

  return Array.from(results.values()).slice(0, 20);
}

// EXTRACT PUBLIC EMAIL FROM OFFICIAL WEBSITE
async function findPublicEmail(website) {
  let base;

  try {
    base = new URL(
      /^https?:\/\//i.test(website)
        ? website
        : "https://" + website
    );
  } catch {
    return "";
  }

  if (!["http:", "https:"].includes(base.protocol)) return "";

  const paths = [
    "/",
    "/contact",
    "/contact-us",
    "/about",
    "/about-us"
  ];

  for (const path of paths) {
    try {
      const url = new URL(path, base);

      if (url.hostname !== base.hostname) continue;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HimaTechRCM/1.0)"
        }
      });

      if (!response.ok) continue;

      const html = (await response.text()).slice(0, 250000);

      const mailto = html.match(
        /mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
      );

      const visible = html.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig
      );

      const emails = [
        ...(mailto ? [mailto[1]] : []),
        ...(visible || [])
      ];

      for (const raw of emails) {
        const email = raw.split("?")[0].toLowerCase().trim();

        if (
          validEmail(email) &&
          !/(example\.com|email\.com|domain\.com|wixpress\.com)$/i.test(email)
        ) {
          return email;
        }
      }
    } catch {
      continue;
    }
  }

  return "";
}

// MAIN API
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "POST method required."
    });
  }

  if (!hasValidSession(req)) {
    return res.status(401).json({
      success: false,
      message: "Admin login required."
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      success: false,
      message: "Database is not configured."
    });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const state = clean(body.state || "TX", 2).toUpperCase();
    const specialty = clean(body.specialty || "Primary Care", 100);

    const limit = Math.min(
      Math.max(Number(body.limit) || 10, 1),
      30
    );

    if (!["TX", "FL", "TN"].includes(state)) {
      return res.status(400).json({
        success: false,
        message: "Choose TX, FL or TN."
      });
    }

    const sql = neon(process.env.DATABASE_URL);

    await ensureTable(sql);

    const clinics = await searchClinics(state, specialty);

    const discovered = [];
    let websitesChecked = 0;

    for (const clinic of clinics) {
      if (discovered.length >= limit) break;

      websitesChecked++;

      const email = await findPublicEmail(clinic.website);

      if (!email) continue;

      discovered.push({
        name: clinic.name || "Healthcare Practice",
        email,
        city: clinic.city,
        state,
        website: clinic.website,
        phone: clinic.phone,
        npi: "",
        specialty,
        status: "Needs Review"
      });
    }

    let inserted = [];

    if (discovered.length > 0) {
      inserted = await sql`
        INSERT INTO outreach_leads
          (
            name, email, city, state, website,
            phone, npi, specialty, status
          )
        SELECT
          item.name,
          item.email,
          item.city,
          item.state,
          item.website,
          item.phone,
          item.npi,
          item.specialty,
          item.status
        FROM jsonb_to_recordset(
          ${JSON.stringify(discovered)}::jsonb
        ) AS item(
          name text,
          email text,
          city text,
          state text,
          website text,
          phone text,
          npi text,
          specialty text,
          status text
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
    }

    return res.status(200).json({
      success: true,
      searchProvider: "DuckDuckGo",
      clinicsFound: clinics.length,
      websitesChecked,
      publicEmailsFound: discovered.length,
      added: inserted.length,
      duplicates: discovered.length - inserted.length,
      message: discovered.length
        ? "Public business emails found and saved. Please review the leads."
        : "Search completed, but no public clinic emails were verified."
    });

  } catch (error) {
    console.error("Lead generator error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Lead generation failed."
    });
  }
}
