// =====================================================================
// MAIN PROCESS — Entry point (slim)
// IPC handlers được tách vào src/main/ipc-*.js
// =====================================================================
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("node:path");

process.env.TCP_AUTO_CONNECT = "0";
const tcpClient = require("./src/socket/tcpClient.js");

const { registerFileIPC } = require("./src/main/ipc-file");
const { registerMenuIPC } = require("./src/main/ipc-menu");
const { registerWindowIPC } = require("./src/main/ipc-window");

let mainWindow;
let tcpBootstrapped = false;

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

  ipcMain.on("login-success", (_event, token) => {
    try {
      if (typeof token !== "string" || token.trim() === "") return;
      tcpClient.setSession({ token: token.trim() });
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
