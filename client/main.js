 
// MAIN PROCESS — Entry point (slim)
// IPC handlers được tách vào src/main/ipc-*.js
 
const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require("electron");
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
      currentProjectId = data.projectId;
      
      // Create a local temporary workspace for the guest
      const guestFolder = path.join(os.tmpdir(), "cbcode_guest_" + Date.now());
      fs.mkdirSync(guestFolder, { recursive: true });
      currentWorkspaceRoot = guestFolder;
      
      console.log(`[Main] Guest Project set: id=${currentProjectId}, name="${data.name}", root="${currentWorkspaceRoot}"`);
      
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
      mainWindow.webContents.send("folder-opened", {
        path: currentWorkspaceRoot,
        name: path.basename(currentWorkspaceRoot)
      });
    } catch(err) {
      console.error("[Main] clone_guest error:", err);
    }
  });

  ipcMain.on("room:leave", () => {
    try {
      if (currentWorkspaceRoot && currentWorkspaceRoot.includes("cbcode_guest_")) {
        console.log(`[Main] Leaving room, clearing guest folder: ${currentWorkspaceRoot}`);
        fs.rmSync(currentWorkspaceRoot, { recursive: true, force: true });
      }
      currentProjectId = null;
      currentWorkspaceRoot = null;
      // Tell UI to clear sidebar
      mainWindow.webContents.send("folder-opened", { path: null, name: "" });
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

  ipcMain.on("run-code", (_event, data) => {
    console.log(`[Main] Requesting remote code execution (lang: ${data.lang})...`);
    tcpClient.send(tcpClient.TYPE.RUN, "run_" + Date.now(), {
       action: "execute",
       language: data.lang,
       code: data.code,
       projectId: currentProjectId,
       entryPoint: data.entryPoint || "main.cpp"
    }, { encrypt: true });
  });

  app.on("activate", () => {
    // macOS: mở lại window khi click icon Dock mà không có window nào
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Export getters so ipc-file.js can access the current session state
module.exports = { getToken, getProjectId, getWorkspaceRoot };
