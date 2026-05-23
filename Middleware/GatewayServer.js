"use strict";

const net = require("net");
const { createClient } = require("redis");
const HeartbeatServer = require("./HearthbeatServer.js");
const { decryptPayload, encryptPayload, verifyJwt } = require("./cryptoUtils.js");
const { startAuthService } = require("./auth-service/server.js");

// ─── REDIS CLIENT ──────────────────────────────────────────────
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

redisClient.on("error", (err) => {
  _log("error", `[Gateway] Redis client error: ${err.message || err}`);
});

// ─── LOGGING (giảm spam) ───────────────────────────────────────
// Levels: error < warn < info < debug
const GATEWAY_LOG_LEVEL = (
  process.env.GATEWAY_LOG_LEVEL ||
  process.env.LOG_LEVEL ||
  "info"
).toLowerCase();
const _LV = { error: 0, warn: 1, info: 2, debug: 3 };

function _shouldLog(level) {
  const want = _LV[GATEWAY_LOG_LEVEL] ?? _LV.info;
  const got = _LV[level] ?? _LV.info;
  return got <= want;
}

function _log(level, msg) {
  if (!_shouldLog(level)) return;
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else if (level === "debug" && typeof console.debug === "function")
    console.debug(msg);
  else console.log(msg);
}

function _formatBytes(n) {
  if (!Number.isFinite(n)) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const fixed = i === 0 ? 0 : 1;
  return `${v.toFixed(fixed)}${units[i]}`;
}

// ─── ĐỊNH NGHĨA GIAO THỨC (PROTOCOL TYPES) ─────────────────────
const TYPE = {
  ERR: 0x00,
  AUTH: 0x01,
  EDIT: 0x02,
  RUN: 0x03,
  CURSOR: 0x04,
  CHAT: 0x05,
  RESULT: 0x06,
  INPUT: 0x07,
  LINT: 0x08,
  FS_EVENT: 0x09,
  COLLAB: 0x0a,
  PING: 0xff,
};

const REQUIRE_AUTH = String(process.env.GATEWAY_REQUIRE_AUTH ?? "1") !== "0";
const START_AUTH_SERVICE =
  String(process.env.GATEWAY_START_AUTH ?? "1") !== "0";

// ─── CÔNG CỤ ĐÓNG/MỞ GÓI (FRAME PARSER) ─────────────────────────
function buildFrame(type, requestId, data, opts = {}) {
  const idBuf = Buffer.from(requestId, "utf8");
  const idLenBuf = Buffer.alloc(4);
  idLenBuf.writeUInt32BE(idBuf.length);
  const dataBuf = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data ?? "", "utf8");
  const plainPayload = Buffer.concat([idLenBuf, idBuf, dataBuf]);
  
  const encrypt = opts.encrypt ?? type !== TYPE.PING;
  const payload = encrypt ? encryptPayload(plainPayload) : plainPayload;

  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 0);
  header[4] = type;
  return Buffer.concat([header, payload]);
}

function parsePayload(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 4) return null;
  const idLen = payload.readUInt32BE(0);
  if (payload.length < 4 + idLen) return null;
  const requestId = payload.subarray(4, 4 + idLen).toString("utf8");
  const bodyBuf = payload.subarray(4 + idLen);
  const bodyText = bodyBuf.toString("utf8");
  return { requestId, bodyBuf, bodyText };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

class FrameParser {
  constructor(onFrame, onError) {
    this._onFrame = onFrame;
    this._onError = onError;
    this._buf = Buffer.alloc(0);
  }
  feed(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (this._buf.length >= 5) {
      const payloadLen = this._buf.readUInt32BE(0);
      if (payloadLen > 100 * 1024 * 1024) {
        // Max 100MB payload
        this._onError(new Error("Payload quá lớn!"));
        return;
      }
      const frameLen = 5 + payloadLen;
      if (this._buf.length < frameLen) break;

      const type = this._buf[4];
      const payload = this._buf.subarray(5, frameLen);
      const rawFrame = this._buf.subarray(0, frameLen); // Giữ nguyên frame gốc để forward
      this._buf = this._buf.subarray(frameLen);

      this._onFrame(type, payload, rawFrame);
    }
  }
}

