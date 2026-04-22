// =====================================================================
// IPC WINDOW — win-minimize, win-close, win-reload, zoom, devtools, app-quit
// =====================================================================
const { ipcMain, app } = require("electron");

/**
 * Đăng ký IPC handler cho các thao tác cửa sổ / app.
 * @param {Electron.BrowserWindow} mainWindow
 */
function registerWindowIPC(mainWindow) {
  ipcMain.on("win-minimize", () => mainWindow?.minimize());
  ipcMain.on("win-close", () => mainWindow?.close());
  ipcMain.on("win-reload", () => mainWindow?.reload());

  ipcMain.on("win-toggle-fullscreen", () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  ipcMain.on("win-toggle-devtools", () =>
    mainWindow?.webContents.toggleDevTools(),
  );

  ipcMain.on("win-zoom-in", () => {
    if (mainWindow)
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() + 0.5,
      );
  });

  ipcMain.on("win-zoom-out", () => {
    if (mainWindow)
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() - 0.5,
      );
  });

  ipcMain.on("win-reset-zoom", () => {
    if (mainWindow) mainWindow.webContents.setZoomLevel(0);
  });

  ipcMain.on("app-quit", () => app.quit());
}

module.exports = { registerWindowIPC };
