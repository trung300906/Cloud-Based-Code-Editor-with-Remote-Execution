const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs   = require('fs')

let mainWindow;

// =====================================================================
// buildTree — module scope (tái dụng cho Open Folder + request-open-folder)
// SKIP_DIRS: bỏ qua thư mục rác/ẩn tránh treo app
// =====================================================================
const SKIP_DIRS = new Set([]);

function buildTree(dirPath) {
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (err) {
    console.error('Lỗi đọc thư mục:', dirPath, err.message);
    return result;
  }
  for (const file of entries) {
    if (SKIP_DIRS.has(file) || file.startsWith('.')) continue;
    const fullPath = path.join(dirPath, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        result.push({ name: file, path: fullPath, isDirectory: true, children: buildTree(fullPath) });
      } else {
        result.push({ name: file, path: fullPath, isDirectory: false });
      }
    } catch (e) { /* bỏ qua file không đọc được */ }
  }
  return result;
}

// =====================================================================
// createWindow
// =====================================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, 'bleh.jpg'),
  })
  mainWindow.loadFile('index.html')

  Menu.setApplicationMenu(null)
}

// =====================================================================
// App lifecycle
// =====================================================================
app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// =====================================================================
// IPC Handlers — File operations
// =====================================================================

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

ipcMain.on('request-read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('file-open', { filePath, content });
  } catch (err) {
    console.error('Lỗi không đọc được file:', err);
  }
});

ipcMain.on('request-open-folder', (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) return;
    const treeData = buildTree(folderPath);
    mainWindow.webContents.send('folder-opened', { items: treeData, folderPath });
  } catch (err) {
    console.error('Lỗi khi restore folder:', err);
  }
});

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

// =====================================================================
// IPC Handlers — Custom menu bar actions (thay thế native menu)
// =====================================================================

ipcMain.on('menu-new-file', () => {
  mainWindow.webContents.send('file-new');
});

ipcMain.on('menu-open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  if (!canceled && filePaths.length > 0) {
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    mainWindow.webContents.send('file-open', { content, filePath: filePaths[0] });
  }
});

ipcMain.on('menu-open-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!canceled && filePaths.length > 0) {
    const rootFolderPath = filePaths[0];
    const treeData = buildTree(rootFolderPath);
    mainWindow.webContents.send('folder-opened', { items: treeData, folderPath: rootFolderPath });
  }
});

ipcMain.on('menu-save', () => {
  mainWindow.webContents.send('file-save-request');
});

// =====================================================================
// IPC Handlers — Window / App operations
// =====================================================================

ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-close', () => mainWindow?.close());
ipcMain.on('win-reload', () => mainWindow?.reload());
ipcMain.on('win-toggle-fullscreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
ipcMain.on('win-toggle-devtools', () => mainWindow?.webContents.toggleDevTools());
ipcMain.on('win-zoom-in', () => {
  if (mainWindow) mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5);
});
ipcMain.on('win-zoom-out', () => {
  if (mainWindow) mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5);
});
ipcMain.on('win-reset-zoom', () => {
  if (mainWindow) mainWindow.webContents.setZoomLevel(0);
});
ipcMain.on('app-quit', () => app.quit());
