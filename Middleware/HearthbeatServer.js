'use strict';

const net = require('net');

// ─── LOGGING (giảm spam) ───────────────────────────────────────
// Levels: error < warn < info < debug
const HEARTBEAT_LOG_LEVEL = (
    process.env.HEARTBEAT_LOG_LEVEL ||
    process.env.GATEWAY_LOG_LEVEL ||
    process.env.LOG_LEVEL ||
    'info'
).toLowerCase();
const _LV = { error: 0, warn: 1, info: 2, debug: 3 };

function _shouldLog(level) {
    const want = _LV[HEARTBEAT_LOG_LEVEL] ?? _LV.info;
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

const PRUNE_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 64 * 1024; // 64KB — tránh memory attack

class HeartbeatServer {
    constructor(opts = {}) {
        this.port = opts.port ?? 4000;
        this.host = opts.host ?? '0.0.0.0';
        this.pruneIntervalMs = opts.pruneIntervalMs ?? 2000;

        // Expose để Gateway có thể đánh giá worker còn "alive" không.
        this.pruneTimeoutMs = Number(opts.pruneTimeoutMs ?? PRUNE_TIMEOUT_MS);
        if (!Number.isFinite(this.pruneTimeoutMs) || this.pruneTimeoutMs < 1000) {
            this.pruneTimeoutMs = PRUNE_TIMEOUT_MS;
        }

        // Map<nodeId, { socket, cpu, ramFreeBytes, idleSlots, busySlots,
        //               totalSlots, workerPort, lastSeen }>
        this.registry = new Map();

        this._server = null;
        this._pruneTimer = null;
    }

    start() {
        this._server = net.createServer((socket) => this._handleConnection(socket));

        this._server.on('error', (err) => {
            _log('error', `[HeartbeatServer] Server error: ${err.message}`);
        });

        this._server.listen(this.port, this.host, () => {
            _log('info', `[HeartbeatServer] Listening on ${this.host}:${this.port}`);
        });

        this._pruneTimer = setInterval(() => this._pruneDeadWorkers(), this.pruneIntervalMs);
        // Không giữ process sống nếu không có gì khác chạy
        this._pruneTimer.unref();
    }

    stop() {
        if (this._pruneTimer) {
            clearInterval(this._pruneTimer);
            this._pruneTimer = null;
        }

        if (this._server) {
            this._server.close();
            this._server = null;
        }

        // Đóng tất cả socket đang mở
        for (const [, info] of this.registry.entries()) {
            try { info.socket.destroy(); } catch (_) {}
        }

        this.registry.clear();
        _log('info', '[HeartbeatServer] Stopped.');
    }

    // Trả về worker phù hợp nhất: tích hợp idleSlots (khe rảnh), CPU load average và Free RAM (GB).
    // Đứa nào trống trải tài nguyên nhiều nhất sẽ được ưu tiên đẩy việc vào.
    getBestWorker() {
        const now = Date.now();
        let best = null;
        let bestScore = -Infinity;

        let bestNodeId = null;

        for (const [nodeId, info] of this.registry.entries()) {
            // Bỏ qua entry stale chưa kịp bị prune
            if (now - info.lastSeen > this.pruneTimeoutMs) continue;
            if (info.idleSlots <= 0) continue;
            if (!info.workerPort) continue;

            // Đổi bytes RAM trống thành đơn vị Gigabytes (GB)
            const ramFreeGB = (info.ramFreeBytes || 0) / (1024 * 1024 * 1024);

            // Công thức tính Score trọng số (Weighted Scoring System):
            // - idleSlots (Trọng số 10.0): Chỉ số quyết định khả năng nhận job song song
            // - cpu loadavg (Trọng số -5.0): Trừ điểm nặng nếu hệ điều hành đang quá tải CPU
            // - ramFreeGB (Trọng số 2.0): Thêm điểm cộng nếu máy trạm còn dồi dào RAM trống (để compile)
            const score = (info.idleSlots * 10.0) - (info.cpu * 5.0) + (ramFreeGB * 2.0);

            if (score > bestScore) {
                bestScore = score;
                bestNodeId = nodeId;
                best = {
                    nodeId,
                    host: info.socket.remoteAddress,
                    port: info.workerPort,
                };
            }
        }
        // Nếu chọn được worker tốt nhất, trừ ngay lập tức 1 slot rảnh ở bộ nhớ cục bộ (in-memory) của Gateway.
        // Điều này ngăn chặn việc 100 request ập vào cùng 1 miligiây đều chọn trúng 1 worker duy nhất (Thundering Herd Effect).
        // Khi Worker chính thức chạy job và gửi Heartbeat mới lên, nó sẽ ghi đè lại trạng thái thực tế chính xác.
        if (best && bestNodeId) {
            const info = this.registry.get(bestNodeId);
            if (info) {
                info.idleSlots = Math.max(0, info.idleSlots - 1);
                info.busySlots = (info.busySlots || 0) + 1;
            }
        }

        return best;
    }

    snapshot() {
        const now = Date.now();
        const result = [];
        for (const [nodeId, info] of this.registry.entries()) {
            result.push({
                nodeId,
                cpu: info.cpu,
                ramFreeBytes: info.ramFreeBytes,
                idleSlots: info.idleSlots,
                busySlots: info.busySlots,
                totalSlots: info.totalSlots,
                workerPort: info.workerPort,
                ageSec: ((now - info.lastSeen) / 1000).toFixed(1),
            });
        }
        return result;
    }

    _handleConnection(socket) {
        let buffer = '';

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');

            // Fix: chống memory attack — drop connection nếu buffer quá lớn
            if (Buffer.byteLength(buffer) > MAX_BUFFER_BYTES) {
                _log('warn', `[HeartbeatServer] Buffer overflow from ${socket.remoteAddress}, dropping.`);
                socket.destroy();
                return;
            }

            let boundary = buffer.indexOf('\n');
            while (boundary !== -1) {
                const line = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 1);

                if (line.length > 0) {
                    this._handlePacket(socket, line);
                }

                boundary = buffer.indexOf('\n');
            }
        });

        socket.on('error', (err) => {
            // 'close' luôn fire sau 'error', cleanup ở đó
            _log('warn', `[HeartbeatServer] Socket error (${socket.remoteAddress}): ${err.message}`);
        });

        socket.on('close', () => {
            this._evictBySocket(socket);
        });
    }

    _handlePacket(socket, line) {
        let data;
        try {
            data = JSON.parse(line);
        } catch (err) {
            _log('warn', `[HeartbeatServer] Bad JSON from ${socket.remoteAddress}: ${err.message}`);
            return;
        }

        // Fix: validate trước khi dùng làm Map key
        const { nodeId, cpu, ramFreeBytes, idleSlots, busySlots, totalSlots, workerPort } = data;

        if (typeof nodeId !== 'string' || nodeId.trim() === '') {
            _log('warn', `[HeartbeatServer] Packet missing nodeId from ${socket.remoteAddress}`);
            return;
        }

        if (typeof cpu !== 'number' || typeof idleSlots !== 'number') {
            _log('warn', `[HeartbeatServer] Packet missing required fields from ${nodeId}`);
            return;
        }

        this.registry.set(nodeId, {
            socket,
            cpu,
            ramFreeBytes: ramFreeBytes ?? 0,  // Fix: field name đồng bộ với client
            idleSlots,
            busySlots: busySlots ?? 0,
            totalSlots: totalSlots ?? idleSlots,
            workerPort: workerPort ?? null,    // Fix: lưu port từ payload
            lastSeen: Date.now(),
        });
    }

    _pruneDeadWorkers() {
        const now = Date.now();
        for (const [nodeId, info] of this.registry.entries()) {
            if (now - info.lastSeen > this.pruneTimeoutMs) {
                _log('warn', `[HeartbeatServer] Pruned stale worker: ${nodeId}`);
                this.registry.delete(nodeId);
            }
        }
    }

    _evictBySocket(socket) {
        for (const [nodeId, info] of this.registry.entries()) {
            if (info.socket === socket) {
                _log('info', `[HeartbeatServer] Worker disconnected: ${nodeId}`);
                this.registry.delete(nodeId);
            }
        }
    }
}

module.exports = HeartbeatServer;

if (require.main === module) {
    const server = new HeartbeatServer({ port: 4000 });
    server.start();

    // Log snapshot mỗi 3s thay vì console.clear()
    setInterval(() => {
        const snap = server.snapshot();
        if (snap.length === 0) return;
        _log('info', '[Registry] ' + JSON.stringify(snap, null, 2));
    }, 3000).unref();

    process.on('SIGINT', () => {
        server.stop();
        process.exit(0);
    });
}