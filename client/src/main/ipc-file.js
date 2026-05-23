 
// IPC FILE — save-file, request-read-file, request-open-folder, create-entry
 
const { ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("fs");
const { buildTree } = require("./file-utils");
const { syncManager } = require("./sync-service.js");

/**
 * Đăng ký tất cả IPC handler liên quan đến file system.
 * @param {Electron.BrowserWindow} mainWindow
 */
function registerFileIPC(mainWindow) {
  // Lazy require to avoid circular dependency with main.js
  const { getToken, getProjectId, getWorkspaceRoot } = require("../../main.js");

  /**
   * Trigger OCC sync after saving a file locally.
   */
  function triggerSync(filePath) {
    const token = getToken();
    const projectId = getProjectId();
    const workspaceRoot = getWorkspaceRoot();
    if (token && projectId) {
      syncManager.autoSync(filePath, token, projectId, workspaceRoot).catch(console.error);
    }
  }

  // ---- Save file ----
  ipcMain.on("save-file", (event, { filePath, content }) => {
    if (filePath) {
      fs.writeFileSync(filePath, content);
      mainWindow.webContents.send("file-saved", filePath);
      triggerSync(filePath);
    } else {
      dialog.showSaveDialog(mainWindow).then((result) => {
        if (!result.canceled) {
          fs.writeFileSync(result.filePath, content);
          mainWindow.webContents.send("file-saved", result.filePath);
          triggerSync(result.filePath);
        }
      });
    }
  });

  // ---- Read text file và gửi nội dung về renderer ----
  ipcMain.on("request-read-file", (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        console.log(`[Main] request-read-file: File không tồn tại (có thể đã bị xóa): ${filePath}`);
        return;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      mainWindow.webContents.send("file-open", { filePath, content });
    } catch (err) {
      console.error("Lỗi không đọc được file:", err);
    }
  });

  // ---- Read binary file (image/pdf) as base64 ----
  ipcMain.on("request-read-binary", (event, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimeMap = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
        ico: "image/x-icon", svg: "image/svg+xml", tiff: "image/tiff",
        pdf: "application/pdf",
      };
      const mime = mimeMap[ext] || "application/octet-stream";
      const base64 = buffer.toString("base64");
      mainWindow.webContents.send("binary-file-open", {
        filePath,
        dataUrl: `data:${mime};base64,${base64}`,
        mime,
      });
    } catch (err) {
      console.error("Lỗi đọc binary file:", err);
    }
  });

  // ---- Mở lại folder đã lưu (restore session) ----
  ipcMain.on("request-open-folder", (event, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) return;
      const treeData = buildTree(folderPath);
      mainWindow.webContents.send("folder-opened", {
        items: treeData,
        folderPath,
      });
    } catch (err) {
      console.error("Lỗi khi restore folder:", err);
    }
  });

  // ---- Tạo file hoặc folder mới từ sidebar ----
  ipcMain.handle("create-entry", async (event, { type, dirPath, name }) => {
    const safeName = path.basename(name.trim());
    if (!safeName) return { success: false, error: "Tên không hợp lệ." };

    const fullPath = path.join(dirPath, safeName);
    if (fs.existsSync(fullPath))
      return { success: false, error: `"${safeName}" đã tồn tại.` };

    try {
      if (type === "file") {
        fs.writeFileSync(fullPath, "");
      } else {
        fs.mkdirSync(fullPath, { recursive: true });
      }
      return { success: true, path: fullPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerFileIPC };
