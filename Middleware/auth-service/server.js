"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { createClient } = require("redis");

const PORT = Number(process.env.AUTH_PORT || 3000);
const JWT_SECRET = process.env.JWT_HMAC_SECRET || "dev-hmac-secret";
const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 3600);

const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "admin",
  password: process.env.PGPASSWORD || "admin",
  database: process.env.PGDATABASE || "cloud_ide",
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
});

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

redisClient.on("error", (err) => {
  console.error("[AuthService] Redis error:", err.message || err);
});

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

function extractToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.body && typeof req.body.token === "string") return req.body.token;
  return "";
}

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }

    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1 LIMIT 1",
      [username],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const sessionKey = `user:session:${user.id}`;
    const token = jwt.sign(
      { sub: String(user.id), username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_TTL_SECONDS },
    );

    const setResult = await redisClient.set(sessionKey, token, {
      NX: true,
      EX: JWT_TTL_SECONDS,
    });

    if (setResult !== "OK") {
      return res.status(409).json({ error: "user already online" });
    }

    return res.status(200).json({ token });
  } catch (err) {
    console.error("[AuthService] /login error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/logout", async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(400).json({ error: "token required" });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: "invalid token" });
    }

    const userId = payload?.sub;
    if (!userId) {
      return res.status(400).json({ error: "invalid token payload" });
    }

    const sessionKey = `user:session:${userId}`;
    await redisClient.del(sessionKey);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[AuthService] /logout error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

async function startAuthService() {
  try {
    await redisClient.connect();
    await pool.query("SELECT 1");
    app.listen(PORT, () => {
      console.log(`[AuthService] Listening on :${PORT}`);
    });
  } catch (err) {
    console.error("[AuthService] Startup failed:", err.message || err);
    process.exitCode = 1;
  }
}

module.exports = { startAuthService };

if (require.main === module) {
  startAuthService();
}