// ─── THUẬT TOÁN TOKEN BUCKET (CHỐNG SPAM / RATE LIMIT) ──────────
class RateLimiter {
  constructor(capacity, refillRate) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate; // tokens per second
    this.lastRefill = Date.now();
  }
  consume() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSec * this.refillRate,
    );
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true; // Hợp lệ
    }
    return false; // Quá giới hạn (Bị chặn)
  }
}

// ─── GATEWAY SERVER CHÍNH ───────────────────────────────────────
class GatewayServer {
  constructor(port = 8080) {
    this.gatewayPort = port;
    this.heartbeat = new HeartbeatServer({ port: 4000 });
    this.activeClients = new Map(); // clientId -> socket
    this.activeRuns = new Map(); // requestId -> workerSocket
    this.server = net.createServer(this._handleConnection.bind(this));
    this.healthTickMs = Number(process.env.GATEWAY_HEALTH_TICK_MS || 5000);
    this._healthTimer = null;
    this._healthWasBad = false;
  }

  async start() {
    this.heartbeat.start();

    // Kết nối Redis; nếu lỗi thì log nhưng không crash Gateway
    try {
      await redisClient.connect();
      _log("info", "[Gateway] Redis connected");

      // Subscribe to FS events
      const subClient = redisClient.duplicate();
      await subClient.connect();
      await subClient.subscribe("project_fs_events", (message) => {
        try {
          const event = JSON.parse(message);
          // Broadcast to all clients in the same project (roomId)
          for (const [clientId, info] of this.activeClients.entries()) {
            if (info.session && String(info.session.roomId) === String(event.projectId)) {
              if (info.socket && !info.socket.destroyed) {
                info.socket.write(buildFrame(TYPE.FS_EVENT, "gateway", message));
              }
            }
          }
        } catch (e) {
          _log("warn", `[Gateway] FS Event error: ${e.message}`);
        }
      });
      _log("info", "[Gateway] Subscribed to project_fs_events");
    } catch (err) {
      _log("error", `[Gateway] Redis connection failed: ${err.message || err}`);
    }

    this._startHealthMonitor();

    const server = net.createServer((clientSocket) => {
      this._handleConnection(clientSocket);
    });

    server.listen(this.gatewayPort, "0.0.0.0", () => {
      _log(
        "info",
        `[Gateway] 🚀 Main TCP Gateway đang mở tại 0.0.0.0:${this.gatewayPort}`,
      );
    });
  }

  _startHealthMonitor() {
    const ms = this.healthTickMs;
    if (!Number.isFinite(ms) || ms < 1000) return;
    if (this._healthTimer) return;

    this._healthTimer = setInterval(() => this._healthTick(), ms);
    if (typeof this._healthTimer.unref === "function")
      this._healthTimer.unref();
  }

