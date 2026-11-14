
import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

const COOKIE_NAME = "hima_outreach_session";
const STATES = new Set(["TX", "FL", "TN"]);
const SPECIALTIES = new Set([
  "Family Medicine",
  "Internal Medicine",
  "General Practice"
]);

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
    .find(v => v.trim().startsWith(COOKIE_NAME + "="));

  if (!cookie) return false;

  const parts = cookie.trim()
    .slice(COOKIE_NAME.length + 1).split(".");

  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
  if (Number(parts[0]) < Math.floor(Date.now() / 1000)) return false;

  const expected = createHmac("sha256", secret)
    .update(parts[0]).digest("hex");

  return safeEqual(parts[1], expected);
}

function clean(value, max = 250) {
  return String(value || "").trim().slice(0, max);
}

async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS outreach_leads (
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
  )`;

  await sql`ALTER TABLE outreach_leads ALTER COLUMN email DROP NOT NULL`;
  await sql`ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS npi TEXT NOT NULL DEFAULT ''`;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_email_unique
    ON outreach_leads (LOWER(email))`;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_npi_unique
    ON outreach_leads (npi) WHERE npi <> ''`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  if (!hasValidSession(req)) {
    return res.status(401).json({ success: false, message: "Admin login required." });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ success: false, message: "Database is not configured." });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const state = clean(body.state, 2).toUpperCase();
    const specialty = clean(body.specialty, 80);
    const limit = Math.min(30, Math.max(1, Number(body.limit) || 30));

    if (!STATES.has(state) || !SPECIALTIES.has(specialty)) {
      return res.status(400).json({
        success: false,
        message: "Please select a supported state and specialty."
      });
    }

    const params = new URLSearchParams({
      version: "2.1",
      enumeration_type: "NPI-2",
      state,
      taxonomy_description: specialty,
      limit: String(limit)
    });

    const upstream = await fetch(
      "https://npiregistry.cms.hhs.gov/api/?" + params.toString(),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!upstream.ok) {
      throw new Error("CMS provider registry is temporarily unavailable.");
    }

    const payload = await upstream.json();
    const results = Array.isArray(payload.results) ? payload.results : [];

    const records = results.map(item => {
      const basic = item.basic || {};
      const addresses = Array.isArray(item.addresses) ? item.addresses : [];
      const address =
        addresses.find(a => a.address_purpose === "LOCATION") ||
        addresses[0] || {};

      const taxonomies = Array.isArray(item.taxonomies) ? item.taxonomies : [];
      const taxonomy = taxonomies.find(t => t.primary) || taxonomies[0] || {};

      const name = basic.organization_name ||
        [basic.first_name, basic.last_name].filter(Boolean).join(" ");

      return {
        name: clean(name),
        email: "",
        city: clean(address.city, 100),
        state: clean(address.state, 2),
        website: "",
        phone: clean(address.telephone_number, 60),
        npi: clean(item.number, 10),
        specialty: clean(taxonomy.desc || specialty),
        status: "Needs Review"
      };
    }).filter(item => item.name && /^\d{10}$/.test(item.npi));

    if (!records.length) {
      return res.status(200).json({
        success: true,
        added: 0,
        duplicates: 0,
        message: "No matching organizations found. Try another specialty or state."
      });
    }

    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);

    const inserted = await sql`
      INSERT INTO outreach_leads
        (name, email, city, state, website, phone, npi, specialty, status)
      SELECT
        item.name, NULLIF(item.email, ''), item.city, item.state,
        item.website, item.phone, item.npi, item.specialty, item.status
      FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS item(
        name text, email text, city text, state text,
        website text, phone text, npi text, specialty text, status text
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;

    const added = inserted.length;
    const duplicates = records.length - added;

    return res.status(200).json({
      success: true,
      added,
      duplicates,
      message: "Found " + records.length +
        " CMS records. Saved " + added +
        " new leads; skipped " + duplicates +
        " duplicates. Email addresses are not supplied by this registry."
    });

  } catch (error) {
    console.error("Automatic lead generation error:", error);

    return res.status(502).json({
      success: false,
      message: error.message || "Unable to generate leads right now."
    });
  }
}
