'use strict';

const net = require('net');
const HeartbeatServer = require('./HearthbeatServer.js');

// ─── LOGGING (giảm spam) ───────────────────────────────────────
// Levels: error < warn < info < debug
const GATEWAY_LOG_LEVEL = (process.env.GATEWAY_LOG_LEVEL || process.env.LOG_LEVEL || 'info').toLowerCase();
const _LV = { error: 0, warn: 1, info: 2, debug: 3 };

function _shouldLog(level) {
    const want = _LV[GATEWAY_LOG_LEVEL] ?? _LV.info;
    const got = _LV[level] ?? _LV.info;
    return got <= want;
}

function _log(level, msg) {
    if (!_shouldLog(level)) return;
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else if (level === 'debug' && typeof console.debug === 'function') console.debug(msg);
    else console.log(msg);
}

function _formatBytes(n) {
    if (!Number.isFinite(n)) return '?';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
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
    AUTH: 0x01,     // Đăng nhập / Đăng ký
    EDIT: 0x02,     // Gõ code (Gửi sang Collab)
    RUN: 0x03,      // Chạy code (Gửi sang Worker)
    CURSOR: 0x04,   // Vị trí chuột
    CHAT: 0x05,     // Chat
    RESULT: 0x06,   // Kết quả từ Worker trả về
    ERROR: 0x00     // Lỗi hệ thống / Rate Limit
};

