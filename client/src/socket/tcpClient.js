"use strict";

const net = require("net");
const crypto = require("crypto");
const { SessionManager } = require("./sessionManager.js");
const { TYPE, buildFrame, parseFrame, decodeFramePayload } = require("./protocol.js");
const { signJwt } = require("./cryptoClient.js");

const DEFAULT_GATEWAY_HOST = process.env.GATEWAY_HOST || "100.124.23.95";
const DEFAULT_GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 8080);
const DEFAULT_ROOM_ID = process.env.CLIENT_ROOM_ID || "default";
const DEFAULT_SUB = process.env.CLIENT_SUB || "";

const session = new SessionManager({ storageKey: "cbce.session.socket" });

let buffer = Buffer.alloc(0);
let heartbeatTimer = null;
let pongTimer = null;
let reconnectDelay = 1000;
let isConnected = false;

const client = new net.Socket();

function _getRoomId() {
  return session.getRoomId() || DEFAULT_ROOM_ID;
}

function _getClientId() {
  const fromEnv = DEFAULT_SUB.trim();
  if (fromEnv) return fromEnv;
  return `guest-${crypto.randomBytes(4).toString("hex")}`;
}

function _ensureToken() {
  let token = session.getToken();
  if (token) return token;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: _getClientId(),
    roomId: _getRoomId(),
    iat: now,
    exp: now + 24 * 60 * 60,
  };

  token = signJwt(payload);
  session.setToken(token);
  return token;
}

function _buildAuthPayload(reason) {
  return {
    token: _ensureToken(),
    roomId: _getRoomId(),
    fileState: session.getFileState(),
    reason: reason || "init",
    ts: Date.now(),
  };
}

function connect() {
  client.connect(DEFAULT_GATEWAY_PORT, DEFAULT_GATEWAY_HOST, () => {
    console.log("[TCP Client] 🚀 Kết nối Gateway thành công");
    reconnectDelay = 1000;
    isConnected = true;
    sendAuth("connect");
    startHeartbeat();
  });
}

function send(type, requestId, data, opts = {}) {
  if (!isConnected) return false;
  const encrypt = opts.encrypt ?? type !== TYPE.PING;
  const frame = buildFrame(type, requestId, data, { encrypt });
  return client.write(frame);
}

function sendAuth(reason) {
  return send(TYPE.AUTH, "auth", _buildAuthPayload(reason), { encrypt: true });
}

function setSession(opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, "token")) {
    session.setToken(opts.token);
  }
  if (Object.prototype.hasOwnProperty.call(opts, "roomId")) {
    session.setRoomId(opts.roomId);
  }
  if (Object.prototype.hasOwnProperty.call(opts, "fileState")) {
    session.setFileState(opts.fileState);
  }
  if (isConnected && opts.refreshAuth !== false) sendAuth("update");
}

client.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length >= 5) {
    const len = buffer.readUInt32BE(0);
    if (buffer.length < 5 + len) break;

    const frame = buffer.subarray(0, 5 + len);
    buffer = buffer.subarray(5 + len);

    const parsed = parseFrame(frame);
    if (!parsed) continue;

    if (parsed.type === TYPE.PING) {
      handlePong();
      continue;
    }

    const decoded = decodeFramePayload(parsed.type, parsed.payload, {
      decrypt: parsed.type !== TYPE.PING,
    });
    if (!decoded) continue;

    dispatch(parsed.type, decoded.requestId, decoded.data);
  }
});

function dispatch(type, requestId, data) {
  if (type === TYPE.AUTH) handleAuthAck(requestId, data);
  if (type === TYPE.RESULT) handleResult(requestId, data);
  if (type === TYPE.EDIT) handleEdit(requestId, data);
  if (type === TYPE.CURSOR) handleCursor(requestId, data);
  if (type === TYPE.ERR) handleError(requestId, data);
  if (type === TYPE.LINT) handleLint(requestId, data);
  if (type === TYPE.FS_EVENT) handleFsEvent(data);
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    send(TYPE.PING, "sys", { ping: Date.now() }, { encrypt: false });
    pongTimer = setTimeout(() => {
      console.warn("[TCP Client] ⚠️ Không nhận pong → mất kết nối");
      client.destroy();
    }, 5000);
  }, 15000);
}

function handlePong() {
  clearTimeout(pongTimer);
}

function handleAuthAck(requestId, data) {
  console.log(`[TCP Client] ✅ AUTH OK (${requestId})`, data);
}

let terminalCallback = null;
function setTerminalCallback(cb) {
  terminalCallback = cb;
}

let lintCallback = null;
function setLintCallback(cb) {
  lintCallback = cb;
}

let fsEventCallback = null;
function setFsEventCallback(cb) {
  fsEventCallback = cb;
}

function handleLint(requestId, data) {
  if (lintCallback) lintCallback(data);
}

function handleFsEvent(data) {
  if (fsEventCallback) fsEventCallback(data);
}

function handleResult(requestId, data) {
  if (terminalCallback) terminalCallback(data);
  console.log(`[💻 Code Result - ${requestId}]:`, data);
}

function handleEdit(requestId, data) {
  console.log(`[🔄 OT Diff - ${requestId}]:`, data);
}

function handleCursor(requestId, data) {
  console.log(`[🖱 Cursor - ${requestId}]:`, data);
}

function handleError(requestId, data) {
  console.error(`[❌ Error - ${requestId}]:`, data);
}

client.on("close", () => {
  clearInterval(heartbeatTimer);
  clearTimeout(pongTimer);
  isConnected = false;
  console.log(`[TCP Client] 🔴 Mất kết nối — reconnect sau ${reconnectDelay}ms`);
  setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }, reconnectDelay);
});

client.on("error", (err) => {
  console.error("[TCP Client] 💥 Socket error:", err.message);
});

if (process.env.TCP_AUTO_CONNECT !== "0") {
  connect();
}

module.exports = { send, sendAuth, setSession, connect, TYPE, setTerminalCallback, setLintCallback, setFsEventCallback };