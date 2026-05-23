 
// MAIN PROCESS — Entry point (slim)
// IPC handlers được tách vào src/main/ipc-*.js
 
const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require("electron");
const { buildTree } = require("./src/main/file-utils.js");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.TCP_AUTO_CONNECT = "0";
const tcpClient = require("./src/socket/tcpClient.js");

const { registerFileIPC } = require("./src/main/ipc-file");
const { registerMenuIPC } = require("./src/main/ipc-menu");
const { registerWindowIPC } = require("./src/main/ipc-window");
const { registerTerminalIPC } = require("./src/main/ipc-terminal");
const { syncManager, setupSyncIPC } = require("./src/main/sync-service.js");

let mainWindow;
let tcpBootstrapped = false;
let currentToken = null;
let currentProjectId = null;   // Active project ID (set after folder open + project create)
let currentWorkspaceRoot = null; // Absolute path to the workspace root folder
let originalProjectId = null;    // Lưu lại project ID gốc trước khi join room
let originalWorkspaceRoot = null; // Lưu lại thư mục gốc trước khi join room
let currentRunId = null;       // Active code execution request ID
let isInCollabRoom = false;    // True khi đang trong collab room (Guest hoặc Host có guest)

function getToken() {
  return currentToken;
}

function getProjectId() {
  return currentProjectId;
}

function getWorkspaceRoot() {
  return currentWorkspaceRoot;
}

// ---- Tạo cửa sổ chính ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
    icon: path.join(__dirname, "logo.png"),
  });
  mainWindow.loadFile("index.html");
  Menu.setApplicationMenu(null);
}

