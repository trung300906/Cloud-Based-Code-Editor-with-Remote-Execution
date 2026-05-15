"use strict";

const crypto = require("node:crypto");

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { createClient } = require("redis");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

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

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://100.124.23.95:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_USER || "minioadmin",
    secretAccessKey: process.env.MINIO_PASS || "minioadmin",
  },
  forcePathStyle: true,
});

const MINIO_BUCKET = process.env.MINIO_BUCKET || "cloud-ide";

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

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }

    // Check for existing username
    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1 LIMIT 1",
      [username],
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: "username already exists" });
    }

    // Hash and insert
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, password_hash],
    );

    const user = result.rows[0];
    return res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    console.error("[AuthService] /register error:", err.message || err);
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

// ---- Reusable JWT Auth Middleware ----
const authenticateToken = (req, res, next) => {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "missing or invalid authorization header" });
    }
    const token = auth.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid or expired token" });
  }
};

// ---- Helper: convert S3 stream to string ----
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ---- GET /api/sync/file — Fetch file from MinIO ----
app.get("/api/sync/file", authenticateToken, async (req, res) => {
  try {
    const filepath = req.query.filepath;
    if (!filepath) {
      return res.status(400).json({ error: "filepath query parameter required" });
    }

    const key = `${req.user.username}/${filepath}`;
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: MINIO_BUCKET, Key: key }),
      );
      const content = await streamToString(response.Body);
      return res.json({ content });
    } catch (s3Err) {
      if (s3Err.name === "NoSuchKey" || s3Err.$metadata?.httpStatusCode === 404) {
        return res.json({ content: "" });
      }
      throw s3Err;
    }
  } catch (err) {
    console.error("[AuthService] GET /api/sync/file error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  }
});

// =====================================================================
// Phase 1 — OCC Project Sync API
// =====================================================================

