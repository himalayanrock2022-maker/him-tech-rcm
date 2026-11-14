
import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const maxDuration = 60;

const COOKIE_NAME = "hima_outreach_session";
const STATES = ["TX", "FL", "TN"];

const BLOCKED_HOSTS = [
  "facebook.com", "instagram.com", "linkedin.com",
  "x.com", "twitter.com", "yelp.com",
  "healthgrades.com", "webmd.com", "yellowpages.com",
  "doximity.com", "vitals.com", "zocdoc.com"
];

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com",
  "hotmail.com", "aol.com", "icloud.com",
  "live.com", "comcast.net", "att.net"
]);

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

function getWebsite(value) {
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : "https://" + value
    );

    if (!["http:", "https:"].includes(url.protocol)) return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (!host.includes(".")) return null;

    if (BLOCKED_HOSTS.some(
      domain => host === domain || host.endsWith("." + domain)
    )) return null;

    return { url: url.origin, host };
  } catch {
    return null;
  }
}

function extractBusinessEmail(content, host) {
  const text = String(content || "")
    .replace(/\s*\[at\]\s*/ig, "@")
    .replace(/\s*\(at\)\s*/ig, "@")
    .replace(/\s*\[dot\]\s*/ig, ".")
    .replace(/\s*\(dot\)\s*/ig, ".");

  const matches = text.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig
  ) || [];

  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[),.;:]+$/, "");
    const [mailbox, domain] = email.split("@");

    if (!mailbox || !domain) continue;
    if (mailbox.length > 64) continue;

    if (/noreply|no-reply|example|wixpress|sentry|cloudflare/i.test(email)) {
      continue;
    }

    if (FREE_EMAIL_DOMAINS.has(domain)) {
      return email;
    }

    if (domain === host || domain.endsWith("." + host)) {
      return email;
    }
  }

  return "";
}

async function firecrawl(path, body) {
  const response = await fetch(
    "https://api.firecrawl.dev/v2/" + path,
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.FIRECRAWL_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(16000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || data.message ||
      "Firecrawl request failed: HTTP " + response.status
    );
  }

  return data;
}

async function searchClinics(state, specialty) {
  const searches = [
    specialty + " medical practice clinic " + state +
      " official website contact email",
    "family medicine primary care clinic " + state + " contact us",
    "independent primary care physician practice " + state
  ];

  const found = new Map();

  for (const query of searches) {
    const result = await firecrawl("search", {
      query,
      limit: 8,
      sources: ["web"]
    });

    const rows = result.data?.web || result.web || [];

    for (const item of rows) {
      const candidate = getWebsite(item.url || item.link || "");
      if (!candidate) continue;

      if (!found.has(candidate.host)) {
        found.set(candidate.host, {
          name: clean(
            item.title || item.metadata?.title ||
            "Healthcare Practice", 200
          ),
          website: candidate.url,
          host: candidate.host,
          city: "",
          state,
          phone: "",
          specialty
        });
      }
    }

    if (found.size >= 18) break;
  }

  return Array.from(found.values()).slice(0, 18);
}

function candidateContactUrls(homepage, links) {
  const base = new URL(homepage);
  const urls = [];

  for (const link of Array.isArray(links) ? links : []) {
    try {
      const u = new URL(
        typeof link === "string" ? link : link.url,
        homepage
      );

      if (
        u.hostname.replace(/^www\./, "") !==
        base.hostname.replace(/^www\./, "")
      ) continue;

      if (/contact|about|location|office|team|staff|provider|practice/i.test(
        u.pathname + " " + u.search
      )) {
        urls.push(u.origin + u.pathname);
      }
    } catch {}
  }

  for (const path of [
    "/contact",
    "/contact-us",
    "/about",
    "/locations"
  ]) {
    urls.push(base.origin + path);
  }

  return [...new Set(urls)]
    .filter(url => url !== homepage)
    .slice(0, 4);
}

