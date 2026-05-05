'use strict';

const net = require('net');
const os = require('os');

class HeartbeatClient {
    constructor(opts = {}) {
        this.gatewayHost = opts.gatewayHost ?? '192.168.122.224';
        this.gatewayPort = opts.gatewayPort ?? 4000;
        this.nodeId = opts.nodeId ?? `worker-${os.hostname()}`;
        this.intervalMs = opts.intervalMs ?? 1000;
        this.reconnectMs = opts.reconnectMs ?? 3000;

        if (!opts.poolManager || typeof opts.poolManager.stats !== 'function') {
            throw new Error('HeartbeatClient requires a poolManager with .stats()');
        }
        this.poolManager = opts.poolManager;

        this._socket = null;
        this._pingTimer = null;
        this._reconnectTimer = null;
        this._connected = false;  // Fix bug 1: dùng flag thay readyState
        this._stopped = false;    // Fix bug 3: kiểm soát stop()
        this.workerPort = opts.workerPort ?? 5000; // Thêm dòng này
    }

    start() {
        this._stopped = false;
        console.log(`[${this.nodeId}] Khởi động Heartbeat Client...`);
        this._connect();
    }

    stop() {
        this._stopped = true;
        this._cleanup();
        console.log(`[${this.nodeId}] Heartbeat Client đã dừng.`);
    }

    _connect() {
        if (this._stopped) return;

        console.log(`[${this.nodeId}] Đang kết nối ${this.gatewayHost}:${this.gatewayPort}...`);

        const socket = new net.Socket();
        this._socket = socket;

        socket.connect(this.gatewayPort, this.gatewayHost, () => {
            if (this._stopped) { socket.destroy(); return; }

            console.log(`[${this.nodeId}] Đã kết nối tới Gateway.`);
            this._connected = true;

            this._pingTimer = setInterval(() => this._sendReport(), this.intervalMs);
        });

        socket.on('error', (err) => {
            // Không cần xử lý thêm — 'close' luôn fire sau 'error'
            console.error(`[${this.nodeId}] Lỗi socket: ${err.message}`);
        });

        socket.on('close', () => {
            // Fix bug 5: chỉ xử lý nếu đây vẫn là socket hiện tại
            if (socket !== this._socket) return;

            console.log(`[${this.nodeId}] Mất kết nối Gateway.`);
            this._cleanup();

            if (!this._stopped) {
                console.log(`[${this.nodeId}] Thử lại sau ${this.reconnectMs}ms...`);
                this._reconnectTimer = setTimeout(() => this._connect(), this.reconnectMs);
            }
        });
    }

    _sendReport() {
        if (!this._connected || !this._socket) return;

        const stats = this.poolManager.stats();
        const payload = {
            nodeId: this.nodeId,
            workerPort: this.workerPort, 
            cpu: os.loadavg()[0],
            ramFreeBytes: os.freemem(),
            idleSlots: stats.idle,
            busySlots: stats.busy,
            totalSlots: stats.total,
            timestamp: Date.now(),
        };

        const line = JSON.stringify(payload) + '\n';

        // Fix bug 4: write có thể fail nếu socket vừa drop
        try {
            const ok = this._socket.write(line);
            if (!ok) {
                // TCP buffer đầy — back-pressure, bỏ tick này
                console.warn(`[${this.nodeId}] TCP buffer đầy, bỏ qua 1 heartbeat.`);
            }
        } catch (err) {
            console.error(`[${this.nodeId}] Write failed: ${err.message}`);
        }
    }

    _cleanup() {
        this._connected = false;

        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }

        // Fix bug 2: clear reconnect timer khi cleanup
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        if (this._socket) {
            // Fix bug 5: gỡ listeners trước khi destroy
            this._socket.removeAllListeners();
            this._socket.destroy();
            this._socket = null;
        }
    }
}

module.exports = HeartbeatClient;
