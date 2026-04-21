const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onNewFile:        (cb) => ipcRenderer.on('file-new', cb),
  onOpenFile:       (cb) => ipcRenderer.on('file-open', (e, data) => cb(data)),
  onSaveRequest:    (cb) => ipcRenderer.on('file-save-request', cb),
  sendSaveFile:     (data) => ipcRenderer.send('save-file', data),
  onFileSaved:      (cb) => ipcRenderer.on('file-saved', (e, path) => cb(path)),
  requestReadFile:  (filePath) => ipcRenderer.send('request-read-file', filePath),
  onFolderOpened:   (cb) => ipcRenderer.on('folder-opened', (e, val) => cb(val)),
  // State persistence: renderer yêu cầu main load lại folder
  requestOpenFolder: (folderPath) => ipcRenderer.send('request-open-folder', folderPath),
  // Tạo file/folder mới — trả về Promise { success, path?, error? }
  createEntry: (type, dirPath, name) => ipcRenderer.invoke('create-entry', { type, dirPath, name }),
})