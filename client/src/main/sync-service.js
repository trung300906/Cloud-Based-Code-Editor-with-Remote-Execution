// SYNC SERVICE — OCC-based Git-like Sync Engine (Phase 2)
// Uses version tracking + 409 Conflict handling with 3-way merge

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const DiffMatchPatch = require("diff-match-patch");
const { BrowserWindow, ipcMain } = require("electron");

const API_BASE = "http://100.84.67.110:3000/api";

class SyncManager {
  constructor() {
    this.dmp = new DiffMatchPatch();
    this.baseStates = new Map(); // Key: filepath, Value: string content
    this.fileVersions = new Map(); // Key: filepath, Value: integer version
    this.fileHashes = new Map(); // Key: filepath, Value: string hash
  }

  async loadLocalState(workspaceRoot) {
    if (!workspaceRoot) return {};
    try {
      const data = await fs.readFile(
        path.join(workspaceRoot, ".zera", "sync-state.json"),
        "utf-8",
      );
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  }

  async saveLocalState(workspaceRoot) {
    if (!workspaceRoot) return;
    try {
      const stateObj = {};
      for (const [filepath, version] of this.fileVersions.entries()) {
        const rel = this.getRelativePath(filepath, workspaceRoot);
        stateObj[rel] = { version, hash: this.fileHashes.get(filepath) || "" };
      }
      const zeraDir = path.join(workspaceRoot, ".zera");
      await fs.mkdir(zeraDir, { recursive: true });
      await fs.writeFile(
        path.join(zeraDir, "sync-state.json"),
        JSON.stringify(stateObj, null, 2),
      );
    } catch (e) {
      console.warn("[SyncService] Failed to save local sync state:", e);
    }
  }

  updateBase(filepath, content) {
    this.baseStates.set(filepath, content);
  }

  getVersion(filepath) {
    return this.fileVersions.get(filepath) || 0;
  }

  setVersion(filepath, version, hash = "") {
    this.fileVersions.set(filepath, version);
    if (hash) this.fileHashes.set(filepath, hash);
  }

  /**
   * Compute relative path from the workspace root folder.
   * e.g. /home/user/CBCode_Workspace/project/src/main.cpp → src/main.cpp
   * Falls back to basename if no workspace context.
   */
  getRelativePath(filepath, workspaceRoot) {
    if (workspaceRoot && filepath.startsWith(workspaceRoot)) {
      const rel = path.relative(workspaceRoot, filepath);
      return rel.split(path.sep).join("/"); // Normalize to forward slashes for S3
    }
    return path.basename(filepath);
  }

  // ── API: Push file to cloud with OCC version check ──
  async pushToCloud(filePath, content, token, version, projectId) {
    const response = await fetch(`${API_BASE}/project/sync/file`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: projectId,
        path: filePath,
        content,
        version,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 409) {
      // OCC Conflict — server version is ahead
      return { conflict: true, ...data };
    }

    if (!response.ok) {
      throw new Error(data.error || `Cloud push failed (${response.status})`);
    }

    return { conflict: false, ...data };
  }

  // ── API: Pull file content + metadata from cloud ──
  async pullFromCloud(filePath, token, projectId) {
    const url = `${API_BASE}/project/file?project_id=${projectId}&path=${encodeURIComponent(filePath)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 404) {
      return { exists: false, content: "", version: 0 };
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Cloud pull failed (${response.status})`);
    }

