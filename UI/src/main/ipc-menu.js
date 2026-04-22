// =====================================================================
// IPC MENU — menu-new-file, menu-open-file, menu-open-folder, menu-save
// =====================================================================
const { ipcMain, dialog } = require("electron");
const fs = require("fs");
const { buildTree } = require("./file-utils");

/**
 * Đăng ký IPC handler cho các action từ custom menu bar (thay thế native menu).
 * @param {Electron.BrowserWindow} mainWindow
 */
function registerMenuIPC(mainWindow) {
  ipcMain.on("menu-new-file", () => {
    mainWindow.webContents.send("file-new");
  });

  ipcMain.on("menu-open-file", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
    });
    if (!canceled && filePaths.length > 0) {
      const content = fs.readFileSync(filePaths[0], "utf-8");
      mainWindow.webContents.send("file-open", {
        content,
        filePath: filePaths[0],
      });
    }
  });

  ipcMain.on("menu-open-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (!canceled && filePaths.length > 0) {
      const rootFolderPath = filePaths[0];
      const treeData = buildTree(rootFolderPath);
      mainWindow.webContents.send("folder-opened", {
        items: treeData,
        folderPath: rootFolderPath,
      });
    }
  });

  ipcMain.on("menu-save", () => {
    mainWindow.webContents.send("file-save-request");
  });
}

module.exports = { registerMenuIPC };
