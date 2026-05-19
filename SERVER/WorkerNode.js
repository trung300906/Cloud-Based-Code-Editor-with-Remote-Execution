'use strict';

const net          = require('net');
const os           = require('os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fse = require('fs-extra');
const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
} = require('@aws-sdk/client-s3');
const HeartbeatWorker       = require('./HearthbeatWorker.js');

// ─── ĐÃ ĐỒNG BỘ TỪ ĐIỂN TYPE VỚI GATEWAY ────────────────────────
const TYPE = {
    ERROR:  0x00,
    AUTH:   0x01,
    EDIT:   0x02,
    RUN:    0x03,
    CURSOR: 0x04,
    CHAT:   0x05,
    RESULT: 0x06,
    PING:   0xFF
};

const MAX_FRAME_BYTES = 4 * 1024 * 1024;

function buildFrame(type, requestId, data) {
    const idBuf     = Buffer.from(requestId, 'utf8');
    const idLenBuf  = Buffer.alloc(4);
    idLenBuf.writeUInt32BE(idBuf.length);
    const dataBuf   = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '', 'utf8');

    const payload   = Buffer.concat([idLenBuf, idBuf, dataBuf]);
    const header    = Buffer.alloc(5);
    header.writeUInt32BE(payload.length, 0);
    header[4] = type;
    return Buffer.concat([header, payload]);
}

function parseFramePayload(payload) {
    if (payload.length < 4) return null;
    const idLen = payload.readUInt32BE(0);
    if (payload.length < 4 + idLen) return null;
    return {
        requestId: payload.subarray(4, 4 + idLen).toString('utf8'),
        body:      payload.subarray(4 + idLen),
    };
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
            if (payloadLen > MAX_FRAME_BYTES) {
                this._buf = Buffer.alloc(0);
                this._onError(new Error(`frame too large: ${payloadLen} bytes`));
                return;
            }
            const frameLen = 5 + payloadLen;
            if (this._buf.length < frameLen) break;

            const type    = this._buf[4];
            const payload = this._buf.subarray(5, frameLen);
            this._buf     = this._buf.subarray(frameLen);
            this._onFrame(type, payload);
        }
    }
}

// ─── Phase 3: Worker Pull Execution Model helpers ───────────────

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://100.124.23.95:9000';
const MINIO_REGION = process.env.MINIO_REGION || 'us-east-1';
const MINIO_USER = process.env.MINIO_USER || 'minioadmin';
const MINIO_PASS = process.env.MINIO_PASS || 'minioadmin';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'cloud-ide';

const EXEC_TIMEOUT_MS = Number(process.env.EXEC_TIMEOUT_MS || 10000);
const WORKER_SLOTS = Number(process.env.WORKER_SLOTS || 10);
const QUEUE_TIMEOUT_MS = Number(process.env.JOB_QUEUE_TIMEOUT_MS || 30000);

const s3 = new S3Client({
    endpoint: MINIO_ENDPOINT,
    region: MINIO_REGION,
    credentials: {
        accessKeyId: MINIO_USER,
        secretAccessKey: MINIO_PASS,
    },
    forcePathStyle: true,
});

