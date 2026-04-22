'use strict';

const net = require('net');

const PRUNE_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 64 * 1024; // 64KB — tránh memory attack

class HeartbeatServer {
    constructor(opts = {}) {
        this.port = opts.port ?? 4000;
        this.host = opts.host ?? '0.0.0.0';
        this.pruneIntervalMs = opts.pruneIntervalMs ?? 2000;

        // Map<nodeId, { socket, cpu, ramFreeBytes, idleSlots, busySlots,
        //               totalSlots, workerPort, lastSeen }>
        this.registry = new Map();

        this._server = null;
        this._pruneTimer = null;
    }

    start() {
        this._server = net.createServer((socket) => this._handleConnection(socket));

        this._server.on('error', (err) => {
            console.error(`[HeartbeatServer] Server error: ${err.message}`);
        });

        this._server.listen(this.port, this.host, () => {
            console.log(`[HeartbeatServer] Listening on ${this.host}:${this.port}`);
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
        console.log('[HeartbeatServer] Stopped.');
    }

    // Trả về worker phù hợp nhất: ưu tiên idleSlots cao, CPU thấp.
    // Trả null nếu không có worker nào sẵn sàng.
    getBestWorker() {
        const now = Date.now();
        let best = null;
        let bestScore = -Infinity;

        for (const [nodeId, info] of this.registry.entries()) {
            // Bỏ qua entry stale chưa kịp bị prune
            if (now - info.lastSeen > PRUNE_TIMEOUT_MS) continue;
            if (info.idleSlots <= 0) continue;
            if (!info.workerPort) continue;

            // Score: nhiều slot rảnh = tốt, CPU cao = xấu
            const score = info.idleSlots - info.cpu;

            if (score > bestScore) {
                bestScore = score;
                best = {
                    nodeId,
                    host: info.socket.remoteAddress,
                    port: info.workerPort,   // Fix: không hardcode port
                };
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
                console.warn(`[HeartbeatServer] Buffer overflow from ${socket.remoteAddress}, dropping.`);
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
            console.error(`[HeartbeatServer] Socket error (${socket.remoteAddress}): ${err.message}`);
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
            console.warn(`[HeartbeatServer] Bad JSON from ${socket.remoteAddress}: ${err.message}`);
            return;
        }

        // Fix: validate trước khi dùng làm Map key
        const { nodeId, cpu, ramFreeBytes, idleSlots, busySlots, totalSlots, workerPort } = data;

        if (typeof nodeId !== 'string' || nodeId.trim() === '') {
            console.warn(`[HeartbeatServer] Packet missing nodeId from ${socket.remoteAddress}`);
            return;
        }

        if (typeof cpu !== 'number' || typeof idleSlots !== 'number') {
            console.warn(`[HeartbeatServer] Packet missing required fields from ${nodeId}`);
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
            if (now - info.lastSeen > PRUNE_TIMEOUT_MS) {
                console.log(`[HeartbeatServer] Pruned stale worker: ${nodeId}`);
                this.registry.delete(nodeId);
            }
        }
    }

    _evictBySocket(socket) {
        for (const [nodeId, info] of this.registry.entries()) {
            if (info.socket === socket) {
                console.log(`[HeartbeatServer] Worker disconnected: ${nodeId}`);
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
        console.log('[Registry]', JSON.stringify(snap, null, 2));
    }, 3000).unref();

    process.on('SIGINT', () => {
        server.stop();
        process.exit(0);
    });
}