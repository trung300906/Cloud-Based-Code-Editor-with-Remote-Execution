"use strict";

const { PassThrough } = require("stream");
const { MasterPoolManager } = require("./PoolManager.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPythonCode(jobId) {
    return [
        "import sys",
        "import time",
        `print('job ${jobId} start', flush=True)`,
        "for i in range(3):",
        `    print(f'job ${jobId} tick {i}', flush=True)`,
        "    time.sleep(1)",
        `print('job ${jobId} done', flush=True)`,
        `print('job ${jobId} stderr sample', file=sys.stderr, flush=True)`,
    ].join("\n");
}

function waitStreamClosed(stream) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };

        stream.on("error", (err) => {
            if (done) return;
            done = true;
            reject(err);
        });
        stream.on("end", finish);
        stream.on("close", finish);
    });
}

function consumeLines(stream, onLine) {
    return new Promise((resolve, reject) => {
        let carry = "";
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            if (carry) {
                onLine(carry.replace(/\r$/, ""));
            }
            resolve();
        };

        stream.on("data", (chunk) => {
            const merged = carry + chunk.toString("utf8");
            const lines = merged.split("\n");
            carry = lines.pop() || "";
            for (const line of lines) {
                onLine(line.replace(/\r$/, ""));
            }
        });

        stream.on("error", (err) => {
            if (done) return;
            done = true;
            reject(err);
        });
        stream.on("end", finish);
        stream.on("close", finish);
    });
}

async function writeCodeToContainer(docker, containerId, sourceCode) {
    const ctr = docker.getContainer(containerId);
    const exec = await ctr.exec({
        Cmd: ["sh", "-lc", "cat > /workspace/main.py"],
        WorkingDir: "/workspace",
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: true });
    stream.end(sourceCode);
    await waitStreamClosed(stream);

    const status = await exec.inspect();
    if (status.ExitCode !== 0) {
        throw new Error("write source failed with exit code " + status.ExitCode);
    }
}

async function runPythonAndStream(docker, containerId, jobId) {
    const ctr = docker.getContainer(containerId);
    const exec = await ctr.exec({
        Cmd: ["python3", "-u", "/workspace/main.py"],
        WorkingDir: "/workspace",
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    // Dùng demuxStream chuẩn của dockerode để tách stdout/stderr.
    docker.modem.demuxStream(stream, stdout, stderr);

    // ==========================================
    // 🛠️ THÊM ĐOẠN NÀY ĐỂ FIX LỖI TREO KINH ĐIỂN
    // ==========================================
    const closePassThroughs = () => {
        stdout.end();
        stderr.end();
    };
    stream.on("end", closePassThroughs);
    stream.on("close", closePassThroughs);
    // ==========================================

    const stdoutDone = consumeLines(stdout, (line) => {
        if (line) {
            console.log(`[job ${jobId}][stdout] ${line}`);
        }
    });

    const stderrDone = consumeLines(stderr, (line) => {
        if (line) {
            console.error(`[job ${jobId}][stderr] ${line}`);
        }
    });

    await waitStreamClosed(stream);
    await Promise.all([stdoutDone, stderrDone]);

    const status = await exec.inspect();
    return { exitCode: status.ExitCode };
}

async function realRunJob(manager, tracker, container, jobData) {
    console.log(`[worker] start job=${jobData.id} container=${container.name}`);
    try {
        await writeCodeToContainer(manager.docker, container.id, jobData.code);
        const result = await runPythonAndStream(manager.docker, container.id, jobData.id);

        if (result.exitCode !== 0) {
            tracker.failed += 1;
            throw new Error("python exited with code " + result.exitCode);
        }

        return { ok: true, exitCode: result.exitCode };
    } finally {
        tracker.finished += 1;
        console.log(
            `[worker] finish progress=${tracker.finished}/${tracker.total} failed=${tracker.failed}`,
        );
    }
}

async function runElasticTestReal() {
    const totalJobs = 8;
    const tracker = { total: totalJobs, finished: 0, failed: 0 };

    console.log("=== 1) BOOT ELASTIC POOL (Min=2 Max=5) ===");
    const manager = new MasterPoolManager({
        minPoolSize: 2,
        maxPoolSize: 5,
        healthIntervalMs: 2000,
        minSystemFreeRamBytes: 128 * 1024 * 1024,
    });

    await manager.init();
    console.log("Initial stats:", manager.stats());

    console.log("\n=== 2) FIRE REAL JOBS TO TRIGGER SCALE-UP ===");
    const dispatchPromises = [];

    for (let i = 1; i <= totalJobs; i += 1) {
        const payload = { id: i, code: createPythonCode(i) };
        const p = manager
            .dispatchJob(payload, (container, jobData) =>
                realRunJob(manager, tracker, container, jobData),
            )
            .then((res) => {
                if (res.queued) {
                    console.log(`[router] queue job=${i} queueId=${res.queueId}`);
                }
                return res;
            })
            .catch((err) => {
                tracker.failed += 1;
                tracker.finished += 1;
                console.error(`[router] dispatch failed job=${i}:`, err.message || err);
            });

        dispatchPromises.push(p);
        await sleep(100);
    }

    const monitor = setInterval(() => {
        console.log("   [stats]", manager.stats(), "progress", {
            finished: tracker.finished,
            total: tracker.total,
            failed: tracker.failed,
        });
    }, 1000);

    const deadline = Date.now() + 90000;
    while (tracker.finished < tracker.total && Date.now() < deadline) {
        await sleep(1000);
    }

    clearInterval(monitor);
    await Promise.allSettled(dispatchPromises);

    if (tracker.finished < tracker.total) {
        console.warn(
            `[test] timeout waiting jobs done: ${tracker.finished}/${tracker.total}`,
        );
    }

    console.log("\n=== 3) WAIT FOR SCALE-DOWN BACK TO MIN ===");
    for (let i = 1; i <= 8; i += 1) {
        await sleep(2000);
        const s = manager.stats();
        console.log(`[scale-down check ${i}]`, s);
        if (s.total <= s.minPool && s.queued === 0 && s.busy === 0) {
            console.log("[test] scale-down reached min pool");
            break;
        }
    }

    console.log("\n=== DONE: SHUTDOWN ===");
    await manager.shutdown({ destroyPoolOnShutdown: true });

    if (tracker.failed > 0) {
        throw new Error(`real execution finished with ${tracker.failed} failed job(s)`);
    }
}

runElasticTestReal().catch((err) => {
    console.error("Test Error:", err);
    process.exitCode = 1;
});