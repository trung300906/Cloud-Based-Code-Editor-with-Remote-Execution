const { contextBridge, ipcRenderer } = require('electron')

// [ADDED]: Mở cổng giao tiếp cho các lệnh File (New, Open, Save) từ Menu xuống UI
contextBridge.exposeInMainWorld('electronAPI', {
  onNewFile: (callback) => ipcRenderer.on('file-new', callback),
  onOpenFile: (callback) => ipcRenderer.on('file-open', (event, data) => callback(data)),
  onSaveRequest: (callback) => ipcRenderer.on('file-save-request', callback),
  sendSaveFile: (data) => ipcRenderer.send('save-file', data),
  onFileSaved: (callback) => ipcRenderer.on('file-saved', (event, path) => callback(path)),
  requestReadFile: (filePath) => ipcRenderer.send('request-read-file', filePath),
  onFolderOpened: (callback) => ipcRenderer.on('folder-opened', (event, value) => callback(value)),
  // [ADDED]: Renderer yêu cầu main reload lại folder (dùng khi restore state)
  requestOpenFolder: (folderPath) => ipcRenderer.send('request-open-folder', folderPath),
})