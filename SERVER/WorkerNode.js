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
const { encryptPayload } = require('../Middleware/cryptoUtils.js');
const tar = require('tar-fs');
const { MasterPoolManager } = require('./PoolManager.js');

// ─── ĐÃ ĐỒNG BỘ TỪ ĐIỂN TYPE VỚI GATEWAY ────────────────────────
const TYPE = {
    ERROR:  0x00,
    AUTH:   0x01,
    EDIT:   0x02,
    RUN:    0x03,
    CURSOR: 0x04,
    CHAT:   0x05,
    RESULT: 0x06,
    INPUT:  0x07,
    LINT:   0x08,
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

const EXEC_TIMEOUT_MS = Number(process.env.EXEC_TIMEOUT_MS || 300000);
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

const pendingRequests = new Map();
const activeProcesses = new Map();

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
    return `'${String(str).replace(/'/g, "'\\''")}'`;
}

// ─── WorkerNode ─────────────────────────────────────────────────

async function main() {
    const WORKER_PORT  = Number(process.env.WORKER_PORT    || 5000);
    const GATEWAY_HOST = process.env.GATEWAY_HOST          || '192.168.122.224';
    const GATEWAY_PORT = Number(process.env.GATEWAY_HB_PORT || 4000);
    const NODE_ID      = process.env.NODE_ID               || `worker-${os.hostname()}`;

    console.log('[WorkerNode] Phase 3 — Docker Pool Execution Model');
    console.log(`[WorkerNode] MinIO endpoint=${MINIO_ENDPOINT} bucket=${MINIO_BUCKET}`);

    // Create the jobs directory BEFORE Docker daemon starts containers to ensure it is owned by the Worker node user
    await fse.ensureDir('/tmp/zera_jobs');
    await fse.chmod('/tmp/zera_jobs', 0o777);

    const poolManager = new MasterPoolManager({
        maxPoolSize: WORKER_SLOTS,
        queueTimeoutMs: QUEUE_TIMEOUT_MS,
        onQueuedJobError(err, queued) {
            const rid = queued.payload.job.rid;
            const sock = pendingRequests.get(rid);
            if (sock?.writable) {
                sock.write(buildFrame(TYPE.ERROR, rid, `Job failed in queue: ${err.message}`));
            }
            pendingRequests.delete(rid);
        },
        onQueueExpire(item) {
            const rid = item.payload.job.rid;
            const sock = pendingRequests.get(rid);
            if (sock?.writable) {
                sock.write(buildFrame(TYPE.ERROR, rid, 'Queue timeout'));
            }
            pendingRequests.delete(rid);
        }
    });

    await poolManager.init();

    const heartbeat = new HeartbeatWorker({
        gatewayHost: GATEWAY_HOST,
        gatewayPort: GATEWAY_PORT,
        nodeId:      NODE_ID,
        workerPort:  WORKER_PORT,
        poolManager: poolManager,
    });
    heartbeat.start();

    function handleExec(socket, requestId, bodyBuf) {
        pendingRequests.set(requestId, socket);
        const rid = String(requestId);

        let spec;
        try {
            spec = JSON.parse(Buffer.from(bodyBuf || '').toString('utf8'));
        } catch (err) {
            if (socket.writable) socket.write(buildFrame(TYPE.ERROR, rid, 'Bad RUN payload JSON'));
            pendingRequests.delete(rid);
            return;
        }

        const ownerId = spec?.ownerId;
        const projectId = spec?.projectId;
        const language = String(spec?.language || '').toLowerCase();
        const entryPoint = spec?.entryPoint;

        if (ownerId === undefined || projectId === undefined || !language || !entryPoint) {
            if (socket.writable) {
                socket.write(buildFrame(TYPE.ERROR, rid, 'Missing fields. Received: ' + JSON.stringify(spec)));
            }
            pendingRequests.delete(rid);
            return;
        }

        // Remove non-alphanumeric chars for safety
        const safeRid = String(rid).replace(/[^a-zA-Z0-9_-]/g, '');
        const jobDir = path.join('/tmp', 'zera_jobs', safeRid);
        const jobPayload = { rid, spec, jobDir };

        poolManager.dispatchJob(jobPayload, async (container, job) => {
            const sock = pendingRequests.get(job.rid);
            if (!sock || sock.destroyed) return;

            try {
                await fse.ensureDir(job.jobDir);
                await fse.chmod(job.jobDir, 0o777);
                
                // Chỉ kéo từ MinIO nếu có projectId hợp lệ
                if (job.spec.projectId && job.spec.projectId !== 'null') {
                    await pullWorkspaceFromMinio(job.jobDir, job.spec.ownerId, job.spec.projectId).catch(err => {
                        console.warn(`[WorkerNode] Failed to pull workspace: ${err.message}`);
                    });
                }

                const entry = String(job.spec.entryPoint || 'main.cpp').trim();
                
                // Luôn ghi đè code hiện tại từ trình duyệt xuống đĩa (hỗ trợ chạy 1 file lẻ không cần project)
                if (job.spec.code) {
                    const entryAbs = _safeJoin(job.jobDir, entry);
                    if (entryAbs) await fse.outputFile(entryAbs, job.spec.code);
                }

                console.log(`[WorkerNode] Dispatched job ${job.rid} to container ${container.id}`);
                const dockerContainer = poolManager.docker.getContainer(container.id);

                let cmd = '';
                if (job.spec.language === 'cpp' || job.spec.language === 'c++') {
                    cmd = `g++ ${_quoteSh(entry)} -o main && ./main`;
                } else if (job.spec.language === 'python' || job.spec.language === 'py') {
                    cmd = `python3 ${_quoteSh(entry)}`;
                } else {
                    throw new Error(`unsupported language: ${job.spec.language}`);
                }

                console.log(`[WorkerNode] Running command: ${cmd} in /workspace/${safeRid}`);
                const exec = await dockerContainer.exec({
                    Cmd: ['sh', '-lc', cmd],
                    AttachStdout: true,
                    AttachStderr: true,
                    AttachStdin: true,
                    Tty: false,
                    User: 'sandbox_user',
                    WorkingDir: `/workspace/${safeRid}`
                });

                console.log(`[WorkerNode] exec created`);
                const stream = await exec.start({ hijack: true, stdin: true });
                console.log(`[WorkerNode] exec started`);
                activeProcesses.set(job.rid, stream);

                // Dockerode stream multiplexing
                dockerContainer.modem.demuxStream(stream, 
                    { write: (chunk) => { if (sock.writable) sock.write(buildFrame(TYPE.RESULT, job.rid, chunk)); } }, // stdout
                    { write: (chunk) => { if (sock.writable) sock.write(buildFrame(TYPE.RESULT, job.rid, chunk)); } }  // stderr
                );

                let timedOut = false;
                const timer = setTimeout(() => {
                    timedOut = true;
                    if (stream.destroy) stream.destroy();
                }, EXEC_TIMEOUT_MS);

                await new Promise((resolve) => {
                    let isResolved = false;
                    const done = () => {
                        if (!isResolved) {
                            isResolved = true;
                            resolve();
                        }
                    };

                    stream.on('end', done);
                    stream.on('close', done);
                    stream.on('error', done);

                    // Docker stream can be delayed closing if stdin is attached, poll inspect to exit instantly
                    const checkInterval = setInterval(async () => {
                        try {
                            const inspect = await exec.inspect();
                            if (!inspect.Running) {
                                clearInterval(checkInterval);
                                done();
                            }
                        } catch(e) {}
                    }, 100);

                    // Ensure interval is cleared if resolved by event
                    stream.on('end', () => clearInterval(checkInterval));
                    stream.on('close', () => clearInterval(checkInterval));
                });
                clearTimeout(timer);

                const inspect = await exec.inspect();
                const exitCode = inspect.ExitCode;

                if (timedOut) {
                    if (sock.writable) sock.write(buildFrame(TYPE.ERROR, job.rid, `Timeout after ${EXEC_TIMEOUT_MS}ms`));
                } else {
                    if (sock.writable) sock.write(buildFrame(TYPE.RESULT, job.rid, Buffer.from(`\n[Process Exited: ${exitCode}]`)));
                }
            } catch (err) {
                if (sock.writable) sock.write(buildFrame(TYPE.ERROR, job.rid, `Execution failed: ${err.message}`));
            } finally {
                activeProcesses.delete(job.rid);
                pendingRequests.delete(job.rid);
                await fse.remove(job.jobDir).catch(() => {});
            }
        }).then(result => {
            if (result && result.queued) {
                const sock = pendingRequests.get(rid);
                if (sock?.writable) sock.write(buildFrame(TYPE.RESULT, rid, Buffer.from("\n[System] All containers busy. Job queued...")));
            }
        }).catch(err => {
            const sock = pendingRequests.get(rid);
            if (sock?.writable) sock.write(buildFrame(TYPE.ERROR, rid, `Dispatch failed: ${err.message}`));
            pendingRequests.delete(rid);
        });
    }

    function handleLint(socket, requestId, bodyBuf) {
        const rid = String(requestId);
        let spec;
        try {
            spec = JSON.parse(Buffer.from(bodyBuf || '').toString('utf8'));
        } catch (err) { return; }

        const language = String(spec?.language || '').toLowerCase();
        const code = spec?.code || '';
        if (!code) return;

        const safeRid = "lint_" + String(rid).replace(/[^a-zA-Z0-9_-]/g, '');
        const jobDir = path.join('/tmp', 'zera_jobs', safeRid);
        const jobPayload = { rid: safeRid, spec: { language }, jobDir };

        poolManager.dispatchJob(jobPayload, async (container, job) => {
            try {
                await fse.ensureDir(job.jobDir);
                await fse.chmod(job.jobDir, 0o777);
                
                let ext = "txt", cmd = "";
                if (language === 'cpp' || language === 'c++') {
                    ext = "cpp";
                    cmd = `g++ -fsyntax-only -Wall -fdiagnostics-color=never test.cpp`;
                } else if (language === 'python' || language === 'py') {
                    ext = "py";
                    cmd = `python3 -m py_compile test.py`;
                } else {
                    return;
                }
                
                const entryAbs = _safeJoin(job.jobDir, `test.${ext}`);
                await fse.outputFile(entryAbs, code);

                const dockerContainer = poolManager.docker.getContainer(container.id);
                const exec = await dockerContainer.exec({
                    Cmd: ['sh', '-lc', cmd],
                    AttachStdout: true,
                    AttachStderr: true,
                    User: 'sandbox_user',
                    WorkingDir: `/workspace/${safeRid}`
                });

                const stream = await exec.start({ hijack: true, stdin: false });
                let output = '';
                await new Promise((resolve) => {
                    dockerContainer.modem.demuxStream(stream, 
                        { write: (chunk) => { output += chunk.toString(); } },
                        { write: (chunk) => { output += chunk.toString(); } }
                    );
                    
                    const timer = setTimeout(() => { if (stream.destroy) stream.destroy(); }, 3000); // 3s timeout for lint
                    stream.on('end', () => {
                        clearTimeout(timer);
                        resolve();
                    });
                });

                const markers = [];
                const lines = output.split('\n');
                
                if (language === 'cpp' || language === 'c++') {
                    const cppRegex = /test\.cpp:(\d+):(\d+):\s+(error|warning):\s+(.*)/;
                    for (const line of lines) {
                        const match = line.match(cppRegex);
                        if (match) {
                            markers.push({
                                severity: match[3] === 'error' ? 8 : 4,
                                startLineNumber: parseInt(match[1]),
                                startColumn: parseInt(match[2]),
                                endLineNumber: parseInt(match[1]),
                                endColumn: parseInt(match[2]) + 1,
                                message: match[4]
                            });
                        }
                    }
                } else if (language === 'python' || language === 'py') {
                    const pyRegex = /File "test\.py", line (\d+)/;
                    let lastLine = null;
                    for (let i = 0; i < lines.length; i++) {
                        const m = lines[i].match(pyRegex);
                        if (m) lastLine = parseInt(m[1]);
                        else if (lastLine && lines[i].includes('Error:')) {
                            markers.push({
                                severity: 8,
                                startLineNumber: lastLine,
                                startColumn: 1,
                                endLineNumber: lastLine,
                                endColumn: 99,
                                message: lines[i].trim()
                            });
                            lastLine = null;
                        }
                    }
                }
                
                if (socket.writable) {
                    socket.write(buildFrame(TYPE.LINT, rid, JSON.stringify(markers)));
                }

            } catch (err) {
                // ignore lint errors silently
            } finally {
                await fse.remove(job.jobDir).catch(() => {});
            }
        }).catch(() => {}); // ignore queue errors silently
    }

    const server = net.createServer((socket) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[WorkerNode] Gateway connected: ${remote}`);

        const parser = new FrameParser(
            (type, payload) => {
                if (type !== TYPE.RUN && type !== TYPE.INPUT && type !== TYPE.LINT) return;
                const parsed = parseFramePayload(payload);
                if (!parsed) return;
                
                if (type === TYPE.RUN) {
                    handleExec(socket, parsed.requestId, parsed.body);
                } else if (type === TYPE.LINT) {
                    handleLint(socket, parsed.requestId, parsed.body);
                } else if (type === TYPE.INPUT) {
                    const stream = activeProcesses.get(parsed.requestId);
                    if (stream) {
                        if (parsed.body.length === 1 && parsed.body[0] === 0x03) {
                            if (stream.destroy) stream.destroy();
                        } else {
                            if (stream.write) stream.write(parsed.body);
                        }
                    }
                }
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
        await poolManager.shutdown({ destroyPoolOnShutdown: true });

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