"use strict";

const Docker = require("dockerode");
const os = require("os");
const { WarmPoolBootstrapper } = require("./warmpool.js");

class InMemoryJobQueue {
	constructor(opts = {}) {
		this.timeoutMs = Number(opts.timeoutMs ?? 30000);
		this.onExpire = typeof opts.onExpire === "function" ? opts.onExpire : null;
		this.seq = 0;
		this.items = [];
	}

	enqueue(payload) {
		const now = Date.now();
		const item = {
			id: `job-${++this.seq}`,
			payload,
			enqueuedAt: now,
			expiresAt: now + this.timeoutMs,
		};
		this.items.push(item);
		return item;
	}

	dequeue() {
		this._dropExpired();
		return this.items.shift() || null;
	}

	requeueFront(item) {
		this.items.unshift(item);
	}

	size() {
		this._dropExpired();
		return this.items.length;
	}

	_dropExpired() {
		if (this.items.length === 0) return;
		const now = Date.now();
		if (this.items.every((x) => x.expiresAt > now)) return;

		const alive = [];
		for (const item of this.items) {
			if (item.expiresAt > now) {
				alive.push(item);
				continue;
			}
			if (this.onExpire) {
				try {
					this.onExpire(item);
				} catch (_) {}
			}
		}
		this.items = alive;
	}
}

class MasterPoolManager {
	constructor(opts = {}) {
		this.docker = opts.docker || new Docker(opts.dockerOptions || undefined);

		this.warmPool =
			opts.warmPool ||
			new WarmPoolBootstrapper({
				...(opts.warmPoolOptions || {}),
				docker: this.docker,
			});

		this.minPoolSize = Number(
			opts.minPoolSize ?? process.env.MIN_POOL ?? this.warmPool.poolSize ?? 2,
		);
		if (!Number.isFinite(this.minPoolSize) || this.minPoolSize < 1) {
			this.minPoolSize = 1;
		}

		this.maxPoolSize = Number(opts.maxPoolSize ?? process.env.MAX_POOL ?? 100);
		if (!Number.isFinite(this.maxPoolSize) || this.maxPoolSize < this.minPoolSize) {
			this.maxPoolSize = this.minPoolSize;
		}

		this.minSystemFreeRamBytes = Number(
			opts.minSystemFreeRamBytes ??
				process.env.MIN_SYSTEM_FREE_RAM_BYTES ??
				256 * 1024 * 1024,
		);

		// Đồng bộ WarmPool để bootstrap luôn ở mức MinPool.
		this.warmPool.poolSize = this.minPoolSize;

		// Reuse trực tiếp Map/Set của WarmPool để state luôn đồng bộ.
		this.pool = this.warmPool.pool;
		this.idle = this.warmPool.idle;
		this.busy = this.warmPool.busy;

		this.healthIntervalMs = Number(
			opts.healthIntervalMs ?? process.env.HEALTH_CHECK_MS ?? 5000,
		);
		this.healthProbeTimeoutMs = Number(
			opts.healthProbeTimeoutMs ?? process.env.HEALTH_PROBE_TIMEOUT_MS ?? 2000,
		);
		this.resetBudgetMs = Number(
			opts.resetBudgetMs ?? process.env.VIRGIN_RESET_BUDGET_MS ?? 50,
		);
		this.virginResetTimeoutMs = Number(
			opts.virginResetTimeoutMs ?? process.env.VIRGIN_RESET_TIMEOUT_MS ?? 10000,
		);

		this.queueTimeoutMs = Number(
			opts.queueTimeoutMs ?? process.env.JOB_QUEUE_TIMEOUT_MS ?? 30000,
		);

		this.queue =
			opts.queue ||
			new InMemoryJobQueue({
				timeoutMs: this.queueTimeoutMs,
				onExpire: opts.onQueueExpire,
			});

		this.onQueuedJobError =
			typeof opts.onQueuedJobError === "function" ? opts.onQueuedJobError : null;

		this.healthTimer = null;
		this.isQueueDraining = false;
		this.scaleUpInFlight = null;
	}

	async init() {
		await this.warmPool.bootstrap();
		this.startHealthMonitor();
		return this.snapshot();
	}

	snapshot() {
		return [...this.pool.values()].map((x) => ({ ...x }));
	}

	stats() {
		return {
			minPool: this.minPoolSize,
			maxPool: this.maxPoolSize,
			total: this.pool.size,
			idle: this.idle.size,
			busy: this.busy.size,
			queued: typeof this.queue.size === "function" ? this.queue.size() : 0,
		};
	}

