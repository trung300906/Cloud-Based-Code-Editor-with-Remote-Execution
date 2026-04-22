const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // File operations (existing)
  onNewFile: (cb) => ipcRenderer.on("file-new", cb),
  onOpenFile: (cb) => ipcRenderer.on("file-open", (e, data) => cb(data)),
  onSaveRequest: (cb) => ipcRenderer.on("file-save-request", cb),
  sendSaveFile: (data) => ipcRenderer.send("save-file", data),
  onFileSaved: (cb) => ipcRenderer.on("file-saved", (e, path) => cb(path)),
  requestReadFile: (filePath) =>
    ipcRenderer.send("request-read-file", filePath),
  onFolderOpened: (cb) => ipcRenderer.on("folder-opened", (e, val) => cb(val)),
  requestOpenFolder: (folderPath) =>
    ipcRenderer.send("request-open-folder", folderPath),
  createEntry: (type, dirPath, name) =>
    ipcRenderer.invoke("create-entry", { type, dirPath, name }),

  // Custom menu bar → main process dialogs
  menuNewFile: () => ipcRenderer.send("menu-new-file"),
  menuOpenFile: () => ipcRenderer.send("menu-open-file"),
  menuOpenFolder: () => ipcRenderer.send("menu-open-folder"),
  menuSave: () => ipcRenderer.send("menu-save"),

  // Window / App controls
  winMinimize: () => ipcRenderer.send("win-minimize"),
  winClose: () => ipcRenderer.send("win-close"),
  winReload: () => ipcRenderer.send("win-reload"),
  winToggleFullscreen: () => ipcRenderer.send("win-toggle-fullscreen"),
  winToggleDevtools: () => ipcRenderer.send("win-toggle-devtools"),
  winZoomIn: () => ipcRenderer.send("win-zoom-in"),
  winZoomOut: () => ipcRenderer.send("win-zoom-out"),
  winResetZoom: () => ipcRenderer.send("win-reset-zoom"),
  appQuit: () => ipcRenderer.send("app-quit"),
});