    const data = await response.json();
    return {
      exists: true,
      content: data.content ?? "",
      version: data.version ?? 1,
      hash: data.hash,
    };
  }

  // ── API: Delete file from cloud ──
  async deleteCloudFile(filePath, token, projectId, workspaceRoot) {
    const relPath = this.getRelativePath(filePath, workspaceRoot);
    const url = `${API_BASE}/project/file?project_id=${projectId}&path=${encodeURIComponent(relPath)}`;
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        console.log(`[SyncService] Deleted ${relPath} from server.`);
        this.fileVersions.delete(filePath);
        this.fileHashes.delete(filePath);
        await this.saveLocalState(workspaceRoot);
      } else {
        console.warn(
          `[SyncService] Failed to delete ${relPath} from server: ${response.status}`,
        );
      }
    } catch (err) {
      console.error(`[SyncService] Delete cloud error:`, err);
    }
  }

  // ── Action: Pull and save locally ──
  async pullAndSaveLocal(filePath, token, projectId, workspaceRoot) {
    try {
      const relPath = this.getRelativePath(filePath, workspaceRoot);
      const cloudData = await this.pullFromCloud(relPath, token, projectId);
      if (cloudData.exists) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, cloudData.content);
        this.setVersion(filePath, cloudData.version, cloudData.hash);
        this.updateBase(filePath, cloudData.content);
        await this.saveLocalState(workspaceRoot);
        console.log(`[SyncService] Pulled new file ${relPath} from server.`);
      }
    } catch (err) {
      console.error(`[SyncService] Pull and save error:`, err);
    }
  }

  // ── Handle Realtime FS_EVENT Update ──
  async handleRemoteUpdate(filePath, token, projectId, workspaceRoot) {
    try {
      // 1. Check if local file is modified
      let localContent = "";
      try {
        localContent = await fs.readFile(filePath, "utf-8");
      } catch (e) {}

      const localHash = crypto
        .createHash("md5")
        .update(localContent, "utf8")
        .digest("hex");
      const baseHash = this.fileHashes.get(filePath);

      if (!baseHash || localHash === baseHash) {
        // Local is unchanged. Safe to pull.
        console.log(
          `[SyncService] Local file unchanged. Safely pulling remote update for ${filePath}`,
        );
        await this.pullAndSaveLocal(filePath, token, projectId, workspaceRoot);
      } else {
        // Local IS MODIFIED! Do NOT overwrite! Trigger a conflict diff.
        console.log(
          `[SyncService] Local file IS MODIFIED! Triggering Conflict for ${filePath}`,
        );
        const relPath = this.getRelativePath(filePath, workspaceRoot);
        const cloudData = await this.pullFromCloud(relPath, token, projectId);

        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send("sync:conflict", {
            filepath: filePath,
            relPath,
            localContent,
            cloudContent: cloudData.content,
            cloudVersion: cloudData.version,
            projectId,
          });
        }
      }
    } catch (err) {
      console.error(`[SyncService] Handle remote update error:`, err);
    }
  }

  // ── Helper: Recursively get all files ignoring node_modules and .git ──
  async getAllFilesRecursive(dirPath) {
    const files = [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await this.getAllFilesRecursive(fullPath)));
        } else {
          // Check file size, ignore > 50MB
          try {
            const stats = await fs.stat(fullPath);
            if (stats.size <= 50 * 1024 * 1024) {
              files.push(fullPath);
            } else {
              console.warn(
                `[SyncService] Skipping large file (>50MB): ${fullPath}`,
              );
            }
          } catch (e) {}
        }
      }
    } catch (err) {}
    return files;
  }

  // ── Fetch ALL file versions from server and pre-populate local map ──
  // Called once when folder is opened — prevents false 409 conflicts on restart
  async syncVersionsFromServer(token, projectId, workspaceRoot) {
    try {
      const url = `${API_BASE}/project/files?project_id=${projectId}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!response.ok) {
        console.warn(
          "[SyncService] Failed to fetch file versions from server.",
        );
        return;
      }

      const data = await response.json();
      const files = data.files || [];
      const serverFilesMap = new Map();

      for (const file of files) {
        // Convert server relative path → local absolute path
        const localPath = workspaceRoot
          ? path.join(workspaceRoot, ...file.path.split("/"))
          : file.path;
        serverFilesMap.set(localPath, file);
      }

      console.log(
        `[SyncService] Pre-loaded ${files.length} file version(s) from server.`,
      );

      // ── AUTO RESCAN LOGIC ──
      if (workspaceRoot) {
        console.log(
          "[SyncService] Auto-scanning local files for offline changes...",
        );
        const localPaths = await this.getAllFilesRecursive(workspaceRoot);
        const localState = await this.loadLocalState(workspaceRoot);
        let changesDetected = 0;

        const localPathsSet = new Set(localPaths);

        // 1. Check for missing local files (offline delete vs new server file)
        for (const [serverPath, serverFile] of serverFilesMap.entries()) {
          if (!localPathsSet.has(serverPath)) {
            const relPath = this.getRelativePath(serverPath, workspaceRoot);
            if (localState[relPath]) {
              // We used to have it synced -> user deleted it offline!
              console.log(
                `[SyncService] Detected offline deletion for ${serverPath}, deleting from server...`,
              );
              this.deleteCloudFile(
                serverPath,
                token,
                projectId,
                workspaceRoot,
              ).catch(console.error);
              changesDetected++;
            } else {
              // We never had it -> someone else created it on server!
              console.log(
                `[SyncService] Detected new server file ${serverPath}, pulling...`,
              );
              this.pullAndSaveLocal(
                serverPath,
                token,
                projectId,
                workspaceRoot,
              ).catch(console.error);
              changesDetected++;
            }
          }
        }

        // 2. Check for local modifications & new local files
        for (const localPath of localPaths) {
          try {
            const content = await fs.readFile(localPath, "utf-8");
            const localHash = crypto
              .createHash("md5")
              .update(content, "utf8")
              .digest("hex");

            const serverFile = serverFilesMap.get(localPath);
            const relPath = this.getRelativePath(localPath, workspaceRoot);
            const baseFile = localState[relPath];

            if (!serverFile) {
              // Local is NEW
              console.log(
                `[SyncService] Detected new local file ${localPath}, pushing...`,
              );
              changesDetected++;
              this.setVersion(localPath, 0); // trigger insert
              this.autoSync(localPath, token, projectId, workspaceRoot).catch(
                console.error,
              );
            } else if (serverFile.hash !== localHash) {
              console.log(
                `[SyncService] Detected drift on ${localPath} (guest edits or offline edits). Pushing to trigger Diff...`,
              );
              changesDetected++;
              // Phục hồi version gốc trước khi push để chắc chắn server sẽ chặn lại bằng lỗi 409 Conflict
              // Nhờ đó, Host sẽ luôn được popup màn hình Diff để review code của Guest
              this.setVersion(localPath, baseFile ? baseFile.version : 0);
              this.autoSync(localPath, token, projectId, workspaceRoot).catch(
                console.error,
              );
            } else {
              // In sync
              this.setVersion(localPath, serverFile.version, serverFile.hash);
            }
          } catch (e) {}
        }

        await this.saveLocalState(workspaceRoot);

        if (changesDetected === 0) {
          console.log(
            "[SyncService] Local workspace is perfectly in sync with server.",
          );
        }
      }
    } catch (err) {
      console.error(
        "[SyncService] syncVersionsFromServer error:",
        err.message || err,
      );
    }
  }

  /**
   * Core OCC Sync — called on every Ctrl+S.
   * @param {string} filepath - Absolute path to local file
   * @param {string} token - JWT Bearer token
   * @param {number} projectId - Active project ID
   * @param {string} workspaceRoot - Workspace root folder (for computing relative path)
   */
  async autoSync(filepath, token, projectId, workspaceRoot) {
    if (!token) {
      console.warn("[SyncService] No token, skipping sync.");
      return;
    }
    if (!projectId) {
      console.warn("[SyncService] No project ID, skipping sync.");
      return;
    }

    try {
      // 1. Read local file
      let localContent;
      try {
        localContent = await fs.readFile(filepath, "utf8");
      } catch (err) {
        console.error(
          `[SyncService] Cannot read local file ${filepath}:`,
          err.message,
        );
        return;
      }

      // 2. Compute relative path for cloud key
      const relPath = this.getRelativePath(filepath, workspaceRoot);
      const localVersion = this.getVersion(filepath);

      // 3. Push with OCC version
      console.log(
        `[SyncService] Pushing ${relPath} (v${localVersion}) to project ${projectId}...`,
      );

      const result = await this.pushToCloud(
        relPath,
        localContent,
        token,
        localVersion,
        projectId,
      );

      if (result.conflict) {
        // ── 409 CONFLICT: Server version is ahead ──
        console.warn(
          `[SyncService] CONFLICT on ${relPath}: local v${localVersion} vs server v${result.current_version}`,
        );

        // Fetch the latest cloud content for the diff editor
        let cloudData;
        try {
          cloudData = await this.pullFromCloud(relPath, token, projectId);
        } catch (err) {
          console.error(
            "[SyncService] Failed to pull cloud version for conflict resolution:",
            err,
          );
          return;
        }

        // Emit conflict to renderer (Monaco Diff Editor)
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send("sync:conflict", {
            filepath,
            relPath,
            localContent,
            cloudContent: cloudData.content,
            cloudVersion: cloudData.version,
            projectId,
          });
        }
        return;
      }

      // ── SUCCESS: Update local version tracking ──
      this.setVersion(filepath, result.new_version, result.hash);
      this.updateBase(filepath, localContent);
      await this.saveLocalState(workspaceRoot);

      if (!result.skipped) {
        console.log(`[SyncService] Synced ${relPath} → v${result.new_version}`);
      } else {
        console.log(
          `[SyncService] ${relPath} unchanged, skipped. Fast-forwarded to v${result.new_version}.`,
        );
      }
    } catch (error) {
      console.error("[SyncService] Sync failed:", error.message || error);
    }
  }
}

const syncManager = new SyncManager();

/**
 * Setup IPC handlers for conflict resolution.
 * @param {Function} getToken - Callback to get current JWT token
 * @param {Function} getProjectId - Callback to get current project ID
 */
function setupSyncIPC(getToken, getProjectId, getWorkspaceRoot) {
  ipcMain.handle(
    "sync:resolve",
    async (_event, filepath, resolvedContent, cloudVersion) => {
      try {
        // 1. Write resolved content to local disk
        await fs.writeFile(filepath, resolvedContent, "utf8");
        console.log(`[SyncEngine] Conflict resolved locally for: ${filepath}`);

        // 2. Push resolved content with the CLOUD version (to pass OCC check)
        const token = typeof getToken === "function" ? getToken() : null;
        const projectId =
          typeof getProjectId === "function" ? getProjectId() : null;

        if (token && projectId) {
          const wsRoot =
            typeof getWorkspaceRoot === "function" ? getWorkspaceRoot() : null;
          const relPath = syncManager.getRelativePath(filepath, wsRoot);
          try {
            const result = await syncManager.pushToCloud(
              relPath,
              resolvedContent,
              token,
              cloudVersion, // Use the cloud version so OCC passes
              projectId,
            );

            if (result.conflict) {
              console.error(
                "[SyncEngine] Conflict still exists after resolution! Version:",
                result.current_version,
              );
              return {
                success: false,
                error: "Version conflict persists. Please try again.",
              };
            }

            // Update local version to the new server version
            syncManager.setVersion(filepath, result.new_version);
            syncManager.updateBase(filepath, resolvedContent);
            console.log(
              `[SyncEngine] Pushed resolved content → v${result.new_version}`,
            );
          } catch (err) {
            console.error("[SyncEngine] Failed to push resolved content:", err);
            return { success: false, error: err.message };
          }
        }

        return { success: true };
      } catch (err) {
        console.error("[SyncEngine] Failed to resolve conflict:", err);
        return { success: false, error: err.message };
      }
    },
  );
}

module.exports = { syncManager, SyncManager, setupSyncIPC };
