// Modules to control application life and create native browser window
// ---> 1. MODIFIED: Gọi thêm Menu, dialog (hộp thoại), ipcMain (bưu điện) và fs (thư viện đọc/ghi file) <---
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('fs') 
// ----------------------------------------------------------------------------------------------------

// ---> 2. ADDED: Lôi cái mainWindow ra tuốt bên ngoài để các hàm bên dưới xài chung được <---
let mainWindow; 
// ------------------------------------------------------------------------------------------

function createWindow () {
  // Create the browser window.
  // ---> 3. REMOVED: Bỏ chữ 'const' đi, chỉ để lại 'mainWindow = ...' thôi <---
  mainWindow = new BrowserWindow({
  // --------------------------------------------------------------------------
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },

    // Gọi ảnh lên làm icon
    icon: path.join(__dirname, 'bleh.jpg'), 
  })

  // load the index.html of the app.
  mainWindow.loadFile('index.html')
  //mainWindow.webContents.openDevTools(); // devtools

  // ===============================================================================
  // ---> 4. ADDED: Vẽ ra cái Menu mới đè lên cái Menu mặc định <---
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => { mainWindow.webContents.send('file-new') }
        },
      
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'] // Chỉ mở file
            })
            if (!canceled) {
              const content = fs.readFileSync(filePaths[0], 'utf-8')
              mainWindow.webContents.send('file-open', { content, filePath: filePaths[0] })
            }
          }
        },
        
        // [ADDED]: Nút mở Folder để ném vào cây thư mục
        {
          label: 'Open Folder...',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });

            if (!canceled && filePaths.length > 0) {
              const rootFolderPath = filePaths[0];

              // HÀM ĐỆ QUY: Quét sạch sành sanh mọi ngóc ngách
              function buildTree(dirPath) {
                const result = [];
                try {
                  const files = fs.readdirSync(dirPath);
                  for (const file of files) {
                    // Bỏ qua mấy thư mục chà bá hoặc file ẩn để app không bị treo
                    if (file === 'node_modules' || file === '.git') continue;

                    const fullPath = path.join(dirPath, file);
                    try {
                      const isDir = fs.statSync(fullPath).isDirectory();
                      if (isDir) {
                        result.push({
                          name: file,
                          path: fullPath,
                          isDirectory: true,
                          children: buildTree(fullPath) // ĐỆ QUY TẠI ĐÂY NÈ BRO
                        });
                      } else {
                        result.push({ name: file, path: fullPath, isDirectory: false });
                      }
                    } catch (e) { /* Bỏ qua file lỗi quyền */ }
                  }
                } catch (error) {
                  console.error("Lỗi đọc thư mục:", error);
                }
                return result;
              }

              const treeData = buildTree(rootFolderPath);
              // Ném nguyên cái cây phả hệ này sang UI
              mainWindow.webContents.send('folder-opened', { items: treeData, folderPath: rootFolderPath });
            }
          }
        },

        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => { mainWindow.webContents.send('file-save-request') }
        },

        { type: 'separator' }, 

        { role: 'quit', label: 'Exit' },
      ]
    },
    // [MODIFIED]: Tuyệt chiêu gọi "combo" menu mặc định của Electron chỉ với 3 dòng!
        { role: 'editMenu' },   // Tự động xổ ra nguyên bộ Edit (Undo, Redo, Copy, Paste...)
        { role: 'viewMenu' },   // Tự động xổ ra bộ View (Zoom in, Zoom out, Reload...)
        { role: 'windowMenu' }  // Tự động xổ ra bộ Window (Minimize, Close...)
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  // ---> KẾT THÚC CỤC ĐỘ THÊM MENU <---
  // ===============================================================================
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// ==================================================================================
// ---> 5. ADDED: "Bộ não" xử lý việc ghi file xuống ổ cứng thật <---
ipcMain.on('save-file', (event, { filePath, content }) => {
  if (filePath) {
    fs.writeFileSync(filePath, content) 
  } else {
    dialog.showSaveDialog(mainWindow).then(result => {
      if (!result.canceled) {
        fs.writeFileSync(result.filePath, content)
        mainWindow.webContents.send('file-saved', result.filePath)
      }
    })
  }
})
// ---> KẾT THÚC CỤC LƯU FILE <---
// ==================================================================================

// Lắng nghe yêu cầu đọc file từ Sidebar
ipcMain.on('request-read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    mainWindow.webContents.send('file-open', { filePath, content });
  } catch (err) {
    console.error("Lỗi không đọc được file:", err);
  }
});