async function streamToBuffer(body) {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;

    // AWS SDK v3 in Node usually returns a Readable stream.
    const chunks = [];
    for await (const chunk of body) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function _assertSafeRequestId(requestId) {
    const rid = String(requestId || '').trim();
    if (!rid) throw new Error('missing requestId');
    if (rid.includes('/') || rid.includes('\\') || rid.includes('\u0000')) {
        throw new Error('invalid requestId');
    }
    return rid;
}

function _safeJoin(baseDir, relativePath) {
    // Keys from MinIO use POSIX separators.
    const rel = String(relativePath || '').replace(/^\/+/, '');
    if (!rel) return null;
    if (rel.includes('\u0000')) return null;

    const normalized = path.posix.normalize(rel);
    if (normalized === '.' || normalized.startsWith('..')) return null;

    const abs = path.resolve(baseDir, ...normalized.split('/'));
    const baseAbs = path.resolve(baseDir) + path.sep;
    if (!abs.startsWith(baseAbs)) return null;
    return abs;
}

async function listAllObjectKeys(prefix) {
    let token = undefined;
    const keys = [];

    for (;;) {
        const out = await s3.send(
            new ListObjectsV2Command({
                Bucket: MINIO_BUCKET,
                Prefix: prefix,
                ContinuationToken: token,
            }),
        );

        for (const obj of out.Contents || []) {
            if (obj && typeof obj.Key === 'string') keys.push(obj.Key);
        }

        if (!out.IsTruncated) break;
        token = out.NextContinuationToken;
        if (!token) break;
    }

    return keys;
}

async function pullWorkspaceFromMinio(jobDir, ownerId, projectId) {
    const prefix = `${ownerId}/${projectId}/`;
    const keys = await listAllObjectKeys(prefix);

    if (keys.length === 0) {
        throw new Error(`workspace empty (prefix=${prefix})`);
    }

    for (const key of keys) {
        if (!key.startsWith(prefix)) continue;
        if (key.endsWith('/')) continue; // folder marker

        const relativePath = key.slice(prefix.length);
        const outPath = _safeJoin(jobDir, relativePath);
        if (!outPath) continue;

        const resp = await s3.send(
            new GetObjectCommand({ Bucket: MINIO_BUCKET, Key: key }),
        );
        const buf = await streamToBuffer(resp.Body);
        await fse.outputFile(outPath, buf);
    }
}

function _quoteSh(str) {
    // Minimal safe quoting for sh -c by wrapping in single quotes.
    return `'${String(str).replace(/'/g, "'\\''")}'`;
}

async function runCppJob({ jobDir, entryPoint, timeoutMs, onStdout, onStderr }) {
    const entry = String(entryPoint || '').trim();
    if (!entry) throw new Error('missing entryPoint');
    if (path.isAbsolute(entry)) throw new Error('entryPoint must be relative');
    if (entry.includes('\u0000')) throw new Error('invalid entryPoint');

    // Ensure entry exists inside the pulled workspace.
    const entryAbs = _safeJoin(jobDir, entry);
    if (!entryAbs) throw new Error('invalid entryPoint path');
    const exists = await fse.pathExists(entryAbs);
    if (!exists) throw new Error(`entryPoint not found: ${entry}`);

    const cmd = `g++ ${_quoteSh(entry)} -o main && ./main`;

    const child = spawn('sh', ['-lc', cmd], {
        cwd: jobDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        detached: true,
    });

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);

    let timedOut = false;
    const kill = () => {
        try {
            process.kill(-child.pid, 'SIGKILL');
        } catch (_) {
            try { child.kill('SIGKILL'); } catch (_) {}
        }
    };

    const timer = setTimeout(() => {
        timedOut = true;
        kill();
    }, timeoutMs);

    const result = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timer));

    return { ...result, timedOut };
}

async function runPythonJob({ jobDir, entryPoint, timeoutMs, onStdout, onStderr }) {
    const entry = String(entryPoint || '').trim();
    if (!entry) throw new Error('missing entryPoint');
    if (path.isAbsolute(entry)) throw new Error('entryPoint must be relative');
    if (entry.includes('\u0000')) throw new Error('invalid entryPoint');

    // Ensure entry exists inside the pulled workspace.
    const entryAbs = _safeJoin(jobDir, entry);
    if (!entryAbs) throw new Error('invalid entryPoint path');
    const exists = await fse.pathExists(entryAbs);
    if (!exists) throw new Error(`entryPoint not found: ${entry}`);

    const cmd = `python3 ${_quoteSh(entry)}`;

    const child = spawn('sh', ['-lc', cmd], {
        cwd: jobDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        detached: true,
    });

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);

    let timedOut = false;
    const kill = () => {
        try {
            process.kill(-child.pid, 'SIGKILL');
        } catch (_) {
            try { child.kill('SIGKILL'); } catch (_) {}
        }
    };

    const timer = setTimeout(() => {
        timedOut = true;
        kill();
    }, timeoutMs);

    const result = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timer));

    return { ...result, timedOut };
}