	acquireContainer() {
		return this.warmPool.acquireIdle();
	}

	async releaseContainer(id, opts = {}) {
		if (!this.pool.has(id) || !this.busy.has(id)) {
			return { ok: false, reason: "invalid_or_not_busy" };
		}

		const resetResult = opts.skipReset
			? { ok: true, durationMs: 0, withinBudget: true }
			: await this.virginReset(id);

		if (!resetResult.ok) {
			await this.markAsDeadAndSpawnNew(id, "virgin_reset_failed");
			await this.processQueue();
			return { ok: false, reason: "reset_failed", reset: resetResult };
		}

		const released = this.warmPool.release(id);
		if (!released) {
			await this.markAsDeadAndSpawnNew(id, "release_failed");
			await this.processQueue();
			return { ok: false, reason: "release_failed", reset: resetResult };
		}

		const rec = this.pool.get(id);
		if (rec) {
			rec.lastResetMs = resetResult.durationMs;
			rec.resetWithinBudget = resetResult.withinBudget;
			rec.lastUsedAt = Date.now();
		}

		await this.processQueue();
		return { ok: true, reset: resetResult };
	}

	enqueueJob(job, runJob) {
		if (typeof runJob !== "function") {
			throw new TypeError("runJob must be a function");
		}
		const entry = this.queue.enqueue({ job, runJob });
		return entry;
	}

	async dispatchJob(job, runJob) {
		if (typeof runJob !== "function") {
			throw new TypeError("runJob must be a function");
		}

		let container = this.acquireContainer();

		if (!container) {
			container = await this._scaleUpAndAcquire("dispatch");
		}

		if (!container) {
			const queued = this.enqueueJob(job, runJob);
			return {
				queued: true,
				queueId: queued.id,
				expiresAt: queued.expiresAt,
			};
		}

		const runResult = await this._runJobOnContainer(container, job, runJob);
		return {
			queued: false,
			containerId: container.id,
			result: runResult,
		};
	}

	async processQueue() {
		if (this.isQueueDraining) return;
		this.isQueueDraining = true;

		try {
			for (;;) {
				const queued = this.queue.dequeue();
				if (!queued) break;

				let container = this.acquireContainer();
				if (!container) {
					container = await this._scaleUpAndAcquire("queue_drain");
				}

				if (!container) {
					this.queue.requeueFront(queued);
					break;
				}

				this._runJobOnContainer(
					container,
					queued.payload.job,
					queued.payload.runJob,
				).catch((err) => {
					if (this.onQueuedJobError) {
						try {
							this.onQueuedJobError(err, queued);
						} catch (_) {}
					}
				});
			}
		} finally {
			this.isQueueDraining = false;
		}
	}

	async virginReset(id) {
		const started = process.hrtime.bigint();
		try {
			await this._withTimeout(
				this._execVirginReset(id),
				this.virginResetTimeoutMs,
				"virgin reset timeout (" + this.virginResetTimeoutMs + "ms)",
			);
			const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
			return {
				ok: true,
				durationMs,
				withinBudget: durationMs <= this.resetBudgetMs,
			};
		} catch (err) {
			return {
				ok: false,
				error: String(err && err.message ? err.message : err),
			};
		}
	}