  _healthTick() {
    let snap = [];
    try {
      snap = this.heartbeat.snapshot();
    } catch (err) {
      _log(
        "warn",
        `[Health] ⚠️ Không lấy được snapshot: ${err.message || err}`,
      );
      return;
    }

    const pruneMs = Number(this.heartbeat.pruneTimeoutMs || 5000);

    const workers = snap
      .map((w) => {
        const ageSecNum = Number(w.ageSec);
        const ageMs = Number.isFinite(ageSecNum) ? ageSecNum * 1000 : Infinity;
        return {
          ...w,
          _ageSecNum: ageSecNum,
          _isAlive: ageMs <= pruneMs,
        };
      })
      .sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)));

    const alive = workers.filter((w) => w._isAlive);
    const aliveCount = alive.length;
    const totalCount = workers.length;

    let idleSum = 0;
    let busySum = 0;
    let minRam = Infinity;
    for (const w of alive) {
      idleSum += Number(w.idleSlots || 0);
      busySum += Number(w.busySlots || 0);
      const ram = Number(w.ramFreeBytes);
      if (Number.isFinite(ram)) minRam = Math.min(minRam, ram);
    }
    if (!Number.isFinite(minRam)) minRam = NaN;

    const clients = this.activeClients.size;
    const bad = aliveCount === 0 || idleSum <= 0;

    // 3 kiểu output health:
    // - summary: 1 dòng tổng
    // - full: 1 dòng tổng + lần lượt từng worker (nhiều dòng)
    // - compact: 1 dòng tổng + list worker ngắn gọn trên cùng 1 dòng
    const rawMode = String(
      process.env.GATEWAY_HEALTH_MODE || "compact",
    ).toLowerCase();
    const mode =
      rawMode === "sum"
        ? "summary"
        : rawMode === "details" || rawMode === "workers"
          ? "full"
          : rawMode === "short"
            ? "compact"
            : rawMode;

    const level = bad ? "warn" : "info";
    const tag = bad ? "🛑" : this._healthWasBad ? "✅ RECOVERED" : "✅";
    const summaryLine = `[Health] ${tag} workers=${aliveCount}/${totalCount} idle=${idleSum} busy=${busySum} minRam=${_formatBytes(minRam)} clients=${clients}`;

    // Update state after computing tag (tag needs previous state)
    this._healthWasBad = bad;

    if (mode === "summary") {
      _log(level, summaryLine);
      return;
    }

    if (mode === "compact") {
      const parts = [];
      let idx = 0;
      for (const w of workers) {
        idx += 1;
        const cpu = Number(w.cpu);
        const cpuTxt = Number.isFinite(cpu) ? cpu.toFixed(1) : "?";
        const idle = Number.isFinite(Number(w.idleSlots))
          ? Number(w.idleSlots)
          : 0;
        const total = Number.isFinite(Number(w.totalSlots))
          ? Number(w.totalSlots)
          : idle;
        const ramTxt = _formatBytes(Number(w.ramFreeBytes));
        const ageTxt = Number.isFinite(w._ageSecNum)
          ? w._ageSecNum.toFixed(1) + "s"
          : String(w.ageSec ?? "?");
        const aliveMark = w._isAlive ? "" : "(stale)";
        parts.push(
          `w${idx}=${w.nodeId}${aliveMark} cpu=${cpuTxt} idle=${idle}/${total} ram=${ramTxt} age=${ageTxt}`,
        );
      }

      const line =
        parts.length > 0
          ? `${summaryLine} :: ${parts.join(" | ")}`
          : summaryLine;
      _log(level, line);
      return;
    }

    // full
    _log(level, summaryLine);
    if (workers.length === 0) return;
    let i = 0;
    for (const w of workers) {
      i += 1;
      const cpu = Number(w.cpu);
      const cpuTxt = Number.isFinite(cpu) ? cpu.toFixed(2) : "?";
      const idle = Number.isFinite(Number(w.idleSlots))
        ? Number(w.idleSlots)
        : 0;
      const busy = Number.isFinite(Number(w.busySlots))
        ? Number(w.busySlots)
        : 0;
      const total = Number.isFinite(Number(w.totalSlots))
        ? Number(w.totalSlots)
        : idle;
      const ramTxt = _formatBytes(Number(w.ramFreeBytes));
      const ageTxt = Number.isFinite(w._ageSecNum)
        ? w._ageSecNum.toFixed(1) + "s"
        : String(w.ageSec ?? "?");
      const portTxt = w.workerPort ?? "";
      const aliveTxt = w._isAlive ? "alive" : "stale";
      _log(
        level,
        `[Worker] ${i}/${workers.length} ${w.nodeId} ${aliveTxt} cpu=${cpuTxt} idle=${idle} busy=${busy} total=${total} ramFree=${ramTxt} age=${ageTxt} port=${portTxt}`,
      );
    }
  }

  _handleConnection(clientSocket) {
    const clientId = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    const session = { authed: false, token: "", roomId: "", fileState: {} };
    
    this.activeClients.set(clientId, { socket: clientSocket, session, connectedAt: Date.now() });
    _log(
      "debug",
      `[Gateway] 🙋 Client kết nối: ${clientId} (clients=${this.activeClients.size})`,
    );

    // Mỗi IP có 1 rổ Token (Chứa tối đa 50 requests, hồi 10 req/s)
    const limiter = new RateLimiter(50, 10);
    let workerSocket = null; // Socket nối xuống Trạm cày (nếu gọi lệnh RUN)

    // Throttle spam logs: tối đa 1 warn / 5s / client
    let lastSpamLogAt = 0;

    const parser = new FrameParser(
      (type, payload, rawFrame) => {
        // 2. PING luôn cho phép (không mã hóa, không tính rate limit)
        if (type === TYPE.PING) {
          clientSocket.write(buildFrame(TYPE.PING, "sys", '{"pong": "ok"}'));
          return;
        }

        // COLLAB bypass rate limit — awareness + CRDT updates fire hàng chục lần/giây
        // khi người dùng đang gõ hoặc di chuột, đây là hành vi hợp lệ.
        // Rate limit chỉ áp dụng cho các gói tin thông thường (AUTH, RUN, EDIT, ...).
        if (type !== TYPE.COLLAB) {
          // 1. Kiểm tra Rate Limit (chỉ cho non-COLLAB)
          if (!limiter.consume()) {
            const now = Date.now();
            if (now - lastSpamLogAt >= 5000) {
              lastSpamLogAt = now;
              _log("warn", `[Gateway] 🛑 SPAM BLOCK: ${clientId}`);
            }
            clientSocket.write(
              buildFrame(TYPE.ERR, "gateway", "Rate limit exceeded"),
            );
            return;
          }
        }

        // 3. Giải mã AES-256-GCM
        let plainPayload;
        if (type === TYPE.COLLAB) {
          plainPayload = payload;
        } else {
          try {
            plainPayload = decryptPayload(payload);
          } catch (err) {
            _log("warn", `[Gateway] Decrypt failed: ${err.message}`);
            clientSocket.write(buildFrame(TYPE.ERR, "gateway", "Decrypt failed"));
            clientSocket.destroy();
            return;
          }
        }

        const parsed = parsePayload(plainPayload);
        if (!parsed) {
          clientSocket.write(buildFrame(TYPE.ERR, "gateway", "Bad payload"));
          return;
        }

        const { requestId, bodyBuf, bodyText } = parsed;

        // 4. AUTH — xử lý bất đồng bộ với Redis để tránh unhandled rejection
        if (type === TYPE.AUTH) {
          (async () => {
            try {
              const authData = safeJsonParse(bodyText);
              const token = authData?.token;
              if (!token) {
                if (!clientSocket.destroyed) {
                  clientSocket.write(
                    buildFrame(TYPE.ERR, requestId || "auth", "Missing token"),
                  );
                  clientSocket.destroy();
                }
                return;
              }

              // b. Verify JWT signature locally
              const check = verifyJwt(token);
              if (!check.ok) {
                if (!clientSocket.destroyed) {
                  clientSocket.write(
                    buildFrame(
                      TYPE.ERR,
                      requestId || "auth",
                      `Auth failed: ${check.reason}`,
                    ),
                  );
                  clientSocket.destroy();
                }
                return;
              }

              // c. Extract userId from decoded payload
              const userId = check.payload?.sub;
              if (!userId) {
                if (!clientSocket.destroyed) {
                  clientSocket.write(
                    buildFrame(
                      TYPE.ERR,
                      requestId || "auth",
                      "Invalid token payload",
                    ),
                  );
                  clientSocket.destroy();
                }
                return;
              }

              // d. Query Redis global session
              let storedToken;
              try {
                storedToken = await redisClient.get(`user:session:${userId}`);
              } catch (redisErr) {
                _log(
                  "error",
                  `[Gateway] Redis session lookup failed for user ${userId}: ${redisErr.message}`,
                );
                if (!clientSocket.destroyed) {
                  clientSocket.write(
                    buildFrame(
                      TYPE.ERR,
                      requestId || "auth",
                      "Session verification unavailable",
                    ),
                  );
                  clientSocket.destroy();
                }
                return;
              }

              // e. Security check: session revoked or token mismatch
              if (!storedToken || storedToken !== token) {
                if (!clientSocket.destroyed) {
                  clientSocket.write(
                    buildFrame(
                      TYPE.ERR,
                      requestId || "auth",
                      "Session revoked or invalid",
                    ),
                  );
                  clientSocket.destroy();
                }
                return;
              }

              // f. Accept connection
              session.authed = true;
              session.token = token;
              session.roomId =
                typeof authData?.roomId === "string" ? authData.roomId : "";
              session.fileState =
                authData?.fileState && typeof authData.fileState === "object"
                  ? authData.fileState
                  : {};

              clientSocket.isAuthenticated = true;
              clientSocket.userId = userId;

              const ack = {
                ok: true,
                roomId: session.roomId,
                sub: userId,
              };
              if (!clientSocket.destroyed) {
                clientSocket.write(
                  buildFrame(
                    TYPE.AUTH,
                    requestId || "auth",
                    JSON.stringify(ack),
                  ),
                );
              }

              // Thông báo số lượng thành viên trong room cho tất cả clients
              if (session.roomId) {
                this._broadcastRoomMemberCount(session.roomId);
              }
            } catch (err) {
              _log(
                "error",
                `[Gateway] AUTH handler error: ${err.message || err}`,
              );
              if (!clientSocket.destroyed) {
                clientSocket.write(
                  buildFrame(
                    TYPE.ERR,
                    requestId || "auth",
                    "Internal auth error",
                  ),
                );
                clientSocket.destroy();
              }
            }
          })();
          return;
        }

        if (REQUIRE_AUTH && !session.authed) {
          clientSocket.write(
            buildFrame(TYPE.ERR, requestId || "gateway", "Unauthorized"),
          );
          return;
        }

        const plainFrame = buildFrame(type, requestId, bodyBuf);

        // 5. ROUTER BẺ LÁI GÓI TIN
        switch (type) {
          case TYPE.RUN:
          case TYPE.LINT:
            this._routeToWorkerCluster(
              clientSocket,
              plainFrame,
              plainPayload,
              (sock) => (workerSocket = sock),
              type
            ).catch(console.error);
            break;
          case TYPE.INPUT:
            this._routeInputToWorker(plainPayload);
            break;
          case TYPE.COLLAB:
            // Relay raw collab frames to other clients in the same room
            if (session.roomId) {
              for (const [otherClientId, info] of this.activeClients.entries()) {
                if (otherClientId !== clientId && String(info.session.roomId) === String(session.roomId)) {
                  if (info.socket && !info.socket.destroyed) {
                    info.socket.write(rawFrame); // Relay exactly as is
                  }
                }
              }
            }
            break;
          case TYPE.EDIT:
          case TYPE.CURSOR:
          case TYPE.CHAT:
            // TODO: Tương lai sẽ bẻ lái sang Collab Server
            _log("debug", `[Router] OT Sync (chưa implement)`);
            break;
          default:
            _log("debug", `[Router] Gói tin không xác định: ${type}`);
        }
      },
      (err) => {
        _log("warn", `[Gateway] Lỗi Frame từ ${clientId}: ${err.message}`);
        clientSocket.destroy();
      },
    );

    clientSocket.on("data", (chunk) => parser.feed(chunk));

    clientSocket.on("error", (err) =>
      _log("warn", `[Gateway] Lỗi kết nối ${clientId}: ${err.message}`),
    );

    clientSocket.on("close", () => {
      const disconnectedRoomId = session.roomId;
      this.activeClients.delete(clientId);
      _log(
        "debug",
        `[Gateway] 👋 Client ngắt kết nối: ${clientId} (clients=${this.activeClients.size})`,
      );
      if (workerSocket && !workerSocket.destroyed) workerSocket.destroy();

      // Thông báo cho các client còn lại trong room
      if (disconnectedRoomId) {
        this._broadcastRoomMemberCount(disconnectedRoomId);
      }
    });
  }

  // ─── ROOM MEMBER COUNT NOTIFICATION ────────────────────────────
  // Gửi cho mỗi client trong room biết có bao nhiêu người KHÁC đang ở cùng.
  // Dùng COLLAB frame với sub-type 4 (ROOM_EVENT), payload = [4, count].
  // Client dùng thông tin này để bật/tắt cờ isInCollabRoom.
  _broadcastRoomMemberCount(roomId) {
    if (!roomId) return;

    const members = [];
    for (const [cid, info] of this.activeClients.entries()) {
      if (info.session && info.session.authed && String(info.session.roomId) === String(roomId)) {
        members.push(info.socket);
      }
    }

    const totalInRoom = members.length;
    for (const sock of members) {
      if (!sock || sock.destroyed) continue;
      const otherCount = totalInRoom - 1; // Số người KHÁC (không tính chính mình)
      const roomEventData = Buffer.alloc(2);
      roomEventData[0] = 4; // Sub-type: ROOM_EVENT
      roomEventData[1] = otherCount;
      const frame = buildFrame(TYPE.COLLAB, "room", roomEventData, { encrypt: false });
      sock.write(frame);
    }
    _log("info", `[Gateway] Room ${roomId}: ${totalInRoom} member(s), broadcast sent`);
  }

  // ─── ĐIỀU PHỐI XUỐNG WORKER CLUSTER ─────────────────────────
  async _routeToWorkerCluster(clientSocket, rawFrame, payload, saveWorkerSocket, type) {
    // Lấy requestId để route + log
    if (!Buffer.isBuffer(payload) || payload.length < 4) {
      _log("warn", "[Router] Payload RUN không hợp lệ (quá ngắn)");
      return;
    }
    const idLen = payload.readUInt32BE(0);
    if (payload.length < 4 + idLen) {
      _log("warn", `[Router] Payload RUN không hợp lệ (idLen=${idLen})`);
      return;
    }
    const requestId = payload.subarray(4, 4 + idLen).toString("utf8");

    // Lấy thông tin owner_id (Mapping) từ Redis
    let ownerId = clientSocket.userId;
    try {
      const redisClient = require('redis').createClient({ url: process.env.REDIS_URL || "redis://127.0.0.1:6379" });
      await redisClient.connect();
      const mapped = await redisClient.get(`user:room_mapping:${clientSocket.userId}`);
      if (mapped) ownerId = Number(mapped);
      await redisClient.disconnect();
    } catch (e) {}

    // Bóc tách JSON cũ, nhét thêm owner_id vào
    let finalFrame = rawFrame;
    try {
       const dataBuf = payload.subarray(4 + idLen);
       const dataJson = JSON.parse(dataBuf.toString('utf8'));
       dataJson.ownerId = ownerId;
       dataJson.clientId = clientSocket.userId;
       
       // Đóng gói lại (Re-pack) - không mã hóa vì Worker đọc plain text
       finalFrame = buildFrame(type, requestId, JSON.stringify(dataJson), { encrypt: false });
    } catch(err) {
       _log("error", `[Router] Failed to inject owner_id into payload: ${err.message}`);
    }

    // Hỏi Sổ Nam Tào xem ai đang rảnh nhất
    const bestWorker = this.heartbeat.getBestWorker();

    if (!bestWorker) {
      _log("warn", `[Router] ⚠️ Không có worker rảnh — từ chối ${requestId}`);
      clientSocket.write(
        buildFrame(TYPE.ERR, requestId, "Hệ thống đang bận, vui lòng thử lại."),
      );
      return;
    }

    _log(
      "debug",
      `[Router] 👉 Job [${requestId}] → ${bestWorker.nodeId} (${bestWorker.host}:${bestWorker.port})`,
    );

    // Mở kết nối TCP tốc độ cao xuống Worker
    const workerSocket = new net.Socket();
    saveWorkerSocket(workerSocket); // Lưu lại để dọn dẹp khi Client ngắt ngang

    workerSocket.connect(bestWorker.port, bestWorker.host, () => {
      // Forward frame (đã nhét owner_id) xuống cho Worker xử lý
      workerSocket.write(finalFrame);
    });

    // Hứng Stream kết quả từ Worker, mã hóa lại rồi mới gửi về Client
    const workerParser = new FrameParser(
      (workerType, workerPayload) => {
        const encrypt = workerType !== TYPE.PING;
        const finalPayload = encrypt ? encryptPayload(workerPayload) : workerPayload;
        
        const header = Buffer.alloc(5);
        header.writeUInt32BE(finalPayload.length, 0);
        header[4] = workerType;
        const encryptedFrame = Buffer.concat([header, finalPayload]);
        
        if (!clientSocket.destroyed) clientSocket.write(encryptedFrame);
      },
      (err) => {
        _log("error", `[Router] Lỗi parse frame từ Worker: ${err.message}`);
      }
    );

    workerSocket.on("data", (chunk) => {
      workerParser.feed(chunk);
    });

    workerSocket.on("error", (err) => {
      _log(
        "error",
        `[Router] Lỗi nối xuống Worker (${bestWorker.nodeId}): ${err.message}`,
      );
      this.activeRuns.delete(requestId);
      if (!clientSocket.destroyed)
        clientSocket.write(
          buildFrame(TYPE.ERR, requestId, "Lỗi Server Nội Bộ"),
        );
    });

    workerSocket.on("close", () => {
      this.activeRuns.delete(requestId);
    });
    
    // Store in activeRuns map
    this.activeRuns.set(requestId, workerSocket);
  }

  // ─── ROUTE INPUT TỚI ĐÚNG WORKER ĐANG CHẠY ──────────────────────
  _routeInputToWorker(payload) {
    if (!Buffer.isBuffer(payload) || payload.length < 4) return;
    const idLen = payload.readUInt32BE(0);
    if (payload.length < 4 + idLen) return;
    const requestId = payload.subarray(4, 4 + idLen).toString("utf8");
    const inputBuf = payload.subarray(4 + idLen);

    console.log(`[Gateway] Nhận INPUT cho ${requestId}: ${JSON.stringify(inputBuf.toString('utf8'))}`);

    const workerSocket = this.activeRuns.get(requestId);
    if (workerSocket && !workerSocket.destroyed) {
      // Build plain frame since worker reads plain text
      const frame = buildFrame(TYPE.INPUT, requestId, inputBuf, { encrypt: false });
      workerSocket.write(frame);
    } else {
      _log("warn", `[Router] Nhận INPUT cho job đã tắt hoặc không tồn tại: ${requestId}`);
    }
  }
}

// CHẠY CHƯƠNG TRÌNH
if (require.main === module) {
  (async () => {
    if (START_AUTH_SERVICE) {
      startAuthService().catch((err) => {
        console.error("[Gateway] Auth service failed:", err?.message || err);
      });
    }
    const gateway = new GatewayServer(8080);
    await gateway.start();
  })();
}