class JobScheduler {
    constructor(opts = {}) {
        this.maxConcurrent = Number(opts.maxConcurrent ?? 1);
        if (!Number.isFinite(this.maxConcurrent) || this.maxConcurrent < 1) {
            this.maxConcurrent = 1;
        }
        this.queueTimeoutMs = Number(opts.queueTimeoutMs ?? 30000);
        this.onExpire = typeof opts.onExpire === 'function' ? opts.onExpire : null;
        this.busy = 0;
        this.queue = [];
    }

    stats() {
        const idle = Math.max(0, this.maxConcurrent - this.busy);
        return { idle, busy: this.busy, total: this.maxConcurrent };
    }

    enqueue(task) {
        this.queue.push({ ...task, enqueuedAt: Date.now() });
        this._drain();
    }

    _drain() {
        while (this.busy < this.maxConcurrent && this.queue.length > 0) {
            const item = this.queue.shift();
            if (!item) break;

            const age = Date.now() - item.enqueuedAt;
            if (age > this.queueTimeoutMs) {
                if (this.onExpire) {
                    try { this.onExpire(item); } catch (_) {}
                }
                continue;
            }

            this.busy += 1;
            Promise.resolve()
                .then(() => item.run())
                .catch(() => null)
                .finally(() => {
                    this.busy -= 1;
                    this._drain();
                });
        }
    }
}

// ─── WorkerNode ─────────────────────────────────────────────────

