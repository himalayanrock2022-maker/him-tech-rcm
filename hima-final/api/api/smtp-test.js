import tls from "node:tls";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

function readReply(socket, state) {
  if (state.replies.length) {
    return Promise.resolve(state.replies.shift());
  }

  return new Promise((resolve, reject) => {
    state.waiters.push({ resolve, reject });
  });
}

function createReplyReader(socket) {
  const state = {
    buffer: "",
    lines: [],
    replies: [],
    waiters: []
  };

  socket.on("data", chunk => {
    state.buffer += chunk.toString("utf8");

    let index;
    while ((index = state.buffer.indexOf("\r\n")) !== -1) {
      const line = state.buffer.slice(0, index);
      state.buffer = state.buffer.slice(index + 2);

      state.lines.push(line);

      if (/^\d{3} /.test(line)) {
        const reply = state.lines.join("\n");
        state.lines = [];

        const waiter = state.waiters.shift();

        if (waiter) {
          waiter.resolve(reply);
        } else {
          state.replies.push(reply);
        }
      }
    }
  });

  socket.on("error", error => {
    while (state.waiters.length) {
      state.waiters.shift().reject(error);
    }
  });

  return state;
}

async function sendCommand(socket, state, command) {
  const response = readReply(socket, state);
  socket.write(command + "\r\n");
  return response;
}

function replyCode(reply) {
  return Number(reply.slice(0, 3));
}

function checkApiKey(req) {
  const expected = process.env.OUTREACH_API_KEY;
  const supplied = req.headers.authorization || "";

  if (!expected || !supplied.startsWith("Bearer ")) {
    return false;
  }

  const actual = Buffer.from(supplied.slice(7));
  const wanted = Buffer.from(expected);

  return actual.length === wanted.length &&
    timingSafeEqual(actual, wanted);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "POST method required."
    });
  }

  if (!checkApiKey(req)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;

  if (!host || !username || !password || port !== 465) {
    return res.status(500).json({
      success: false,
      message: "SMTP environment variables are missing or invalid."
    });
  }

  let socket;

  try {
    socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: true
    });

    socket.setTimeout(12000, () => {
      socket.destroy(new Error("SMTP connection timed out."));
    });

    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });

    const state = createReplyReader(socket);

    const greeting = await readReply(socket, state);

    if (replyCode(greeting) !== 220) {
      throw new Error("SMTP greeting failed.");
    }

    const ehlo = await sendCommand(
      socket,
      state,
      "EHLO himatechrcm.com"
    );

    if (replyCode(ehlo) !== 250) {
      throw new Error("SMTP handshake failed.");
    }

    const auth = await sendCommand(
      socket,
      state,
      "AUTH LOGIN"
    );

    if (replyCode(auth) !== 334) {
      throw new Error("SMTP authentication method unavailable.");
    }

    const userReply = await sendCommand(
      socket,
      state,
      Buffer.from(username).toString("base64")
    );

    if (replyCode(userReply) !== 334) {
      throw new Error("SMTP username was not accepted.");
    }

    const passReply = await sendCommand(
      socket,
      state,
      Buffer.from(password).toString("base64")
    );

    if (replyCode(passReply) !== 235) {
      throw new Error("SMTP login was rejected.");
    }

    try {
      await sendCommand(socket, state, "QUIT");
    } catch (_) {
      // Login already succeeded.
    }

    return res.status(200).json({
      success: true,
      message: "SMTP connection and mailbox authentication successful.",
      emailSending: false
    });

  } catch (error) {
    console.error("SMTP test failed:", error.message);

    return res.status(502).json({
      success: false,
      message: "SMTP connection or authentication failed. Check your Vercel environment variables."
    });

  } finally {
    if (socket) socket.destroy();
  }
}