	async _execVirginReset(id) {
		const ctr = this.docker.getContainer(id);
		const cmd = [
			"sh",
			"-c",
			"pkill -9 -u sandbox_user >/dev/null 2>&1 || true; rm -rf /workspace/*; true",
		];

		const exec = await ctr.exec({
			Cmd: cmd,
			User: "0",
			AttachStdout: true,
			AttachStderr: true,
		});

		const stream = await exec.start({ hijack: true, stdin: false });
		stream.resume();
		await new Promise((resolve, reject) => {
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

		const status = await exec.inspect();
		if (status.ExitCode !== 0) {
			throw new Error("reset command failed with exit code " + status.ExitCode);
		}
	}

	startHealthMonitor() {
		if (this.healthTimer) return;

		this.healthTimer = setInterval(() => {
			this._healthTick().catch((err) => {
				console.error("[pool-manager] health tick failed:", err);
			});
		}, this.healthIntervalMs);

		if (typeof this.healthTimer.unref === "function") {
			this.healthTimer.unref();
		}
	}

	stopHealthMonitor() {
		if (!this.healthTimer) return;
		clearInterval(this.healthTimer);
		this.healthTimer = null;
	}

	async shutdown(opts = {}) {
		this.stopHealthMonitor();
		if (opts.destroyPoolOnShutdown === true) {
			await this.warmPool.destroyPool();
		}
	}

	async markAsDeadAndSpawnNew(id, reason = "unknown") {
		const targetSize = Math.min(
			this.maxPoolSize,
			Math.max(this.minPoolSize, this.pool.size),
		);

		const ctr = this.docker.getContainer(id);
		await this._safeStopRemove(ctr);

		this.pool.delete(id);
		this.idle.delete(id);
		this.busy.delete(id);

		while (this.pool.size < targetSize) {
			const rec = await this.warmPool._spawnOne(this.warmPool._nextContainerName());
			this.warmPool._trackAsIdle(rec);
		}

		console.warn(
			`[pool-manager] container replaced (${id}), reason=${reason}, total=${this.pool.size}`,
		);
	}

	async _runJobOnContainer(container, job, runJob) {
		try {
			return await runJob(container, job);
		} finally {
			await this.releaseContainer(container.id).catch(() => null);
		}
	}

	async _healthTick() {
		const ids = [...this.pool.keys()];
		for (const id of ids) {
			const healthy = await this._isContainerHealthy(id);
			if (!healthy) {
				await this.markAsDeadAndSpawnNew(id, "health_check_failed");
			}
		}
		await this.processQueue();
		await this._scaleDownIfIdleSurplus();
	}

	async _scaleUpAndAcquire(reason = "load") {
		if (this.pool.size >= this.maxPoolSize) return null;
		if (!this._canScaleUpByMemory()) return null;

		if (!this.scaleUpInFlight) {
			this.scaleUpInFlight = (async () => {
				const rec = await this.warmPool._spawnOne(this.warmPool._nextContainerName());
				this.warmPool._trackAsIdle(rec);

				console.log(
					`[pool-manager] auto-scale up (${reason}) total=${this.pool.size}/${this.maxPoolSize}`,
				);

				return rec;
			})().finally(() => {
				this.scaleUpInFlight = null;
			});
		}

		try {
			await this.scaleUpInFlight;
		} catch (err) {
			console.warn("[pool-manager] auto-scale up failed:", err);
			return null;
		}

		return this.acquireContainer();
	}

	_canScaleUpByMemory() {
		const perContainerBytes = Number(this.warmPool.memoryLimitBytes || 0);
		if (perContainerBytes <= 0) return true;

		const freeBytes = os.freemem();
		return freeBytes - perContainerBytes >= this.minSystemFreeRamBytes;
	}

	async _scaleDownIfIdleSurplus() {
		if (this.pool.size <= this.minPoolSize) return;
		if (this.idle.size <= this.minPoolSize) return;

		const queued = typeof this.queue.size === "function" ? this.queue.size() : 0;
		if (queued > 0) return;

		const surplusId = this.idle.values().next().value;
		if (!surplusId) return;

		await this._safeStopRemove(this.docker.getContainer(surplusId));

		this.pool.delete(surplusId);
		this.idle.delete(surplusId);
		this.busy.delete(surplusId);

		console.log(
			`[pool-manager] auto-scale down removed=${surplusId} total=${this.pool.size}/${this.maxPoolSize}`,
		);
	}

	async _isContainerHealthy(id) {
		const ctr = this.docker.getContainer(id);
		try {
			const info = await ctr.inspect();
			const state = info.State || {};

			if (state.Running !== true) return false;
			if (state.Dead === true) return false;
			if (state.OOMKilled === true) return false;

			// Probe nhẹ để biết container còn phản hồi (thay cho TCP ping khi network=none).
			const probe = await ctr.exec({
				Cmd: ["sh", "-lc", "echo ok >/dev/null"],
				AttachStdout: false,
				AttachStderr: false,
			});

			await this._withTimeout(
				probe.start({ hijack: true, stdin: false }),
				this.healthProbeTimeoutMs,
				"health probe timeout",
			);

			return true;
		} catch (_) {
			return false;
		}
	}

	async _safeStopRemove(ctr) {
		try {
			await ctr.stop({ t: 0 });
		} catch (_) {}

		try {
			await ctr.remove({ force: true });
		} catch (_) {}
	}

	_withTimeout(promise, timeoutMs, reason) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
			promise
				.then((v) => {
					clearTimeout(timer);
					resolve(v);
				})
				.catch((err) => {
					clearTimeout(timer);
					reject(err);
				});
		});
	}
}

module.exports = {
	MasterPoolManager,
	InMemoryJobQueue,
};
