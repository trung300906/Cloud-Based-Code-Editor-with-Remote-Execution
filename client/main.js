// =====================================================================
// MAIN PROCESS — Entry point (slim)
// IPC handlers được tách vào src/main/ipc-*.js
// =====================================================================
const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require("electron");
const path = require("node:path");

process.env.TCP_AUTO_CONNECT = "0";
const tcpClient = require("./src/socket/tcpClient.js");

const { registerFileIPC } = require("./src/main/ipc-file");
const { registerMenuIPC } = require("./src/main/ipc-menu");
const { registerWindowIPC } = require("./src/main/ipc-window");
const { syncManager, setupSyncIPC } = require("./src/main/sync-service.js");

let mainWindow;
let tcpBootstrapped = false;
let currentToken = null;

function getToken() {
  return currentToken;
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

  // Đăng ký IPC một lần sau khi window được tạo
  registerFileIPC(mainWindow);
  registerMenuIPC(mainWindow);
  registerWindowIPC(mainWindow);
  setupSyncIPC(getToken);

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

  app.on("activate", () => {
    // macOS: mở lại window khi click icon Dock mà không có window nào
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Export getToken so ipc-file.js can access the current session token
module.exports = { getToken };

