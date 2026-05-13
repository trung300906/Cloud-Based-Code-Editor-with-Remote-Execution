"use strict";

const crypto = require("crypto");

const DEFAULT_AES_KEY = "12345678901234567890123456789012"; // 32 bytes
const DEFAULT_HMAC_SECRET = "dev-hmac-secret";

function _loadAesKey() {
  const raw =
    process.env.CLIENT_AES_KEY ||
    process.env.TCP_AES_KEY ||
    process.env.GATEWAY_AES_KEY ||
    "";

  if (!raw) return Buffer.from(DEFAULT_AES_KEY, "utf8");

  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");

  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  } catch (_) {}

  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;

  return Buffer.from(DEFAULT_AES_KEY, "utf8");
}

function _loadHmacSecret() {
  return process.env.JWT_HMAC_SECRET || DEFAULT_HMAC_SECRET;
}

const AES_KEY = _loadAesKey();

function encryptPayload(plainBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptPayload(cipherBuffer) {
  if (!Buffer.isBuffer(cipherBuffer) || cipherBuffer.length < 28) {
    throw new Error("ciphertext too short");
  }

  const iv = cipherBuffer.subarray(0, 12);
  const tag = cipherBuffer.subarray(12, 28);
  const encrypted = cipherBuffer.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function base64UrlEncode(buf) {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function signJwt(payload, secret = _loadHmacSecret()) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const payloadB64 = base64UrlEncode(
    Buffer.from(JSON.stringify(payload), "utf8"),
  );
  const data = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest();
  const sigB64 = base64UrlEncode(signature);
  return `${data}.${sigB64}`;
}

function verifyJwt(token, secret = _loadHmacSecret()) {
  if (typeof token !== "string") return { ok: false, reason: "format" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "format" };

  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest();

  let actual;
  try {
    actual = base64UrlDecode(sigB64);
  } catch (_) {
    return { ok: false, reason: "signature" };
  }

  if (actual.length !== expected.length) return { ok: false, reason: "signature" };
  if (!crypto.timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "signature" };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch (_) {
    return { ok: false, reason: "payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { ok: false, reason: "expired", payload };
  }

  return { ok: true, payload };
}

module.exports = {
  encryptPayload,
  decryptPayload,
  signJwt,
  verifyJwt,
};
