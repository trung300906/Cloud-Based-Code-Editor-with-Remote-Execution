// =====================================================================
// SYNC SERVICE — OCC-based Git-like Sync Engine (Phase 2)
// Uses version tracking + 409 Conflict handling with 3-way merge
// =====================================================================
const fs = require("node:fs/promises");
const path = require("node:path");
const DiffMatchPatch = require("diff-match-patch");
const { BrowserWindow, ipcMain } = require("electron");

const API_BASE = "http://100.124.23.95:3000/api";

class SyncManager {
  constructor() {
    this.dmp = new DiffMatchPatch();
    this.baseStates = new Map();     // Key: filepath, Value: string content
    this.fileVersions = new Map();   // Key: filepath, Value: integer version (from server)
  }

  updateBase(filepath, content) {
    this.baseStates.set(filepath, content);
  }

  getVersion(filepath) {
    return this.fileVersions.get(filepath) || 0;
  }

  setVersion(filepath, version) {
    this.fileVersions.set(filepath, version);
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

  // ── Fetch ALL file versions from server and pre-populate local map ──
  // Called once when folder is opened — prevents false 409 conflicts on restart
  async syncVersionsFromServer(token, projectId, workspaceRoot) {
    try {
      const url = `${API_BASE}/project/files?project_id=${projectId}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        console.warn("[SyncService] Failed to fetch file versions from server.");
        return;
      }

      const data = await response.json();
      const files = data.files || [];

      for (const file of files) {
        // Convert server relative path → local absolute path
        const localPath = workspaceRoot
          ? path.join(workspaceRoot, ...file.path.split("/"))
          : file.path;
        this.setVersion(localPath, file.version);
      }

      console.log(`[SyncService] Pre-loaded ${files.length} file version(s) from server.`);
    } catch (err) {
      console.error("[SyncService] syncVersionsFromServer error:", err.message || err);
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
        console.error(`[SyncService] Cannot read local file ${filepath}:`, err.message);
        return;
      }

      // 2. Compute relative path for cloud key
      const relPath = this.getRelativePath(filepath, workspaceRoot);
      const localVersion = this.getVersion(filepath);

      // 3. Push with OCC version
      console.log(`[SyncService] Pushing ${relPath} (v${localVersion}) to project ${projectId}...`);

      const result = await this.pushToCloud(relPath, localContent, token, localVersion, projectId);

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
          console.error("[SyncService] Failed to pull cloud version for conflict resolution:", err);
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
      if (!result.skipped) {
        this.setVersion(filepath, result.new_version);
        this.updateBase(filepath, localContent);
        console.log(`[SyncService] Synced ${relPath} → v${result.new_version}`);
      } else {
        console.log(`[SyncService] ${relPath} unchanged, skipped.`);
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
  ipcMain.handle("sync:resolve", async (_event, filepath, resolvedContent, cloudVersion) => {
    try {
      // 1. Write resolved content to local disk
      await fs.writeFile(filepath, resolvedContent, "utf8");
      console.log(`[SyncEngine] Conflict resolved locally for: ${filepath}`);

      // 2. Push resolved content with the CLOUD version (to pass OCC check)
      const token = typeof getToken === "function" ? getToken() : null;
      const projectId = typeof getProjectId === "function" ? getProjectId() : null;

      if (token && projectId) {
        const wsRoot = typeof getWorkspaceRoot === "function" ? getWorkspaceRoot() : null;
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
            console.error("[SyncEngine] Conflict still exists after resolution! Version:", result.current_version);
            return { success: false, error: "Version conflict persists. Please try again." };
          }

          // Update local version to the new server version
          syncManager.setVersion(filepath, result.new_version);
          syncManager.updateBase(filepath, resolvedContent);
          console.log(`[SyncEngine] Pushed resolved content → v${result.new_version}`);
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
  });
}

module.exports = { syncManager, SyncManager, setupSyncIPC };
