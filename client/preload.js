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
  requestReadBinary: (filePath) =>
    ipcRenderer.send("request-read-binary", filePath),
  onBinaryFileOpen: (cb) =>
    ipcRenderer.on("binary-file-open", (e, data) => cb(data)),
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

  // Auth flow
  loginSuccess: (token) => ipcRenderer.send("login-success", token),

  // SafeStorage — mã hóa token bằng OS keychain (Linux: GNOME Keyring, Windows: DPAPI)
  encryptToken: (plainText) => ipcRenderer.invoke("safe-storage:encrypt", plainText),
  decryptToken: (cipher) => ipcRenderer.invoke("safe-storage:decrypt", cipher),

  // Project Management
  setProject: (name, workspaceRoot) => ipcRenderer.invoke("project:set", { name, workspaceRoot }),
  projectSet: (data) => ipcRenderer.invoke("project:set_guest", data),
  cloneGuestProject: (data) => ipcRenderer.send("project:clone_guest", data),
  leaveRoom: () => ipcRenderer.send("room:leave"),

  // Sync Engine (OCC)
  onSyncConflict: (callback) => ipcRenderer.on('sync:conflict', (_event, data) => callback(data)),
  resolveConflict: (filepath, resolvedContent, cloudVersion) =>
    ipcRenderer.invoke('sync:resolve', filepath, resolvedContent, cloudVersion),

  // Terminal & Run Code
  sendRunCode: (data) => ipcRenderer.send('run-code', data),
  onTerminalOutput: (cb) => ipcRenderer.on('terminal-output', (e, data) => cb(data)),
  
  // PTY events
  startPty: () => ipcRenderer.send('terminal-pty-start'),
  sendPtyInput: (data) => ipcRenderer.send('terminal-pty-input', data),
  resizePty: (cols, rows) => ipcRenderer.send('terminal-pty-resize', { cols, rows }),
  onPtyOutput: (cb) => ipcRenderer.on('terminal-pty-output', (e, data) => cb(data)),
});
