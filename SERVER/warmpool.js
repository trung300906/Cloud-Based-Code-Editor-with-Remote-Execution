"use strict";

const Docker = require("dockerode");
const os = require("os");
const tar = require("tar-fs");
const path = require("path");
const fs = require("node:fs");

class WarmPoolBootstrapper {
  constructor(opts = {}) {
    this.docker = opts.docker || new Docker(opts.dockerOptions || undefined);

    this.image =
      opts.image || process.env.SANDBOX_IMAGE || "ide-sandbox:latest";
    this.poolSize = Number(opts.poolSize ?? process.env.MIN_POOL ?? 2);
    this.namePrefix =
      opts.namePrefix || process.env.POOL_NAME_PREFIX || "zera-sandbox";
    this.nodeId = opts.nodeId || process.env.NODE_ID || os.hostname();

    this.workspaceSize =
      opts.workspaceSize || process.env.WORKSPACE_TMPFS_SIZE || "32m";
    this.tmpSize = opts.tmpSize || process.env.TMP_TMPFS_SIZE || "16m";
    this.memoryLimitBytes = Number(
      opts.memoryLimitBytes ??
        process.env.CONTAINER_MEMORY_BYTES ??
        100 * 1024 * 1024,
    );
    this.nanoCpus = Number(
      opts.nanoCpus ?? process.env.CONTAINER_NANO_CPUS ?? 500000000,
    ); // 0.5 CPU
    this.pidsLimit = Number(
      opts.pidsLimit ?? process.env.CONTAINER_PIDS_LIMIT ?? 128,
    );

    this.user = opts.user || process.env.SANDBOX_USER || "10001:10001";
    this.keepAliveCmd = opts.keepAliveCmd || ["sleep", "infinity"];

    const identity = this._parseUserIdentity(this.user, opts);
    this.sandboxUid = identity.uid;
    this.sandboxGid = identity.gid;

    this.pullTimeoutMs = Number(
      opts.pullTimeoutMs ?? process.env.IMAGE_PULL_TIMEOUT_MS ?? 60000,
    );
    this.pullRetries = Number(
      opts.pullRetries ?? process.env.IMAGE_PULL_RETRIES ?? 2,
    );
    this.expectedImageId = null;

    this.pool = new Map(); // id -> record
    this.idle = new Set(); // container ids
    this.busy = new Set(); // container ids
  }

  async bootstrap() {
    await this.ensureImage();

    const reused = await this._findReusableContainers();
    reused.forEach((rec) => this._trackAsIdle(rec));

    const missing = Math.max(0, this.poolSize - this.pool.size);
    for (let i = 0; i < missing; i += 1) {
      const rec = await this._spawnOne(this._nextContainerName());
      this._trackAsIdle(rec);
    }

    return this.snapshot();
  }

  getContainerIds() {
    return [...this.pool.keys()];
  }

  snapshot() {
    return [...this.pool.values()].map((x) => ({ ...x }));
  }

  acquireIdle() {
    const firstIdle = this.idle.values().next();
    if (firstIdle.done) return null;

    const id = firstIdle.value;
    this.idle.delete(id);
    this.busy.add(id);

    const rec = this.pool.get(id);
    if (rec) {
      rec.status = "BUSY";
      rec.lastUsedAt = Date.now();
    }
    return rec || null;
  }

  release(id) {
    if (!this.pool.has(id)) return false;
    this.busy.delete(id);
    this.idle.add(id);
    const rec = this.pool.get(id);
    rec.status = "IDLE";
    rec.lastUsedAt = Date.now();
    return true;
  }

  async destroyPool() {
    for (const rec of this.pool.values()) {
      const ctr = this.docker.getContainer(rec.id);
      try {
        await ctr.stop({ t: 0 });
      } catch (_) {}
      try {
        await ctr.remove({ force: true });
      } catch (_) {}
    }

    this.pool.clear();
    this.idle.clear();
    this.busy.clear();
  }

