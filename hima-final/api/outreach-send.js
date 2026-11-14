import tls from "node:tls";
import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

const DAILY_LIMIT = 30;
const COOKIE_NAME = "hima_outreach_session";
const BUSINESS_ADDRESS =
  "Hima Tech, FC Road, Jutial, Gilgit, 15150, Pakistan";

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
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE_NAME + "="));

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

function clean(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function makeUnsubscribe(email) {
  const secret = process.env.OUTREACH_SESSION_SECRET;
  const encoded = Buffer.from(email.toLowerCase()).toString("base64url");
  const token = createHmac("sha256", secret)
    .update(email.toLowerCase())
    .digest("hex");

  const base = process.env.PUBLIC_SITE_URL ||
    "https://www.himatechrcm.com";

  return `${base}/api/outreach-unsubscribe?e=${encodeURIComponent(encoded)}&t=${token}`;
}

function sendSMTP({ host, port, username, password, from, to, subject, body }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: true
    });

    let buffer = "";
    let lines = [];
    const replies = [];
    const waiters = [];
    let finished = false;

    function fail(error) {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(error);
    }

    function deliver(reply) {
      const waiter = waiters.shift();
      if (waiter) waiter(reply);
      else replies.push(reply);
    }

    function readReply() {
      if (replies.length) return Promise.resolve(replies.shift());
      return new Promise(resolveReply => waiters.push(resolveReply));
    }

    socket.setTimeout(20000, () => fail(new Error("SMTP timeout")));
    socket.on("error", fail);

    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");

      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        lines.push(line);

        if (/^\d{3} /.test(line)) {
          deliver({
            code: Number(line.slice(0, 3)),
            lines
          });
          lines = [];
        }
      }
    });

    async function command(value, expected) {
      socket.write(value + "\r\n");
      const reply = await readReply();

      if (!expected.includes(reply.code)) {
        throw new Error("SMTP rejected command: " + reply.code);
      }

      return reply;
    }

    async function run() {
      try {
        await new Promise((resolve, rejectConnect) => {
          socket.once("secureConnect", resolve);
          socket.once("error", rejectConnect);
        });

        const greeting = await readReply();
        if (greeting.code !== 220) {
          throw new Error("SMTP greeting failed.");
        }

        await command("EHLO himatechrcm.com", [250]);
        await command("AUTH LOGIN", [334]);
        await command(Buffer.from(username).toString("base64"), [334]);
        await command(Buffer.from(password).toString("base64"), [235]);

        await command(`MAIL FROM:<${from}>`, [250]);
        await command(`RCPT TO:<${to}>`, [250, 251]);
        await command("DATA", [354]);

        const encodedSubject =
          "=?UTF-8?B?" +
          Buffer.from(subject, "utf8").toString("base64") +
          "?=";

        const safeBody = body
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map(line => line.startsWith(".") ? "." + line : line)
          .join("\r\n");

        const message = [
          `From: Hima Tech RCM <${from}>`,
          `To: <${to}>`,
          `Reply-To: ${from}`,
          `Subject: ${encodedSubject}`,
          `Date: ${new Date().toUTCString()}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: 8bit",
          "",
          safeBody
        ].join("\r\n");

        socket.write(message + "\r\n.\r\n");

        const result = await readReply();
        if (result.code !== 250) {
          throw new Error("SMTP did not accept the email.");
        }

        socket.write("QUIT\r\n");
        finished = true;
        socket.end();
        resolve();
      } catch (error) {
        fail(error);
      }
    }

    run();
  });
}

async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS outreach_suppressions (
      email TEXT PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT 'unsubscribe',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS outreach_send_logs (
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT,
      email TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Sending',
      error TEXT NOT NULL DEFAULT '',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_send_logs_email_unique
    ON outreach_send_logs (LOWER(email))
    WHERE status IN ('Sending', 'Accepted')
  `;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  if (!hasValidSession(req)) {
    return res.status(401).json({
      success: false,
      message: "Admin login required."
    });
  }

  const {
    SMTP_HOST: host,
    SMTP_USER: username,
    SMTP_PASS: password
  } = process.env;

  const port = Number(process.env.SMTP_PORT || 465);
  const from = process.env.SENDER_EMAIL || "info@himatechrcm.com";

  if (!process.env.DATABASE_URL || !host || !username ||
      !password || port !== 465) {
    return res.status(503).json({
      success: false,
      message: "Database or SMTP settings are incomplete."
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

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(Number).filter(
        id => Number.isSafeInteger(id) && id > 0
      ))].slice(0, DAILY_LIMIT)
    : [];

  const subjectTemplate = clean(body.subject, 250);
  const messageTemplate = clean(body.message, 5000);

  if (!ids.length || !subjectTemplate || !messageTemplate) {
    return res.status(400).json({
      success: false,
      message: "Select leads and enter an email subject and message."
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTables(sql);

    const daily = await sql`
      SELECT COUNT(*)::int AS total
      FROM outreach_send_logs
      WHERE status IN ('Sending', 'Accepted')
        AND sent_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
                     AT TIME ZONE 'UTC'
    `;

    const alreadySentToday = Number(daily[0]?.total || 0);
    const remaining = Math.max(0, DAILY_LIMIT - alreadySentToday);

    if (remaining < 1) {
      return res.status(429).json({
        success: false,
        message: "Daily sending limit of 30 emails has been reached."
      });
    }

    const leads = await sql`
      SELECT id, name, email, city, state, specialty
      FROM outreach_leads
      WHERE id = ANY(${ids}::bigint[])
        AND LOWER(status) = 'ready'
      ORDER BY id
      LIMIT 30
    `;

    if (!leads.length) {
      return res.status(400).json({
        success: false,
        message: "No selected leads are ready to contact."
      });
    }

    const results = [];
    let accepted = 0;

    for (const lead of leads.slice(0, remaining)) {
      const email = clean(lead.email, 320).toLowerCase();

      if (!validEmail(email)) {
        results.push({ email, status: "Skipped", reason: "Invalid email" });
        continue;
      }

      const suppressed = await sql`
        SELECT email FROM outreach_suppressions
        WHERE LOWER(email) = ${email}
        LIMIT 1
      `;

      if (suppressed.length) {
        results.push({ email, status: "Skipped", reason: "Unsubscribed" });
        continue;
      }

      const prior = await sql`
        SELECT id FROM outreach_send_logs
        WHERE LOWER(email) = ${email}
          AND status IN ('Sending', 'Accepted')
        LIMIT 1
      `;

      if (prior.length) {
        results.push({ email, status: "Skipped", reason: "Already sent" });
        continue;
      }

      const personalized = value => value
        .replace(/\{\{\s*name\s*\}\}/gi, lead.name || "Healthcare Provider")
        .replace(/\{\{\s*city\s*\}\}/gi, lead.city || "")
        .replace(/\{\{\s*state\s*\}\}/gi, lead.state || "")
        .replace(/\{\{\s*specialty\s*\}\}/gi, lead.specialty || "");

      const subject = personalized(subjectTemplate);
      const unsubscribe = makeUnsubscribe(email);

      const finalMessage = [
        personalized(messageTemplate),
        "",
        "------------------------------",
        "Hima Tech RCM",
        "https://www.himatechrcm.com",
        BUSINESS_ADDRESS,
        "",
        "If you do not wish to receive further business emails from us, unsubscribe here:",
        unsubscribe
      ].join("\n");

      let logId = null;

      try {
        const inserted = await sql`
          INSERT INTO outreach_send_logs
            (lead_id, email, subject, status)
          VALUES
            (${lead.id}, ${email}, ${subject}, 'Sending')
          ON CONFLICT DO NOTHING
          RETURNING id
        `;

        if (!inserted.length) {
          results.push({ email, status: "Skipped", reason: "Already processed" });
          continue;
        }

        logId = inserted[0].id;

        await sendSMTP({
          host, port, username, password, from,
          to: email,
          subject,
          body: finalMessage
        });

        await sql`
          UPDATE outreach_send_logs
          SET status = 'Accepted', error = ''
          WHERE id = ${logId}
        `;

        await sql`
          UPDATE outreach_leads
          SET status = 'Sent', updated_at = NOW()
          WHERE id = ${lead.id}
        `;

        accepted++;
        results.push({ email, status: "Accepted by SMTP" });

      } catch (error) {
        if (logId) {
          await sql`
            UPDATE outreach_send_logs
            SET status = 'Failed', error = ${clean(error.message, 500)}
            WHERE id = ${logId}
          `;
        }

        results.push({
          email,
          status: "Failed",
          reason: clean(error.message, 250)
        });
      }
    }

    return res.status(200).json({
      success: true,
      accepted,
      attempted: results.length,
      dailyLimit: DAILY_LIMIT,
      dailyUsed: alreadySentToday + accepted,
      dailyRemaining: Math.max(0, DAILY_LIMIT - alreadySentToday - accepted),
      results,
      message: "Accepted means the SMTP server accepted submission; it does not guarantee inbox delivery."
    });

  } catch (error) {
    console.error("Outreach sending error:", error);

    return res.status(500).json({
      success: false,
      message: "Campaign could not be processed. Check Vercel function logs."
    });
  }
}