// ---- POST /api/project/create — Create a new project ----
app.post("/api/project/create", authenticateToken, async (req, res) => {
  try {
    const { name } = req.body || {};
    const ownerId = Number(req.user.sub);

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "project name required" });
    }

    const result = await pool.query(
      `INSERT INTO projects (owner_id, name)
       VALUES ($1, $2)
       ON CONFLICT (owner_id, name) DO NOTHING
       RETURNING id, name, created_at`,
      [ownerId, name.trim()],
    );

    if (result.rowCount === 0) {
      // Project already exists, fetch it
      const existing = await pool.query(
        `SELECT id, name, created_at FROM projects
         WHERE owner_id = $1 AND name = $2 LIMIT 1`,
        [ownerId, name.trim()],
      );
      return res.status(200).json({
        project: existing.rows[0],
        created: false,
      });
    }

    return res.status(201).json({
      project: result.rows[0],
      created: true,
    });
  } catch (err) {
    console.error("[API] POST /api/project/create error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---- GET /api/project/files — List all files in a project ----
app.get("/api/project/files", authenticateToken, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    if (!projectId || !Number.isFinite(projectId)) {
      return res.status(400).json({ error: "project_id query parameter required" });
    }

    const result = await pool.query(
      `SELECT f.id, f.path, f.version, f.hash, f.last_modified_by, f.last_updated
       FROM files f
       JOIN projects p ON p.id = f.project_id
       WHERE f.project_id = $1 AND p.owner_id = $2
       ORDER BY f.path`,
      [projectId, Number(req.user.sub)],
    );

    return res.json({ files: result.rows });
  } catch (err) {
    console.error("[API] GET /api/project/files error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---- POST /api/project/sync/file — OCC Save with Postgres Transaction ----
// Input:  { project_id, path, content, version }
// Output: 200 { new_version, hash } or 409 { error, current_version }
app.post("/api/project/sync/file", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { project_id, path: filePath, content, version } = req.body || {};
    const userId = Number(req.user.sub);

    // ── Validate input ──
    if (!project_id || !filePath || content === undefined || version === undefined) {
      return res.status(400).json({
        error: "project_id, path, content, and version are required",
      });
    }

    const projectId = Number(project_id);
    const clientVersion = Number(version);

    if (!Number.isFinite(projectId) || !Number.isFinite(clientVersion)) {
      return res.status(400).json({ error: "project_id and version must be numbers" });
    }

    // ── Verify project ownership ──
    const projectCheck = await client.query(
      `SELECT id FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1`,
      [projectId, userId],
    );
    if (projectCheck.rowCount === 0) {
      return res.status(403).json({ error: "project not found or not owned by you" });
    }

    // ── Compute content hash ──
    const contentHash = crypto
      .createHash("md5")
      .update(content, "utf8")
      .digest("hex");

    // ── BEGIN TRANSACTION ──
    await client.query("BEGIN");

    // Step 1: Get current file record (FOR UPDATE = row-level lock)
    const existing = await client.query(
      `SELECT id, version, hash FROM files
       WHERE project_id = $1 AND path = $2
       FOR UPDATE`,
      [projectId, filePath],
    );

    let newVersion;
    const minioKey = `${userId}/${projectId}/${filePath}`;

    if (existing.rowCount === 0) {
      // ── NEW FILE: Insert metadata first, then upload ──
      newVersion = 1;

      // Upload to MinIO
      await s3.send(
        new PutObjectCommand({
          Bucket: MINIO_BUCKET,
          Key: minioKey,
          Body: content,
          ContentType: "text/plain",
        }),
      );

      // Insert into Postgres
      await client.query(
        `INSERT INTO files (project_id, path, version, hash, last_modified_by, last_updated)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [projectId, filePath, newVersion, contentHash, userId],
      );
    } else {
      // ── EXISTING FILE: OCC Check ──
      const dbVersion = existing.rows[0].version;
      const dbHash = existing.rows[0].hash;

      // Step 2: OCC — Version mismatch = CONFLICT
      if (clientVersion < dbVersion) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Conflict",
          current_version: dbVersion,
          current_hash: dbHash,
          message: `Your version (${clientVersion}) is behind server (${dbVersion}). Pull and merge.`,
        });
      }

      // Skip if content unchanged (same hash)
      if (contentHash === dbHash) {
        await client.query("ROLLBACK");
        return res.status(200).json({
          new_version: dbVersion,
          hash: dbHash,
          skipped: true,
          message: "Content unchanged, no update needed.",
        });
      }

      // Step 3a: Upload to MinIO FIRST
      await s3.send(
        new PutObjectCommand({
          Bucket: MINIO_BUCKET,
          Key: minioKey,
          Body: content,
          ContentType: "text/plain",
        }),
      );

      // Step 3b: MinIO succeeded → update Postgres atomically
      newVersion = dbVersion + 1;
      await client.query(
        `UPDATE files
         SET version = $1, hash = $2, last_modified_by = $3, last_updated = NOW()
         WHERE project_id = $4 AND path = $5`,
        [newVersion, contentHash, userId, projectId, filePath],
      );
    }

    // Update project's updated_at timestamp
    await client.query(
      `UPDATE projects SET updated_at = NOW() WHERE id = $1`,
      [projectId],
    );

    // ── COMMIT ──
    await client.query("COMMIT");

    console.log(
      `[API] Sync OK: user=${userId} project=${projectId} path=${filePath} v${newVersion}`,
    );

    return res.status(200).json({
      new_version: newVersion,
      hash: contentHash,
      minio_key: minioKey,
    });
  } catch (err) {
    // MinIO failure or any other error → rollback Postgres
    await client.query("ROLLBACK").catch(() => {});
    console.error("[API] POST /api/project/sync/file error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  } finally {
    client.release();
  }
});

// ---- GET /api/project/file — Pull a specific file (content + metadata) ----
app.get("/api/project/file", authenticateToken, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    const filePath = req.query.path;
    const userId = Number(req.user.sub);

    if (!projectId || !filePath) {
      return res.status(400).json({ error: "project_id and path query params required" });
    }

    // Verify ownership + get metadata
    const meta = await pool.query(
      `SELECT f.id, f.version, f.hash, f.last_modified_by, f.last_updated
       FROM files f
       JOIN projects p ON p.id = f.project_id
       WHERE f.project_id = $1 AND f.path = $2 AND p.owner_id = $3
       LIMIT 1`,
      [projectId, filePath, userId],
    );

    if (meta.rowCount === 0) {
      return res.status(404).json({ error: "file not found" });
    }

    // Fetch content from MinIO
    const minioKey = `${userId}/${projectId}/${filePath}`;
    const s3Response = await s3.send(
      new GetObjectCommand({ Bucket: MINIO_BUCKET, Key: minioKey }),
    );
    const content = await streamToString(s3Response.Body);

    return res.json({
      ...meta.rows[0],
      content,
      path: filePath,
      project_id: projectId,
    });
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: "file content not found in storage" });
    }
    console.error("[API] GET /api/project/file error:", err.message || err);
    return res.status(500).json({ error: "internal error" });
  }
});

// ---- GET /api/project/clone — Kịch bản 2: Pull toàn bộ project (máy mới) ----
// Trả về danh sách tất cả files kèm content, để client tái tạo thư mục local
app.get("/api/project/clone", authenticateToken, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    const userId = Number(req.user.sub);

    if (!projectId || !Number.isFinite(projectId)) {
      return res.status(400).json({ error: "project_id query parameter required" });
    }

    // 1. Verify ownership + get all file metadata from Postgres
    const meta = await pool.query(
      `SELECT f.path, f.version, f.hash
       FROM files f
       JOIN projects p ON p.id = f.project_id
       WHERE f.project_id = $1 AND p.owner_id = $2
       ORDER BY f.path`,
      [projectId, userId],
    );

    if (meta.rowCount === 0) {
      return res.json({ files: [], message: "Project has no files yet." });
    }

    // 2. Pull all file contents from MinIO in parallel
    const filePromises = meta.rows.map(async (row) => {
      const minioKey = `${userId}/${projectId}/${row.path}`;
      try {
        const s3Response = await s3.send(
          new GetObjectCommand({ Bucket: MINIO_BUCKET, Key: minioKey }),
        );
        const content = await streamToString(s3Response.Body);
        return { path: row.path, version: row.version, hash: row.hash, content };
      } catch (err) {
        console.warn(`[API] Clone: failed to pull ${minioKey}:`, err.message);
        return { path: row.path, version: row.version, hash: row.hash, content: null, error: err.message };
      }
    });

    const files = await Promise.all(filePromises);
    return res.json({ project_id: projectId, files });
  } catch (err) {
    console.error("[API] GET /api/project/clone error:", err.message || err);
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