  // Hàm hỗ trợ build tách riêng cho sạch code
  async _buildImageLocally() {
    const tarStream = tar.pack(__dirname, {
      ignore: (name) => name.includes("node_modules") || name.includes(".git"),
    });

    const stream = await this.docker.buildImage(tarStream, { t: this.image });
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err, res) => {
        if (err) return reject(err);
        const hasError = res.find((r) => r.error);
        if (hasError) return reject(new Error(hasError.error));
        resolve(res);
      });
    });
  }

  async ensureImage() {
    try {
      const info = await this.docker.getImage(this.image).inspect();
      this.expectedImageId = info.Id;
      console.log(`[warm-pool] Found image locally: ${this.image}`);
      return;
    } catch (err) {
      if (!err || err.statusCode !== 404) throw err;
    }

    const dockerfilePath = path.join(__dirname, "Dockerfile");
    if (fs.existsSync(dockerfilePath)) {
      try {
        console.log(`[warm-pool] Dockerfile found. Attempting local build...`);
        await this._buildImageLocally();

        const info = await this.docker.getImage(this.image).inspect();
        this.expectedImageId = info.Id;
        return; // Build xong thì thoát luôn
      } catch (buildErr) {
        console.warn(
          `[warm-pool] Local build failed, falling back to pull: ${buildErr.message}`,
        );
      }
    }

    console.log(`[warm-pool] Pulling image ${this.image} from registry...`);
    let lastErr = null;
    const maxAttempts = Math.max(1, this.pullRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this._withTimeout(
          this._pullImageOnce(),
          this.pullTimeoutMs,
          "image pull timeout after " + this.pullTimeoutMs + "ms",
        );

        const info = await this.docker.getImage(this.image).inspect();
        this.expectedImageId = info.Id;
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          await this._sleep(Math.min(5000, attempt * 1000));
        }
      }
    }

    throw new Error(
      "Failed to ensure image " +
        this.image +
        ": " +
        String(lastErr && lastErr.message ? lastErr.message : lastErr),
    );
  }

  _parseUserIdentity(user, opts = {}) {
    const fallbackUid = String(
      opts.sandboxUid ?? process.env.SANDBOX_UID ?? "10001",
    );
    const fallbackGid = String(
      opts.sandboxGid ?? process.env.SANDBOX_GID ?? fallbackUid,
    );
    const raw = String(user || "").trim();

    if (/^[0-9]+:[0-9]+$/.test(raw)) {
      const parts = raw.split(":");
      return { uid: parts[0], gid: parts[1] };
    }

    if (/^[0-9]+$/.test(raw)) {
      return { uid: raw, gid: fallbackGid };
    }

    return { uid: fallbackUid, gid: fallbackGid };
  }

  _pullImageOnce() {
    return new Promise((resolve, reject) => {
      this.docker.pull(this.image, (err, stream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (doneErr) => {
          if (doneErr) return reject(doneErr);
          resolve();
        });
      });
    });
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

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _sameStringArray(a, b) {
    const aa = Array.isArray(a) ? a.map((x) => String(x)) : [];
    const bb = Array.isArray(b) ? b.map((x) => String(x)) : [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }

  _matchesExpectedContainer(info) {
    const cfg = info.Config || {};
    const hc = info.HostConfig || {};
    const tmpfs = hc.Tmpfs || {};

    const ws = String(tmpfs["/workspace"] || "");
    const tmp = String(tmpfs["/tmp"] || "");

    const imageById = this.expectedImageId
      ? info.Image === this.expectedImageId
      : false;
    const imageByTag = String(cfg.Image || "") === String(this.image);
    const imageMatches = imageById || imageByTag;

    const wsTmpfsMatches =
      ws.includes("size=" + this.workspaceSize) &&
      ws.includes("uid=" + this.sandboxUid) &&
      ws.includes("gid=" + this.sandboxGid);

    const tmpTmpfsMatches = tmp.includes("size=" + this.tmpSize);

    return (
      imageMatches &&
      this._sameStringArray(cfg.Cmd, this.keepAliveCmd) &&
      String(cfg.User || "") === String(this.user) &&
      String(cfg.WorkingDir || "") === "/workspace" &&
      hc.ReadonlyRootfs === true &&
      String(hc.NetworkMode || "") === "none" &&
      Number(hc.Memory || 0) === this.memoryLimitBytes &&
      Number(hc.NanoCpus || 0) === this.nanoCpus &&
      Number(hc.PidsLimit || 0) === this.pidsLimit &&
      wsTmpfsMatches &&
      tmpTmpfsMatches
    );
  }

  async _safeRemove(ctr) {
    try {
      await ctr.stop({ t: 0 });
    } catch (_) {}
    try {
      await ctr.remove({ force: true });
    } catch (_) {}
  }

  async _findReusableContainers() {
    const filters = {
      label: ["zera.pool=warm", "zera.node=" + this.nodeId],
    };

    const list = await this.docker.listContainers({ all: true, filters });
    const sorted = list.sort((a, b) => {
      const an = (a.Names && a.Names[0]) || "";
      const bn = (b.Names && b.Names[0]) || "";
      return an.localeCompare(bn);
    });

    const records = [];
    for (const item of sorted) {
      const ctr = this.docker.getContainer(item.Id);

      let info;
      try {
        info = await ctr.inspect();
      } catch (_) {
        continue;
      }

      if (!this._matchesExpectedContainer(info)) {
        await this._safeRemove(ctr);
        continue;
      }

      if (records.length >= this.poolSize) {
        await this._safeRemove(ctr);
        continue;
      }

      try {
        if (!info.State || info.State.Running !== true) {
          await ctr.start();
          info = await ctr.inspect();
        }
      } catch (_) {
        await this._safeRemove(ctr);
        continue;
      }

      records.push({
        id: info.Id,
        name: String(info.Name || "").replace(/^\//, ""),
        status: "IDLE",
        createdAt: Date.now(),
        lastUsedAt: null,
        nodeId: this.nodeId,
      });
    }

    return records;
  }

  async _spawnOne(name) {
    const container = await this.docker.createContainer({
      Image: this.image,
      name,
      Cmd: this.keepAliveCmd,
      User: this.user,
      WorkingDir: "/workspace",
      Labels: {
        "zera.pool": "warm",
        "zera.node": this.nodeId,
      },
      HostConfig: {
        ReadonlyRootfs: true,
        NetworkMode: "none",
        Tmpfs: {
          "/workspace":
            "rw,size=" +
            this.workspaceSize +
            ",uid=" +
            this.sandboxUid +
            ",gid=" +
            this.sandboxGid +
            ",mode=700",
          "/tmp": "rw,size=" + this.tmpSize + ",mode=1777",
        },
        Memory: this.memoryLimitBytes,
        NanoCpus: this.nanoCpus,
        PidsLimit: this.pidsLimit,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
      },
    });

    await container.start();
    const info = await container.inspect();

    return {
      id: info.Id,
      name: info.Name.replace(/^\//, ""),
      status: "IDLE",
      createdAt: Date.now(),
      lastUsedAt: null,
      nodeId: this.nodeId,
    };
  }

  _trackAsIdle(rec) {
    this.pool.set(rec.id, rec);
    this.idle.add(rec.id);
    this.busy.delete(rec.id);
  }

  _nextContainerName() {
    let n = this.pool.size + 1;
    for (;;) {
      const candidate = `${this.namePrefix}-${this.nodeId}-${n}`;
      const exists = [...this.pool.values()].some((r) => r.name === candidate);
      if (!exists) return candidate;
      n += 1;
    }
  }
}

module.exports = { WarmPoolBootstrapper };

if (require.main === module) {
  (async () => {
    const warmPool = new WarmPoolBootstrapper({
      poolSize: Number(process.env.MIN_POOL || 2),
      image: process.env.SANDBOX_IMAGE || "ide-sandbox:latest",
    });

    const state = await warmPool.bootstrap();
    console.log(
      "[warm-pool] ready:",
      state.map((x) => ({ name: x.name, id: x.id, status: x.status })),
    );
  })().catch((err) => {
    console.error("[warm-pool] bootstrap failed:", err);
    process.exitCode = 1;
  });
}
