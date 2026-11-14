
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const COOKIE_NAME = "hima_outreach_session";
const SESSION_SECONDS = 8 * 60 * 60;

function sign(value, secret) {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex");
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    timingSafeEqual(first, second);
}

function getCookie(req) {
  const header = req.headers.cookie || "";

  const item = header.split(";").find(part =>
    part.trim().startsWith(COOKIE_NAME + "=")
  );

  return item ? item.trim().slice(COOKIE_NAME.length + 1) : "";
}

function validSession(req, secret) {
  const token = getCookie(req);
  const parts = token.split(".");

  if (parts.length !== 2) return false;

  const [expires, signature] = parts;

  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;

  const expected = sign(expires, secret);
  return safeEqual(signature, expected);
}

function setCookie(res, value, maxAge) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const password = process.env.OUTREACH_ADMIN_PASSWORD;
  const secret = process.env.OUTREACH_SESSION_SECRET;

  if (!password || !secret) {
    return res.status(503).json({
      success: false,
      message: "Admin login is not configured."
    });
  }

  if (req.method === "POST") {
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    if (!safeEqual(body.password || "", password)) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password."
      });
    }

    const expires = String(
      Math.floor(Date.now() / 1000) + SESSION_SECONDS
    );

    const token = `${expires}.${sign(expires, secret)}`;

    setCookie(res, token, SESSION_SECONDS);

    return res.status(200).json({
      success: true,
      message: "Login successful."
    });
  }

  if (req.method === "GET") {
    const authenticated = validSession(req, secret);

    return res.status(authenticated ? 200 : 401).json({
      success: authenticated
    });
  }

  if (req.method === "DELETE") {
    setCookie(res, "", 0);

    return res.status(200).json({
      success: true,
      message: "Logged out."
    });
  }

  return res.status(405).json({
    success: false,
    message: "Method not allowed."
  });
}
