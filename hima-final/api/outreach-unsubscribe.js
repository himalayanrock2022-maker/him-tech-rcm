import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method not allowed.");
  }

  const encoded = String(req.query?.e || "");
  const token = String(req.query?.t || "");
  const secret = process.env.OUTREACH_SESSION_SECRET;

  if (!secret || !encoded || !token) {
    return res.status(400).send("Invalid unsubscribe link.");
  }

  let email = "";

  try {
    email = Buffer.from(encoded, "base64url")
      .toString("utf8")
      .trim()
      .toLowerCase();
  } catch {
    return res.status(400).send("Invalid unsubscribe link.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).send("Invalid email address.");
  }

  const expected = createHmac("sha256", secret)
    .update(email)
    .digest("hex");

  if (!safeEqual(token, expected)) {
    return res.status(403).send("Unsubscribe link could not be verified.");
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).send("Unsubscribe service is temporarily unavailable.");
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    await sql`
      CREATE TABLE IF NOT EXISTS outreach_suppressions (
        email TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT 'unsubscribe',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      INSERT INTO outreach_suppressions (email, reason)
      VALUES (${email}, 'unsubscribe')
      ON CONFLICT (email) DO NOTHING
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(`
      <!doctype html>
      <html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Unsubscribed</title></head>
      <body style="font-family:Arial,sans-serif;padding:40px;max-width:600px;margin:auto">
        <h2>You have been unsubscribed.</h2>
        <p>This email address will be excluded from future Hima Tech RCM outreach emails.</p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Unsubscribe error:", error);
    return res.status(500).send("Unable to process unsubscribe right now.");
  }
}