async function scrapeEmail(clinic) {
  const home = await firecrawl("scrape", {
    url: clinic.website,
    formats: ["markdown", "links"]
  });

  const homeData = home.data || home;

  let email = extractBusinessEmail(
    homeData.markdown || "",
    clinic.host
  );

  if (email) return email;

  const urls = candidateContactUrls(
    clinic.website,
    homeData.links || []
  );

  for (const url of urls) {
    try {
      const page = await firecrawl("scrape", {
        url,
        formats: ["markdown"]
      });

      const data = page.data || page;

      email = extractBusinessEmail(
        data.markdown || "",
        clinic.host
      );

      if (email) return email;

    } catch (error) {
      console.error("Contact page failed:", url, error.message);
    }
  }

  return "";
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

  await sql`
    ALTER TABLE outreach_leads ALTER COLUMN email DROP NOT NULL
  `;

  await sql`
    ALTER TABLE outreach_leads
    ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''
  `;

  await sql`
    ALTER TABLE outreach_leads
    ADD COLUMN IF NOT EXISTS npi TEXT NOT NULL DEFAULT ''
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_email_unique
    ON outreach_leads (LOWER(email))
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_leads_npi_unique
    ON outreach_leads (npi) WHERE npi <> ''
  `;
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

  if (!process.env.FIRECRAWL_API_KEY) {
    return res.status(503).json({
      success: false,
      message: "FIRECRAWL_API_KEY is missing. Add it in Vercel."
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
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 10);

    if (!STATES.includes(state)) {
      return res.status(400).json({
        success: false,
        message: "Choose TX, FL or TN."
      });
    }

    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);

    const clinics = await searchClinics(state, specialty);

    const discovered = [];
    const failures = [];

    let checked = 0;
    let next = 0;

    const workers = Array.from({ length: 3 }, async () => {
      while (next < clinics.length && discovered.length < limit) {
        const clinic = clinics[next++];
        checked++;

        try {
          const email = await scrapeEmail(clinic);

          if (email) {
            discovered.push({
              name: clinic.name,
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

        } catch (error) {
          failures.push({
            website: clinic.website,
            error: clean(error.message, 180)
          });

          console.error(
            "Scrape failed:", clinic.website, error.message
          );
        }
      }
    });

    await Promise.all(workers);

    const finalLeads = discovered.slice(0, limit);
    let inserted = [];

    if (finalLeads.length) {
      inserted = await sql`
        INSERT INTO outreach_leads
          (name, email, city, state, website, phone,
           npi, specialty, status)
        SELECT
          item.name, item.email, item.city, item.state,
          item.website, item.phone, item.npi,
          item.specialty, item.status
        FROM jsonb_to_recordset(
          ${JSON.stringify(finalLeads)}::jsonb
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
        RETURNING id, email
      `;
    }

    const savedEmails = new Set(
      inserted.map(item => String(item.email).toLowerCase())
    );

    const leadDiagnostics = finalLeads.map(lead => ({
      name: lead.name,
      email: lead.email,
      website: lead.website,
      status: savedEmails.has(lead.email.toLowerCase())
        ? "SAVED"
        : "DUPLICATE_OR_CONFLICT"
    }));

    return res.status(200).json({
      success: true,
      searchProvider: "Firecrawl",
      state,
      specialty,
      clinicsFound: clinics.length,
      websitesChecked: checked,
      publicBusinessEmailsFound: finalLeads.length,
      added: inserted.length,
      duplicates: finalLeads.length - inserted.length,
      scrapeErrors: failures.length,
      errorSamples: failures.slice(0, 5),
      leadDiagnostics,
      message: finalLeads.length
        ? "Email results processed. See diagnostics."
        : "No public emails found. See scrape diagnostics."
    });

  } catch (error) {
    console.error("Firecrawl lead generator error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Lead generation failed."
    });
  }
}
