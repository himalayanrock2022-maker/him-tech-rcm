
import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

const COOKIE_NAME = "hima_outreach_session";

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length && timingSafeEqual(first, second);
}

function hasValidSession(req) {
  const secret = process.env.OUTREACH_SESSION_SECRET;
  if (!secret) return false;

  const header = req.headers.cookie || "";
  const item = header.split(";").find(part =>
    part.trim().startsWith(COOKIE_NAME + "=")
  );
  if (!item) return false;

  const parts = item.trim().slice(COOKIE_NAME.length + 1).split(".");
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

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS outreach_leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Ready',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_email_unique
    ON outreach_leads (LOWER(email))
  `;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

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

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);

    if (req.method === "GET") {
      const rows = await sql`
        SELECT id, name, email, city, state, website, specialty, status
        FROM outreach_leads
        ORDER BY created_at DESC
        LIMIT 5000
      `;

      return res.status(200).json({
        success: true,
        leads: rows
      });
    }

    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    if (!Array.isArray(body.leads) || body.leads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No leads were provided."
      });
    }

    if (body.leads.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Import is limited to 500 leads per request."
      });
    }

    const rows = body.leads.map(lead => ({
      name: clean(lead.name),
      email: clean(lead.email, 320).toLowerCase(),
      city: clean(lead.city),
      state: clean(lead.state, 100),
      website: clean(lead.website, 500),
      specialty: clean(lead.specialty),
      status: "Ready"
    })).filter(lead => validEmail(lead.email));

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "No valid email addresses were found."
      });
    }

    const inserted = await sql`
      INSERT INTO outreach_leads
        (name, email, city, state, website, specialty, status)
      SELECT
        item.name, item.email, item.city, item.state,
        item.website, item.specialty, item.status
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS item(
        name text,
        email text,
        city text,
        state text,
        website text,
        specialty text,
        status text
      )
      ON CONFLICT (LOWER(email)) DO NOTHING
      RETURNING id
    `;

    return res.status(200).json({
      success: true,
      added: inserted.length,
      duplicates: rows.length - inserted.length,
      message: "Leads saved to database."
    });

  } catch (error) {
    console.error("Outreach leads API error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process leads. Check the Vercel function logs."
    });
  }
}