async function main() {
    const WORKER_PORT  = Number(process.env.WORKER_PORT    || 5000);
    const GATEWAY_HOST = process.env.GATEWAY_HOST          || '192.168.122.224';
    const GATEWAY_PORT = Number(process.env.GATEWAY_HB_PORT || 4000);
    const NODE_ID      = process.env.NODE_ID               || `worker-${os.hostname()}`;

    const pendingRequests = new Map();

    console.log('[WorkerNode] Phase 3 — Worker Pull Execution Model');
    console.log(`[WorkerNode] MinIO endpoint=${MINIO_ENDPOINT} bucket=${MINIO_BUCKET}`);

    const scheduler = new JobScheduler({
        maxConcurrent: WORKER_SLOTS,
        queueTimeoutMs: QUEUE_TIMEOUT_MS,
        onExpire(item) {
            const rid = item.requestId;
            const sock = pendingRequests.get(rid);
            if (sock?.writable) {
                sock.write(buildFrame(TYPE.ERROR, rid, 'queue timeout'));
            }
            pendingRequests.delete(rid);
        },
    });

    const heartbeat = new HeartbeatWorker({
        gatewayHost: GATEWAY_HOST,
        gatewayPort: GATEWAY_PORT,
        nodeId:      NODE_ID,
        workerPort:  WORKER_PORT,
        poolManager: scheduler,
    });
    heartbeat.start();

    function handleExec(socket, requestId, bodyBuf) {
        pendingRequests.set(requestId, socket);

        const rid = String(requestId);

        scheduler.enqueue({
            requestId: rid,
            run: async () => {
                const sock = pendingRequests.get(rid);
                if (!sock || sock.destroyed) {
                    pendingRequests.delete(rid);
                    return;
                }

                let spec;
                try {
                    spec = JSON.parse(Buffer.from(bodyBuf || '').toString('utf8'));
                } catch (err) {
                    if (sock.writable) {
                        sock.write(buildFrame(TYPE.ERROR, rid, 'Bad RUN payload JSON'));
                    }
                    pendingRequests.delete(rid);
                    return;
                }

                const ownerId = spec?.ownerId;
                const projectId = spec?.projectId;
                const language = String(spec?.language || '').toLowerCase();
                const entryPoint = spec?.entryPoint;

                if (ownerId === undefined || projectId === undefined || !language || !entryPoint) {
                    if (sock.writable) {
                        sock.write(buildFrame(TYPE.ERROR, rid, 'Missing fields. Received: ' + JSON.stringify(spec)));
                    }
                    pendingRequests.delete(rid);
                    return;
                }

                let safeRid;
                try {
                    safeRid = _assertSafeRequestId(rid);
                } catch (err) {
                    if (sock.writable) {
                        sock.write(buildFrame(TYPE.ERROR, rid, err.message || 'invalid requestId'));
                    }
                    pendingRequests.delete(rid);
                    return;
                }

                const jobDir = path.join('/tmp', 'cbcode_jobs', safeRid);

                try {
                    await fse.ensureDir(jobDir);

                    await pullWorkspaceFromMinio(jobDir, ownerId, projectId);

                    let result;
                    if (language === 'cpp' || language === 'c++') {
                        result = await runCppJob({
                            jobDir,
                            entryPoint,
                            timeoutMs: EXEC_TIMEOUT_MS,
                            onStdout: (chunk) => {
                                if (sock.writable) sock.write(buildFrame(TYPE.RESULT, rid, chunk));
                            },
                            onStderr: (chunk) => {
                                if (sock.writable) sock.write(buildFrame(TYPE.RESULT, rid, chunk));
                            },
                        });
                    } else if (language === 'python' || language === 'py') {
                        result = await runPythonJob({
                            jobDir,
                            entryPoint,
                            timeoutMs: EXEC_TIMEOUT_MS,
                            onStdout: (chunk) => {
                                if (sock.writable) sock.write(buildFrame(TYPE.RESULT, rid, chunk));
                            },
                            onStderr: (chunk) => {
                                if (sock.writable) sock.write(buildFrame(TYPE.RESULT, rid, chunk));
                            },
                        });
                    } else {
                        throw new Error(`unsupported language: ${language}`);
                    }

                    if (result.timedOut) {
                        if (sock.writable) {
                            sock.write(buildFrame(TYPE.ERROR, rid, `Timeout after ${EXEC_TIMEOUT_MS}ms`));
                        }
                        return;
                    }

                    const exitCode = Number.isFinite(result.code) ? result.code : 1;
                    if (sock.writable) {
                        sock.write(
                            buildFrame(
                                TYPE.RESULT,
                                rid,
                                Buffer.from(`\n[Process Exited: ${exitCode}]`),
                            ),
                        );
                    }
                } catch (err) {
                    if (sock.writable) {
                        sock.write(buildFrame(TYPE.ERROR, rid, err?.message || 'internal error'));
                    }
                } finally {
                    // Guaranteed cleanup
                    await fse.remove(jobDir).catch(() => null);
                    pendingRequests.delete(rid);
                }
            },
        });
    }

    const server = net.createServer((socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[WorkerNode] Gateway connected: ${remote}`);

        const parser = new FrameParser(
            (type, payload) => {
                if (type !== TYPE.RUN) return; // SỬA QUAN TRỌNG: Lắng nghe TYPE.RUN thay vì EXEC_REQ
                const parsed = parseFramePayload(payload);
                if (!parsed) return;
                // Phase 3: body is a JSON string buffer
                handleExec(socket, parsed.requestId, parsed.body);
            },
            (err) => {
                console.error(`[WorkerNode] Frame error (${remote}):`, err.message);
                socket.destroy();
            },
        );

        socket.on('data',  (chunk) => parser.feed(chunk));
        socket.on('error', (err) => console.error(`[WorkerNode] socket error (${remote}):`, err.message));
        socket.on('close', () => {
            let evicted = 0;
            for (const [rid, sock] of pendingRequests) {
                if (sock === socket) {
                    pendingRequests.delete(rid);
                    evicted++;
                }
            }
            if (evicted) console.log(`[WorkerNode] disconnected: ${remote}, evicted ${evicted} pending request(s)`);
            else         console.log(`[WorkerNode] disconnected: ${remote}`);
        });
    });

    server.listen(WORKER_PORT, '0.0.0.0', () => {
        console.log(`[WorkerNode] TCP server on 0.0.0.0:${WORKER_PORT}`);
        console.log(`[WorkerNode] Heartbeat → ${GATEWAY_HOST}:${GATEWAY_PORT}`);
        console.log(`[WorkerNode] Node ID: ${NODE_ID}`);
    });

    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[WorkerNode] ${signal} — shutting down…`);

        heartbeat.stop();
        server.close();
        // Nothing else to shutdown besides heartbeat + server.

        console.log('[WorkerNode] Goodbye.');
        process.exit(0);
    }

    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[WorkerNode] Fatal:', err);
    process.exitCode = 1;
});