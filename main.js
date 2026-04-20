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
            
            if (!canceled) {
              const folderPath = filePaths[0];
              try {
                const files = fs.readdirSync(folderPath);
                const items = [];
                
                // Dùng vòng lặp for thay vì map để dễ bẫy lỗi từng file
                for (const file of files) {
                  try {
                    const fullPath = path.join(folderPath, file);
                    const isDir = fs.statSync(fullPath).isDirectory();
                    items.push({
                      name: file,
                      path: fullPath,
                      isDirectory: isDir
                    });
                  } catch (err) {
                    // Nếu gặp file bị khóa/cấm đọc -> Bỏ qua không làm sập app
                    console.log("Bỏ qua file không có quyền đọc:", file);
                  }
                }
                
                // Gửi mảng items đã lọc an toàn về cho renderer.js
                mainWindow.webContents.send('folder-opened', { items, folderPath });
              } catch (error) {
                console.error("Lỗi khi đọc folder chính:", error);
              }
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

// [ADDED]: Lắng nghe yêu cầu đọc file từ Sidebar
ipcMain.on('request-read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Đọc xong thì tận dụng luôn kênh 'file-open' cũ để bơm text vào Editor
    event.sender.send('file-open', { content, filePath });
  } catch (error) {
    console.error("Lỗi khi đọc file:", error);
  }
});