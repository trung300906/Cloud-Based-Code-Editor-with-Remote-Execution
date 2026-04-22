// =====================================================================
// MAIN PROCESS — Entry point (slim)
// IPC handlers được tách vào src/main/ipc-*.js
// =====================================================================
const { app, BrowserWindow, Menu } = require('electron');
const path                         = require('node:path');

const { registerFileIPC }   = require('./src/main/ipc-file');
const { registerMenuIPC }   = require('./src/main/ipc-menu');
const { registerWindowIPC } = require('./src/main/ipc-window');

let mainWindow;

// ---- Tạo cửa sổ chính ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, 'bleh.jpg'),
  });
  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);
}

// ---- App lifecycle ----
app.whenReady().then(() => {
  createWindow();

  // Đăng ký IPC một lần sau khi window được tạo
  registerFileIPC(mainWindow);
  registerMenuIPC(mainWindow);
  registerWindowIPC(mainWindow);

  app.on('activate', () => {
    // macOS: mở lại window khi click icon Dock mà không có window nào
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
