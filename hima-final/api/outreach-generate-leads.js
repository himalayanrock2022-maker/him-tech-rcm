
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

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");

  if (start === -1 || end <= start) return [];

  try {
    const result = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

// GOOGLE SEARCH: FIND REAL CLINICS
async function searchClinics(state, specialty) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error("GEMINI_API_KEY is missing in Vercel.");
  }

  const prompt = `
Find real independent healthcare clinics and medical practices in ${state}, USA.

Specialty: ${specialty || "Family Medicine, Primary Care, Internal Medicine"}.

Use Google Search to discover official practice websites.

Return ONLY a JSON array with these fields:
name, website, city, state, phone, specialty.

Rules:
- Only real healthcare practices.
- Only official clinic websites.
- Do not invent names, websites or contact details.
- Do not return directory websites as clinic websites.
- Do not return email addresses.
- State must be ${state}.
- Return up to 15 relevant practices.
- If uncertain, leave the practice out.
`;

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
      encodeURIComponent(key),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        tools: [
          {
            google_search: {}
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      }),
      signal: AbortSignal.timeout(45000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Google Search error:", data);
    throw new Error(
      data?.error?.message || "Google Search failed."
    );
  }

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .join("\n");

  return extractJsonArray(text).slice(0, 20);
}

// EXTRACT PUBLIC EMAIL FROM OFFICIAL CLINIC WEBSITE
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

  const hostname = base.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    !hostname.includes(".")
  ) {
    return "";
  }

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
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HimaTechRCM/1.0)"
        }
      });

      if (!response.ok) continue;

      const html = (await response.text()).slice(0, 350000);

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
    const specialty = clean(
      body.specialty || "Primary Care",
      100
    );

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

      const website = clean(clinic.website, 300);

      if (!website) continue;

      websitesChecked++;

      const email = await findPublicEmail(website);

      if (!email) continue;

      discovered.push({
        name: clean(clinic.name) || "Healthcare Practice",
        email,
        city: clean(clinic.city),
        state,
        website,
        phone: clean(clinic.phone, 60),
        npi: "",
        specialty: clean(clinic.specialty || specialty),
        status: "Needs Review"
      });
    }

    let inserted = [];

    if (discovered.length > 0) {
      inserted = await sql`
        INSERT INTO outreach_leads
          (
            name,
            email,
            city,
            state,
            website,
            phone,
            npi,
            specialty,
            status
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
