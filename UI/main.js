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
  // mainWindow.webContents.openDevTools();

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('file-new'),
        },
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
            if (!canceled) {
              const content = fs.readFileSync(filePaths[0], 'utf-8');
              mainWindow.webContents.send('file-open', { content, filePath: filePaths[0] });
            }
          },
        },
        {
          label: 'Open Folder...',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
            if (!canceled && filePaths.length > 0) {
              const rootFolderPath = filePaths[0];
              const treeData = buildTree(rootFolderPath);
              mainWindow.webContents.send('folder-opened', { items: treeData, folderPath: rootFolderPath });
            }
          },
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('file-save-request'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
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
// IPC Handlers
// =====================================================================

// Lưu file
ipcMain.on('save-file', (event, { filePath, content }) => {
  if (filePath) {
    fs.writeFileSync(filePath, content);
  } else {
    dialog.showSaveDialog(mainWindow).then(result => {
      if (!result.canceled) {
        fs.writeFileSync(result.filePath, content);
        mainWindow.webContents.send('file-saved', result.filePath);
      }
    });
  }
});

// Đọc file từ sidebar
ipcMain.on('request-read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('file-open', { filePath, content });
  } catch (err) {
    console.error('Lỗi không đọc được file:', err);
  }
});

// Restore folder khi khởi động lại (state persistence)
ipcMain.on('request-open-folder', (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) return;
    const treeData = buildTree(folderPath);
    mainWindow.webContents.send('folder-opened', { items: treeData, folderPath });
  } catch (err) {
    console.error('Lỗi khi restore folder:', err);
  }
});

// [NEW] Tạo file/folder mới từ sidebar toolbar
ipcMain.handle('create-entry', async (event, { type, dirPath, name }) => {
  // Sanitize: không cho tạo tên chứa path separator
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