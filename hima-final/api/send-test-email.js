
import tls from "node:tls";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

function isAuthorized(req) {
  const expected = process.env.OUTREACH_API_KEY || "";
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!expected || !supplied) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  return a.length === b.length && timingSafeEqual(a, b);
}

function sendTestEmail({ host, port, username, password, from, to }) {
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

    socket.setTimeout(15000, () => fail(new Error("SMTP timeout")));
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
        await new Promise((resolve, reject) => {
          socket.once("secureConnect", resolve);
          socket.once("error", reject);
        });

        const greeting = await readReply();
        if (greeting.code !== 220) {
          throw new Error("SMTP greeting failed");
        }

        await command("EHLO himatechrcm.com", [250]);
        await command("AUTH LOGIN", [334]);
        await command(Buffer.from(username).toString("base64"), [334]);
        await command(Buffer.from(password).toString("base64"), [235]);

        await command("MAIL FROM:<" + from + ">", [250]);
        await command("RCPT TO:<" + to + ">", [250, 251]);
        await command("DATA", [354]);

        const message = [
          "From: Hima Tech RCM <" + from + ">",
          "To: <" + to + ">",
          "Subject: Hima Tech RCM - Email Sending Test",
          "Date: " + new Date().toUTCString(),
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          "Hello,",
          "",
          "This is a test email from Hima Tech RCM.",
          "It verifies that the configured sender can submit email through Spacemail SMTP.",
          "",
          "No marketing campaign has been started.",
          "",
          "Regards,",
          "Hima Tech RCM",
          "https://www.himatechrcm.com"
        ].join("\r\n");

        socket.write(message + "\r\n.\r\n");

        const result = await readReply();
        if (result.code !== 250) {
          throw new Error("SMTP server did not accept the message");
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const from = process.env.SENDER_EMAIL || "info@himatechrcm.com";
  const to = "hifazkaloch56@gmail.com";

  if (!host || !username || !password || port !== 465) {
    return res.status(500).json({
      success: false,
      message: "SMTP environment variables are incomplete."
    });
  }

  try {
    await sendTestEmail({
      host, port, username, password, from, to
    });

    return res.status(200).json({
      success: true,
      message: "Test email accepted by SMTP server.",
      sender: from,
      recipient: to
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error.message || "SMTP sending failed."
    });
  }
}
