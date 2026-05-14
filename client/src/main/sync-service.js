const fs = require('node:fs/promises');
const path = require('node:path');
const DiffMatchPatch = require('diff-match-patch');
const { BrowserWindow, ipcMain } = require('electron');

class SyncManager {
  constructor() {
    this.dmp = new DiffMatchPatch();
    this.baseStates = new Map();
    this.apiBaseUrl = "http://100.124.23.95:3000/api/sync/file";
  }

  updateBase(filepath, content) {
    this.baseStates.set(filepath, content);
  }

  /**
   * Fetch file content from MinIO via the Auth Service API.
   * @param {string} filepath - Relative filepath used as the S3 key suffix
   * @param {string} token - JWT Bearer token
   * @returns {string} The file content from cloud, or "" if not found
   */
  async fetchCloudContent(filepath, token) {
    const url = `${this.apiBaseUrl}?filepath=${encodeURIComponent(filepath)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Cloud fetch failed (${response.status})`);
    }

    const data = await response.json();
    return data.content ?? "";
  }

  /**
   * Push file content to MinIO via the Auth Service API.
   * @param {string} filepath - Relative filepath used as the S3 key suffix
   * @param {string} content - File content to upload
   * @param {string} token - JWT Bearer token
   */
  async pushToCloud(filepath, content, token) {
    const response = await fetch(this.apiBaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filepath, content }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Cloud push failed (${response.status})`);
    }

    const data = await response.json();
    return data;
  }

  /**
   * Smart 3-way merge sync: compares Local, Cloud, and Base states.
   * @param {string} filepath - Absolute path to the local file
   * @param {string} token - JWT Bearer token for API calls
   */
  async autoSync(filepath, token) {
    if (!token) {
      console.warn("[SyncService] No token provided, skipping sync.");
      return;
    }

    try {
      // a) Fetch localContent and cloudContent
      let localContent;
      try {
        localContent = await fs.readFile(filepath, 'utf8');
      } catch (err) {
        console.error(`[SyncService] Error reading local file ${filepath}:`, err);
        return;
      }

      // Use the file's basename as the cloud key (relative path)
      const cloudKey = path.basename(filepath);

      let cloudContent;
      try {
        cloudContent = await this.fetchCloudContent(cloudKey, token);
      } catch (err) {
        console.error(`[SyncService] Error fetching cloud file ${cloudKey}:`, err);
        return;
      }

      // b) Fetch baseContent
      const baseContent = this.baseStates.get(filepath) || cloudContent;

      if (localContent === cloudContent && localContent === baseContent) {
        console.log(`[SyncService] File ${filepath} is in sync.`);
        return;
      }

      // c) Case 1: Clean Local Update (Fast-forward push)
      if (cloudContent === baseContent && localContent !== baseContent) {
        console.log(`[SyncService] Clean Local Update for ${filepath}. Pushing to cloud.`);
        try {
          await this.pushToCloud(cloudKey, localContent, token);
        } catch (err) {
          console.error(`[SyncService] Failed to push to cloud:`, err);
          return;
        }
        this.updateBase(filepath, localContent);
        return;
      }

      // d) Case 2: Clean Cloud Pull (Fast-forward pull)
      if (localContent === baseContent && cloudContent !== baseContent) {
        console.log(`[SyncService] Clean Cloud Pull for ${filepath}. Overwriting local.`);
        await fs.writeFile(filepath, cloudContent, 'utf8');
        this.updateBase(filepath, cloudContent);
        return;
      }

      // e) Case 3: Both Changed - Attempt Smart Auto-Merge
      if (localContent !== baseContent && cloudContent !== baseContent) {
        console.log(`[SyncService] Both changed for ${filepath}. Attempting 3-way merge...`);
        const patches = this.dmp.patch_make(baseContent, cloudContent);
        const [mergedText, results] = this.dmp.patch_apply(patches, localContent);

        if (results.includes(false)) {
          console.warn(`[SyncService] REAL CONFLICT detected for ${filepath}`);
          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0) {
            windows[0].webContents.send('sync:conflict', {
              filepath,
              localContent,
              cloudContent
            });
          }
        } else {
          console.log(`[SyncService] Smart Auto-Merge SUCCESS for ${filepath}.`);
          await fs.writeFile(filepath, mergedText, 'utf8');
          try {
            await this.pushToCloud(cloudKey, mergedText, token);
          } catch (err) {
            console.error(`[SyncService] Failed to push merged result:`, err);
          }
          this.updateBase(filepath, mergedText);
        }
      }
    } catch (error) {
      console.error("[SyncService] Background sync failed:", error);
    }
  }
}

const syncManager = new SyncManager();

function setupSyncIPC(getToken) {
  ipcMain.handle("sync:resolve", async (event, filepath, resolvedContent) => {
    try {
      await fs.writeFile(filepath, resolvedContent, 'utf8');
      console.log(`[SyncEngine] Conflict resolved locally for: ${filepath}`);

      // Push resolved content to Cloud (MinIO)
      const token = typeof getToken === "function" ? getToken() : null;
      if (token) {
        const cloudKey = path.basename(filepath);
        try {
          await syncManager.pushToCloud(cloudKey, resolvedContent, token);
          console.log(`[SyncEngine] Pushed resolved content to cloud for: ${filepath}`);
        } catch (err) {
          console.error("[SyncEngine] Failed to push resolved content to cloud:", err);
        }
      }

      // Update Base State
      syncManager.updateBase(filepath, resolvedContent);

      return { success: true };
    } catch (err) {
      console.error("[SyncEngine] Failed to resolve conflict:", err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { syncManager, SyncManager, setupSyncIPC };

