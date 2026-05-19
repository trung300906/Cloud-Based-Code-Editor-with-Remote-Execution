const { ipcMain } = require("electron");
const os = require("os");
const pty = require("node-pty");

let ptyProcess = null;

function registerTerminalIPC(mainWindow, getWorkspaceRoot) {
  // Check OS for appropriate shell
  const shell = os.platform() === "win32" ? "powershell.exe" : "bash";

  ipcMain.on("terminal-pty-start", () => {
    if (ptyProcess) return;

    const cwd = getWorkspaceRoot() || process.env.HOME || process.env.USERPROFILE;

    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: process.env,
    });

    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal-pty-output", data);
      }
    });
  });

  ipcMain.on("terminal-pty-input", (event, data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on("terminal-pty-resize", (event, { cols, rows }) => {
    if (ptyProcess && cols > 0 && rows > 0) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (err) {
        console.error("[PTY] Resize error:", err);
      }
    }
  });
}

module.exports = { registerTerminalIPC };