// ─── CÔNG CỤ ĐÓNG/MỞ GÓI (FRAME PARSER) ─────────────────────────
function buildFrame(type, requestId, data) {
    const idBuf = Buffer.from(requestId, 'utf8');
    const idLenBuf = Buffer.alloc(4);
    idLenBuf.writeUInt32BE(idBuf.length);
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '', 'utf8');
    const payload = Buffer.concat([idLenBuf, idBuf, dataBuf]);
    const header = Buffer.alloc(5);
    header.writeUInt32BE(payload.length, 0);
    header[4] = type;
    return Buffer.concat([header, payload]);
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
            if (payloadLen > 10 * 1024 * 1024) { // Max 10MB payload
                this._onError(new Error('Payload quá lớn!')); return;
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
        this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRate);
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
        this.activeClients = new Map(); // Quản lý kết nối

        this.healthTickMs = Number(process.env.GATEWAY_HEALTH_TICK_MS || 5000);
        this._healthTimer = null;
        this._healthWasBad = false;
    }

    start() {
        this.heartbeat.start();

        this._startHealthMonitor();

        const server = net.createServer((clientSocket) => {
            this._handleConnection(clientSocket);
        });

        server.listen(this.gatewayPort, '0.0.0.0', () => {
            _log('info', `[Gateway] 🚀 Main TCP Gateway đang mở tại 0.0.0.0:${this.gatewayPort}`);
        });
    }

    _startHealthMonitor() {
        const ms = this.healthTickMs;
        if (!Number.isFinite(ms) || ms < 1000) return;
        if (this._healthTimer) return;

        this._healthTimer = setInterval(() => this._healthTick(), ms);
        if (typeof this._healthTimer.unref === 'function') this._healthTimer.unref();
    }

    _healthTick() {
        let snap = [];
        try {
            snap = this.heartbeat.snapshot();
        } catch (err) {
            _log('warn', `[Health] ⚠️ Không lấy được snapshot: ${err.message || err}`);
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
        const rawMode = String(process.env.GATEWAY_HEALTH_MODE || 'compact').toLowerCase();
        const mode = (rawMode === 'sum') ? 'summary'
            : (rawMode === 'details' || rawMode === 'workers') ? 'full'
            : (rawMode === 'short') ? 'compact'
            : rawMode;

        const level = bad ? 'warn' : 'info';
        const tag = bad ? '🛑' : (this._healthWasBad ? '✅ RECOVERED' : '✅');
        const summaryLine = `[Health] ${tag} workers=${aliveCount}/${totalCount} idle=${idleSum} busy=${busySum} minRam=${_formatBytes(minRam)} clients=${clients}`;

        // Update state after computing tag (tag needs previous state)
        this._healthWasBad = bad;

        if (mode === 'summary') {
            _log(level, summaryLine);
            return;
        }

        if (mode === 'compact') {
            const parts = [];
            let idx = 0;
            for (const w of workers) {
                idx += 1;
                const cpu = Number(w.cpu);
                const cpuTxt = Number.isFinite(cpu) ? cpu.toFixed(1) : '?';
                const idle = Number.isFinite(Number(w.idleSlots)) ? Number(w.idleSlots) : 0;
                const total = Number.isFinite(Number(w.totalSlots)) ? Number(w.totalSlots) : idle;
                const ramTxt = _formatBytes(Number(w.ramFreeBytes));
                const ageTxt = Number.isFinite(w._ageSecNum) ? w._ageSecNum.toFixed(1) + 's' : String(w.ageSec ?? '?');
                const aliveMark = w._isAlive ? '' : '(stale)';
                parts.push(`w${idx}=${w.nodeId}${aliveMark} cpu=${cpuTxt} idle=${idle}/${total} ram=${ramTxt} age=${ageTxt}`);
            }

            const line = parts.length > 0 ? `${summaryLine} :: ${parts.join(' | ')}` : summaryLine;
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
            const cpuTxt = Number.isFinite(cpu) ? cpu.toFixed(2) : '?';
            const idle = Number.isFinite(Number(w.idleSlots)) ? Number(w.idleSlots) : 0;
            const busy = Number.isFinite(Number(w.busySlots)) ? Number(w.busySlots) : 0;
            const total = Number.isFinite(Number(w.totalSlots)) ? Number(w.totalSlots) : idle;
            const ramTxt = _formatBytes(Number(w.ramFreeBytes));
            const ageTxt = Number.isFinite(w._ageSecNum) ? w._ageSecNum.toFixed(1) + 's' : String(w.ageSec ?? '?');
            const portTxt = (w.workerPort ?? '');
            const aliveTxt = w._isAlive ? 'alive' : 'stale';
            _log(level, `[Worker] ${i}/${workers.length} ${w.nodeId} ${aliveTxt} cpu=${cpuTxt} idle=${idle} busy=${busy} total=${total} ramFree=${ramTxt} age=${ageTxt} port=${portTxt}`);
        }
    }

    _handleConnection(clientSocket) {
        const clientId = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
        this.activeClients.set(clientId, { connectedAt: Date.now() });
        _log('debug', `[Gateway] 🙋 Client kết nối: ${clientId} (clients=${this.activeClients.size})`);

        // Mỗi IP có 1 rổ Token (Chứa tối đa 50 requests, hồi 10 req/s)
        const limiter = new RateLimiter(50, 10);
        let workerSocket = null; // Socket nối xuống Trạm cày (nếu gọi lệnh RUN)

        // Throttle spam logs: tối đa 1 warn / 5s / client
        let lastSpamLogAt = 0;

        const parser = new FrameParser(
            (type, payload, rawFrame) => {
                // 1. Kiểm tra Rate Limit
                if (!limiter.consume()) {
                    const now = Date.now();
                    if (now - lastSpamLogAt >= 5000) {
                        lastSpamLogAt = now;
                        _log('warn', `[Gateway] 🛑 SPAM BLOCK: ${clientId}`);
                    }
                    clientSocket.write(buildFrame(TYPE.ERROR, "gateway", "Rate limit exceeded"));
                    return;
                }

                // 2. TODO: Khối AUTH (Giải mã AES và Check JWT ở đây)
                // if (!this._verifyAuth(payload)) { clientSocket.write(ERROR); clientSocket.destroy(); return; }   

                // 3. ROUTER BẺ LÁI GÓI TIN
                switch (type) {
                    case TYPE.RUN:
                        this._routeToWorkerCluster(clientSocket, rawFrame, payload, (sock) => workerSocket = sock);
                        break;
                    case TYPE.EDIT:
                    case TYPE.CURSOR:
                    case TYPE.CHAT:
                        // TODO: Tương lai sẽ bẻ lái sang Collab Server
                        _log('debug', `[Router] OT Sync (chưa implement)`);
                        break;
                    default:
                        _log('debug', `[Router] Gói tin không xác định: ${type}`);
                }
            },
            (err) => {
                _log('warn', `[Gateway] Lỗi Frame từ ${clientId}: ${err.message}`);
                clientSocket.destroy();
            }
        );

        clientSocket.on('data', (chunk) => parser.feed(chunk));
        
        clientSocket.on('error', (err) => _log('warn', `[Gateway] Lỗi kết nối ${clientId}: ${err.message}`));
        
        clientSocket.on('close', () => {
            this.activeClients.delete(clientId);
            _log('debug', `[Gateway] 👋 Client ngắt kết nối: ${clientId} (clients=${this.activeClients.size})`);
            if (workerSocket && !workerSocket.destroyed) workerSocket.destroy();
        });
    }

    // ─── ĐIỀU PHỐI XUỐNG WORKER CLUSTER ─────────────────────────
    _routeToWorkerCluster(clientSocket, rawFrame, payload, saveWorkerSocket) {
        // Lấy requestId để route + log
        if (!Buffer.isBuffer(payload) || payload.length < 4) {
            _log('warn', '[Router] Payload RUN không hợp lệ (quá ngắn)');
            return;
        }
        const idLen = payload.readUInt32BE(0);
        if (payload.length < 4 + idLen) {
            _log('warn', `[Router] Payload RUN không hợp lệ (idLen=${idLen})`);
            return;
        }
        const requestId = payload.subarray(4, 4 + idLen).toString('utf8');
        
        // Hỏi Sổ Nam Tào xem ai đang rảnh nhất
        const bestWorker = this.heartbeat.getBestWorker();

        if (!bestWorker) {
            _log('warn', `[Router] ⚠️ Không có worker rảnh — từ chối ${requestId}`);
            clientSocket.write(buildFrame(TYPE.ERROR, requestId, "Hệ thống đang bận, vui lòng thử lại."));
            return;
        }

        _log('debug', `[Router] 👉 Job [${requestId}] → ${bestWorker.nodeId} (${bestWorker.host}:${bestWorker.port})`);

        // Mở kết nối TCP tốc độ cao xuống Worker
        const workerSocket = new net.Socket();
        saveWorkerSocket(workerSocket); // Lưu lại để dọn dẹp khi Client ngắt ngang

        workerSocket.connect(bestWorker.port, bestWorker.host, () => {
            // Forward nguyên xi cục Frame nhị phân xuống cho Worker xử lý
            workerSocket.write(rawFrame);
        });

        // Hứng Stream kết quả (Stdout/Stderr/Exit) từ Worker và đập thẳng về mặt Client
        workerSocket.on('data', (chunk) => {
            if (!clientSocket.destroyed) clientSocket.write(chunk);
        });

        workerSocket.on('error', (err) => {
            _log('error', `[Router] Lỗi nối xuống Worker (${bestWorker.nodeId}): ${err.message}`);
            if (!clientSocket.destroyed) clientSocket.write(buildFrame(TYPE.ERROR, requestId, "Lỗi Server Nội Bộ"));
        });
    }
}

// CHẠY CHƯƠNG TRÌNH
if (require.main === module) {
    const gateway = new GatewayServer(8080);
    gateway.start();
}