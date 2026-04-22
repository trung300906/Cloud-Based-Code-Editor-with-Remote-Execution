// =====================================================================
// IPC FILE — save-file, request-read-file, request-open-folder, create-entry
// =====================================================================
const { ipcMain, dialog } = require('electron');
const path                = require('node:path');
const fs                  = require('fs');
const { buildTree }       = require('./file-utils');

/**
 * Đăng ký tất cả IPC handler liên quan đến file system.
 * @param {Electron.BrowserWindow} mainWindow
 */
function registerFileIPC(mainWindow) {
  // ---- Save file ----
  ipcMain.on('save-file', (event, { filePath, content }) => {
    if (filePath) {
      fs.writeFileSync(filePath, content);
      mainWindow.webContents.send('file-saved', filePath);
    } else {
      dialog.showSaveDialog(mainWindow).then(result => {
        if (!result.canceled) {
          fs.writeFileSync(result.filePath, content);
          mainWindow.webContents.send('file-saved', result.filePath);
        }
      });
    }
  });

  // ---- Read file và gửi nội dung về renderer ----
  ipcMain.on('request-read-file', (event, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      mainWindow.webContents.send('file-open', { filePath, content });
    } catch (err) {
      console.error('Lỗi không đọc được file:', err);
    }
  });

  // ---- Mở lại folder đã lưu (restore session) ----
  ipcMain.on('request-open-folder', (event, folderPath) => {
    try {
      if (!fs.existsSync(folderPath)) return;
      const treeData = buildTree(folderPath);
      mainWindow.webContents.send('folder-opened', { items: treeData, folderPath });
    } catch (err) {
      console.error('Lỗi khi restore folder:', err);
    }
  });

  // ---- Tạo file hoặc folder mới từ sidebar ----
  ipcMain.handle('create-entry', async (event, { type, dirPath, name }) => {
    const safeName = path.basename(name.trim());
    if (!safeName) return { success: false, error: 'Tên không hợp lệ.' };

    const fullPath = path.join(dirPath, safeName);
    if (fs.existsSync(fullPath)) return { success: false, error: `"${safeName}" đã tồn tại.` };

    try {
      if (type === 'file') {
        fs.writeFileSync(fullPath, '');
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