// ---- App lifecycle ----
app.whenReady().then(() => {
  createWindow();

  mainWindow.webContents.on('console-message', (event, levelOrDetails, message, line, sourceId) => {
    if (typeof levelOrDetails === 'object') {
      console.log(`[Renderer] ${levelOrDetails.message} (${levelOrDetails.sourceId}:${levelOrDetails.line})`);
    } else {
      console.log(`[Renderer] ${message} (${sourceId}:${line})`);
    }
  });

  // Đăng ký IPC một lần sau khi window được tạo
  registerFileIPC(mainWindow);
  registerMenuIPC(mainWindow);
  registerWindowIPC(mainWindow);
  registerTerminalIPC(mainWindow, getWorkspaceRoot);
  setupSyncIPC(getToken, getProjectId, getWorkspaceRoot);

  // ---- SafeStorage: mã hóa/giải mã token bằng OS keychain ----
  // Linux: GNOME Keyring / KWallet | Windows: DPAPI
  ipcMain.handle("safe-storage:encrypt", (_event, plainText) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[SafeStorage] Encryption not available, storing as-is.");
        return plainText;
      }
      const encrypted = safeStorage.encryptString(plainText);
      return encrypted.toString("base64");
    } catch (err) {
      console.error("[SafeStorage] Encrypt error:", err);
      return plainText;
    }
  });

  ipcMain.handle("safe-storage:decrypt", (_event, base64Cipher) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return base64Cipher;
      }
      const buffer = Buffer.from(base64Cipher, "base64");
      return safeStorage.decryptString(buffer);
    } catch (err) {
      console.error("[SafeStorage] Decrypt error:", err);
      return "";
    }
  });

  ipcMain.on("login-success", (_event, token) => {
    try {
      if (typeof token !== "string" || token.trim() === "") return;
      currentToken = token.trim();
      tcpClient.setSession({ token: currentToken });
      if (!tcpBootstrapped) {
        tcpClient.connect();
        tcpBootstrapped = true;
      }
    } catch (err) {
      console.error("[Main] login-success error:", err.message || err);
    }
  });

  // ---- Project Management IPC ----
  // Renderer calls this when a folder is opened to create/get the project on the server
  ipcMain.handle("project:set", async (_event, { name, workspaceRoot }) => {
    try {
      currentWorkspaceRoot = workspaceRoot || null;

      if (!currentToken || !name) {
        console.warn(`[Main] project:set — no token or name, skipping API call. token=${!!currentToken}, name="${name}"`);
        currentProjectId = null;
        return { success: false, error: "Not logged in or no project name" };
      }

      // Call the server to create/get the project
      const response = await fetch("http://100.124.23.95:3000/api/project/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Project create failed (${response.status})`);
      }

      currentProjectId = data.project?.id || null;
      if (currentProjectId) {
        tcpClient.setSession({ roomId: String(currentProjectId) });
      } else {
        tcpClient.setSession({ roomId: "default" });
      }
      console.log(
        `[Main] Project set: id=${currentProjectId}, name="${name}", created=${data.created}`,
      );

      // Pre-load file versions from server → prevents false 409 conflicts on restart
      if (currentProjectId) {
        await syncManager.syncVersionsFromServer(currentToken, currentProjectId, currentWorkspaceRoot);
      }

      return { success: true, projectId: currentProjectId, created: data.created };
    } catch (err) {
      console.error("[Main] project:set error:", err.message || err);
      currentProjectId = null;
      return { success: false, error: err.message };
    }
  });

  // ---- GUEST ROOM MANAGEMENT ----
  ipcMain.handle("project:set_guest", async (_event, data) => {
    try {
      if (!currentToken || !data.projectId) {
        return { success: false, error: "Not logged in or missing project ID" };
      }
      if (!currentWorkspaceRoot || !currentWorkspaceRoot.includes("cbcode_guest_")) {
        originalProjectId = currentProjectId;
        originalWorkspaceRoot = currentWorkspaceRoot;
      }
      currentProjectId = data.projectId;
      tcpClient.setSession({ roomId: String(currentProjectId) });
      
      // Create a local temporary workspace for the guest
      const guestFolder = path.join(os.tmpdir(), "cbcode_guest_" + Date.now());
      fs.mkdirSync(guestFolder, { recursive: true });
      currentWorkspaceRoot = guestFolder;
      
      console.log(`[Main] Guest Project set: id=${currentProjectId}, name="${data.name}", root="${currentWorkspaceRoot}"`);
      isInCollabRoom = true;
      
      // We don't preload syncVersionsFromServer yet, wait for cloneGuestProject to finish
      return { success: true, workspaceRoot: currentWorkspaceRoot };
    } catch (err) {
      console.error("[Main] project:set_guest error:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.on("project:clone_guest", async (_event, data) => {
    try {
      console.log("[Main] Fetching full guest project clone...");
      const response = await fetch(`http://100.124.23.95:3000/api/project/clone?project_id=${data.projectId}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Clone failed");

      // Write files
      for (const file of payload.files) {
        if (!file.content && file.error) continue; // skip errored
        const absPath = path.join(currentWorkspaceRoot, file.path);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, file.content || "");
      }

      console.log(`[Main] Guest Project Cloned! ${payload.files.length} files written to ${currentWorkspaceRoot}`);
      
      // Sync local maps with server versions
      await syncManager.syncVersionsFromServer(currentToken, currentProjectId, currentWorkspaceRoot);
      
      // Tell renderer to open this folder
      const treeData = buildTree(currentWorkspaceRoot);
      mainWindow.webContents.send("folder-opened", {
        items: treeData,
        folderPath: currentWorkspaceRoot
      });
    } catch(err) {
      console.error("[Main] clone_guest error:", err);
    }
  });

  ipcMain.on("room:leave", () => {
    try {
      const guestFolderToClean = (currentWorkspaceRoot && currentWorkspaceRoot.includes("cbcode_guest_")) 
        ? currentWorkspaceRoot 
        : null;

      // Restore state FIRST
      currentProjectId = originalProjectId;
      currentWorkspaceRoot = originalWorkspaceRoot;
      if (currentProjectId) {
        tcpClient.setSession({ roomId: String(currentProjectId) });
      } else {
        tcpClient.setSession({ roomId: "default" });
      }
      isInCollabRoom = false;
      
      // Tell UI to restore original sidebar so files are closed
      if (currentWorkspaceRoot && fs.existsSync(currentWorkspaceRoot)) {
        const treeData = buildTree(currentWorkspaceRoot);
        mainWindow.webContents.send("folder-opened", {
          items: treeData,
          folderPath: currentWorkspaceRoot
        });
      } else {
        mainWindow.webContents.send("folder-opened", { items: [], folderPath: null });
      }

      // Cleanup guest folder safely after UI changes
      if (guestFolderToClean) {
        console.log(`[Main] Leaving room, clearing guest folder: ${guestFolderToClean}`);
        setTimeout(() => {
          try {
            fs.rmSync(guestFolderToClean, { recursive: true, force: true, maxRetries: 3 });
          } catch (e) {
            console.warn(`[Main] Could not delete guest folder immediately:`, e);
            // Fallback async delete
            fs.promises.rm(guestFolderToClean, { recursive: true, force: true }).catch(() => {});
          }
        }, 1000); // give UI time to close file handles
      }
    } catch (err) {
      console.error("[Main] room:leave error:", err);
    }
  });

  // ---- TERMINAL & EXECUTION ----
  tcpClient.setTerminalCallback((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      let outputText = "";
      if (typeof data === "string") outputText = data;
      else if (data && data.text) outputText = data.text;
      else if (data && data.stdout) outputText = data.stdout;
      else if (data && data.stderr) outputText = data.stderr;
      else outputText = JSON.stringify(data);
      
      console.log(`[Main] Sending terminal-output IPC: ${JSON.stringify(outputText)}`);
      mainWindow.webContents.send("terminal-output", outputText);
    }
  });

    tcpClient.setLintCallback((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("lint-result", data);
      }
    });

    tcpClient.setCollabCallback((dataBuf) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("collab-event", dataBuf);
      }
      // Intercept ROOM_EVENT (sub-type 4) để cập nhật isInCollabRoom cho main process
      // Host không bao giờ gọi project:set_guest, nên cần lấy thông tin từ Gateway
      if (dataBuf && dataBuf.length >= 2 && dataBuf[0] === 4) {
        const otherMemberCount = dataBuf[1] || 0;
        isInCollabRoom = otherMemberCount > 0;
        console.log(`[Main] ROOM_EVENT: ${otherMemberCount} other member(s), isInCollabRoom=${isInCollabRoom}`);
      }
    });

  tcpClient.setFsEventCallback(async (data) => {
    try {
      const event = typeof data === "string" ? JSON.parse(data) : data;
      if (currentProjectId && String(event.projectId) === String(currentProjectId)) {
        const absolutePath = path.join(currentWorkspaceRoot, event.filepath);
        if (event.action === "update") {
          // Khi đang trong collab room, SKIP việc forward remote-file-update.
          // CRDT là nguồn sự thật, không cho SyncService ghi đè model.
          if (!isInCollabRoom) {
            console.log(`[Main] Received FS_EVENT update for ${event.filepath}, asking renderer...`);
            if (mainWindow && !mainWindow.isDestroyed()) {
               mainWindow.webContents.send("remote-file-update", {
                 filepath: absolutePath,
                 relPath: event.filepath,
                 projectId: currentProjectId,
                 workspaceRoot: currentWorkspaceRoot,
                 token: currentToken
               });
            }
          } else {
            console.log(`[Main] Skipping FS_EVENT update for ${event.filepath} (in collab room)`);
          }
        } else if (event.action === "delete") {
          console.log(`[Main] Received FS_EVENT delete for ${event.filepath}, removing locally...`);
          if (fs.existsSync(absolutePath)) {
             fs.rmSync(absolutePath, { force: true });
          }
          syncManager.fileVersions.delete(absolutePath);
          syncManager.fileHashes.delete(absolutePath);
          await syncManager.saveLocalState(currentWorkspaceRoot);
        }
        // Forward to UI to update file tree
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("fs-event", event);
        }
      }
    } catch (err) {
      console.error("[Main] FS_EVENT handle error:", err);
    }
  });

  // ---- Smart Realtime Sync IPC ----
  ipcMain.handle("sync:trigger-conflict", async (event, { filepath, relPath, localContent, projectId, token }) => {
    try {
      const cloudData = await syncManager.pullFromCloud(relPath, token, projectId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("sync:conflict", {
          filepath,
          relPath,
          localContent,
          cloudContent: cloudData.content,
          cloudVersion: cloudData.version,
          projectId
        });
      }
    } catch(err) {
      console.error("[Main] sync:trigger-conflict error:", err);
    }
  });

  ipcMain.handle("sync:safe-pull-and-reload", async (event, { filepath, projectId, token, workspaceRoot }) => {
    try {
      // Đọc nội dung hiện tại trên disk TRƯỚC khi pull từ cloud
      const fs = require("fs");
      const existingContent = fs.existsSync(filepath)
        ? fs.readFileSync(filepath, "utf8")
        : null;

      await syncManager.pullAndSaveLocal(filepath, token, projectId, workspaceRoot);

      if (mainWindow && !mainWindow.isDestroyed()) {
        if (fs.existsSync(filepath)) {
          const content = fs.readFileSync(filepath, "utf8");

          // Nếu nội dung cloud giống hệt local → bỏ qua reload.
          // Trường hợp này xảy ra khi A vừa Ctrl+S và nhận lại chính
          // FS_EVENT của mình → cloud content = local content vừa save.
          // Gọi model.setValue() sẽ reset cursor về đầu file không cần thiết.
          if (content === existingContent) {
            console.log(`[Main] safe-pull-and-reload: content unchanged for ${filepath}, skip reload.`);
            return;
          }

          mainWindow.webContents.send("reload-tab-content", { filepath, content });
        }
      }
    } catch(err) {
      console.error("[Main] sync:safe-pull-and-reload error:", err);
    }
  });

  ipcMain.on("request-delete-file", async (_event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
      if (currentProjectId) {
        await syncManager.deleteCloudFile(filePath, currentToken, currentProjectId, currentWorkspaceRoot);
      }
    } catch (e) {
      console.error("[Main] Delete file error:", e);
    }
  });

  ipcMain.on("lint-code", (_event, data) => {
    const lintId = "lint_" + Date.now();
    tcpClient.send(tcpClient.TYPE.LINT, lintId, {
      action: "lint",
      language: data.lang,
      code: data.code,
      projectId: currentProjectId
    }, { encrypt: true });
  });

  ipcMain.on("run-code", (_event, data) => {
    console.log(`[Main] Requesting remote code execution (lang: ${data.lang})...`);
    currentRunId = "run_" + Date.now();
    const success = tcpClient.send(tcpClient.TYPE.RUN, currentRunId, {
       action: "execute",
       language: data.lang,
       code: data.code,
       projectId: currentProjectId,
       entryPoint: data.entryPoint || "main.cpp"
    }, { encrypt: true });
    
    if (!success) {
       console.log("[Main] Server offline, code execution aborted.");
       if (mainWindow && !mainWindow.isDestroyed()) {
         mainWindow.webContents.send("terminal-output", "\r\n\x1b[1;31m[Error] ❌ Server is currently offline. Cannot execute code.\x1b[0m\r\n[Process Exited: 1]");
         mainWindow.webContents.send("show-toast", { message: "Server is offline. Cannot run code.", type: "error" });
       }
    }
  });

  ipcMain.on("run-input", (_event, inputData) => {
    console.log(`[Main] Sending run-input for ${currentRunId}: ${JSON.stringify(inputData)}`);
    if (currentRunId) {
      tcpClient.send(tcpClient.TYPE.INPUT, currentRunId, Buffer.from(inputData, 'utf8'), { encrypt: true });
    }
  });

  ipcMain.on("send-collab-data", (_event, dataBuf) => {
    // Send binary collab frame directly via TCP
    tcpClient.sendCollab(dataBuf);
  });

  app.on("activate", () => {
    // macOS: mở lại window khi click icon Dock mà không có window nào
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    if (currentWorkspaceRoot && currentWorkspaceRoot.includes("cbcode_guest_")) {
      console.log(`[Main] App quitting, clearing guest folder: ${currentWorkspaceRoot}`);
      fs.rmSync(currentWorkspaceRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  } catch (e) {
    console.error("[Main] Error cleaning up guest folder on quit:", e);
  }
});

// Export getters so ipc-file.js can access the current session state
module.exports = { getToken, getProjectId, getWorkspaceRoot };
