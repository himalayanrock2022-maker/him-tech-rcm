
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

  const cookie = (req.headers.cookie || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith(COOKIE_NAME + "="));

  if (!cookie) return false;

  const parts = cookie.slice(COOKIE_NAME.length + 1).split(".");
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

async function getPracticeEmail(website) {
  if (!website) return "";

  let base;
  try {
    base = new URL(
      website.startsWith("http") ? website : `https://${website}`
    );
  } catch {
    return "";
  }

  if (!["http:", "https:"].includes(base.protocol)) return "";

  const pages = [
    base.href,
    new URL("/contact", base).href,
    new URL("/contact-us", base).href,
    new URL("/about", base).href
  ];

  for (const page of pages) {
    try {
      const response = await fetch(page, {
        signal: AbortSignal.timeout(7000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HimaTechRCM/1.0)"
        }
      });

      if (!response.ok) continue;

      const html = (await response.text()).slice(0, 500000);

      const mailto = html.match(
        /mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
      );

      const visible = html.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig
      );

      const candidates = [
        ...(mailto ? [mailto[1]] : []),
        ...(visible || [])
      ];

      for (const candidate of candidates) {
        const email = candidate.toLowerCase().trim();

        if (
          validEmail(email) &&
          !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email) &&
          !/(example\.com|email\.com|domain\.com)$/i.test(email)
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

async function getProviders(state, specialty, limit) {
  const url = new URL("https://npiregistry.cms.hhs.gov/api/");
  url.searchParams.set("version", "2.1");
  url.searchParams.set("enumeration_type", "NPI-2");
  url.searchParams.set("state", state);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("skip", "0");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "HimaTechRCM/1.0" }
  });

  if (!response.ok) {
    throw new Error(`NPI Registry returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const results = data.results || [];

  return results.filter(item => {
    const taxonomies = item.taxonomies || [];
    if (!specialty) return true;

    return taxonomies.some(t =>
      String(t.desc || "").toLowerCase().includes(
        specialty.toLowerCase()
      )
    );
  });
}

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
    const body = req.body || {};
    const state = clean(body.state, 2).toUpperCase();
    const specialty = clean(body.specialty, 100);
    const limit = Math.min(
      Math.max(Number(body.limit) || 30, 1),
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

    const providers = await getProviders(state, specialty, 200);

    let candidates = providers.slice(0, 60);
    const discovered = [];

    for (const provider of candidates) {
      if (discovered.length >= limit) break;

      const basic = provider.basic || {};
      const address = (provider.addresses || []).find(
        a => a.address_purpose === "LOCATION"
      ) || (provider.addresses || [])[0] || {};

      const website = "";
      const email = await getPracticeEmail(website);

      if (!email || !validEmail(email)) continue;

      const name =
        basic.organization_name ||
        [basic.first_name, basic.last_name].filter(Boolean).join(" ") ||
        "";

      const npi = clean(provider.number, 10);
      if (!npi) continue;

      discovered.push({
        name: clean(name),
        email: email.toLowerCase(),
        city: clean(address.city),
        state: clean(address.state || state, 2),
        website,
        phone: clean(address.telephone_number, 60),
        npi,
        specialty: clean(
          (provider.taxonomies || []).map(t => t.desc).filter(Boolean)[0] ||
          specialty
        ),
        status: "Needs Review"
      });
    }

    let inserted = [];

    if (discovered.length) {
      inserted = await sql`
        INSERT INTO outreach_leads
          (name, email, city, state, website, phone, npi, specialty, status)
        SELECT
          item.name, item.email, item.city, item.state,
          item.website, item.phone, item.npi, item.specialty, item.status
        FROM jsonb_to_recordset(${JSON.stringify(discovered)}::jsonb) AS item(
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
      checked: providers.length,
      emailsFound: discovered.length,
      added: inserted.length,
      duplicates: discovered.length - inserted.length,
      message: discovered.length
        ? "Email leads saved."
        : "No public email addresses found. No leads were saved."
    });

  } catch (error) {
    console.error("Lead generator error:", error);

    return res.status(500).json({
      success: false,
      message: "Lead generation failed. Check Vercel function logs."
    });
  }
}
