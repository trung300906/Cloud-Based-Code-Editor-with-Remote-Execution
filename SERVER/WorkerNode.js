'use strict';

const net          = require('net');
const os           = require('os');
const { PassThrough } = require('stream');
const { MasterPoolManager } = require('./PoolManager.js');
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

// ─── Container exec helpers ─────────────────────────────────────

function waitStreamEnd(stream) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        stream.on('error', (err) => { if (done) return; done = true; reject(err); });
        stream.on('end', finish);
        stream.on('close', finish);
    });
}

async function writeCodeToContainer(docker, containerId, code) {
    const ctr  = docker.getContainer(containerId);
    const exec = await ctr.exec({
        Cmd: ['sh', '-lc', 'cat > /workspace/main.py'],
        WorkingDir: '/workspace',
        AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    stream.end(code);
    await waitStreamEnd(stream);

    const status = await exec.inspect();
    if (status.ExitCode !== 0) {
        throw new Error('write source failed: exit ' + status.ExitCode);
    }
}

async function runCodeStreaming(docker, containerId, onStdout, onStderr) {
    const ctr  = docker.getContainer(containerId);
    const exec = await ctr.exec({
        Cmd: ['python3', '-u', '/workspace/main.py'],
        WorkingDir: '/workspace',
        AttachStdout: true, AttachStderr: true, Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    docker.modem.demuxStream(stream, stdout, stderr);

    const closePipes = () => { stdout.end(); stderr.end(); };
    stream.on('end',   closePipes);
    stream.on('close', closePipes);

    stdout.on('data', onStdout);
    stderr.on('data', onStderr);

    const stdoutDone = waitStreamEnd(stdout);
    const stderrDone = waitStreamEnd(stderr);

    await waitStreamEnd(stream);
    await Promise.all([stdoutDone, stderrDone]);

    return (await exec.inspect()).ExitCode;
}

// ─── WorkerNode ─────────────────────────────────────────────────

async function main() {
    const WORKER_PORT  = Number(process.env.WORKER_PORT    || 5000);
    const GATEWAY_HOST = process.env.GATEWAY_HOST          || '192.168.122.224';
    const GATEWAY_PORT = Number(process.env.GATEWAY_HB_PORT || 4000);
    const NODE_ID      = process.env.NODE_ID               || `worker-${os.hostname()}`;

    const pendingRequests = new Map();

    console.log('[WorkerNode] Booting PoolManager…');
    const pool = new MasterPoolManager({
        minPoolSize: Number(process.env.MIN_POOL || 2),
        maxPoolSize: Number(process.env.MAX_POOL || 100),
        onQueueExpire(item) {
            const rid  = item.payload.job.id;
            const sock = pendingRequests.get(rid);
            if (sock?.writable) {
                sock.write(buildFrame(TYPE.ERROR, rid, 'queue timeout')); // SỬA: TYPE.ERROR
            }
            pendingRequests.delete(rid);
        },
        onQueuedJobError(err, queued) {
            const rid = queued?.payload?.job?.id ?? '?';
            console.error(`[WorkerNode] queued job ${rid} error:`, err.message || err);
        },
    });
    await pool.init();
    console.log('[WorkerNode] Pool ready:', pool.stats());

    const heartbeat = new HeartbeatWorker({
        gatewayHost: GATEWAY_HOST,
        gatewayPort: GATEWAY_PORT,
        nodeId:      NODE_ID,
        workerPort:  WORKER_PORT,
        poolManager: pool,
    });
    heartbeat.start();

    function handleExec(socket, requestId, code) {
        pendingRequests.set(requestId, socket);

        pool.dispatchJob({ id: requestId, code }, async (container, job) => {
            try {
                await writeCodeToContainer(pool.docker, container.id, job.code);

                const exitCode = await runCodeStreaming(
                    pool.docker, container.id,
                    (chunk) => { if (socket.writable) socket.write(buildFrame(TYPE.RESULT, requestId, chunk)); }, // SỬA: TYPE.RESULT
                    (chunk) => { if (socket.writable) socket.write(buildFrame(TYPE.RESULT, requestId, chunk)); }, // SỬA: TYPE.RESULT
                );

                if (socket.writable) {
                    socket.write(buildFrame(TYPE.RESULT, requestId, Buffer.from(`\n[Process Exited: ${exitCode ?? 1}]`))); // SỬA: TYPE.RESULT
                }
                return { exitCode };
            } catch (err) {
                if (socket.writable) {
                    socket.write(buildFrame(TYPE.ERROR, requestId, err.message || 'internal error')); // SỬA: TYPE.ERROR
                }
                return { exitCode: -1, error: err.message };
            } finally {
                pendingRequests.delete(requestId);
            }
        }).catch((err) => {
            console.error(`[WorkerNode] dispatch failed req=${requestId}:`, err.message || err);
            const sock = pendingRequests.get(requestId);
            if (sock?.writable) {
                sock.write(buildFrame(TYPE.ERROR, requestId, err.message || 'dispatch failed')); // SỬA: TYPE.ERROR
            }
            pendingRequests.delete(requestId);
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
                handleExec(socket, parsed.requestId, parsed.body.toString('utf8'));
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
        await pool.shutdown({ destroyPoolOnShutdown: true });

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