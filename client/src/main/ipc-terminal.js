const { ipcMain } = require("electron");
const os = require("os");
const pty = require("node-pty");

const ptyProcesses = new Map();

function registerTerminalIPC(mainWindow, getWorkspaceRoot) {
  // Check OS for appropriate shell
  const shell = os.platform() === "win32" ? "powershell.exe" : (process.env.SHELL || "bash");

  ipcMain.handle("terminal-pty-start", (event, terminalId) => {
    if (!terminalId) {
      terminalId = "term_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    }
    
    if (ptyProcesses.has(terminalId)) return { id: terminalId, shell: require("path").basename(shell) };

    const cwd = getWorkspaceRoot() || process.env.HOME || process.env.USERPROFILE;

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: process.env,
    });

    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal-pty-output", { id: terminalId, data });
      }
    });

    ptyProcess.onExit(() => {
      ptyProcesses.delete(terminalId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal-pty-exit", terminalId);
      }
    });

    ptyProcesses.set(terminalId, ptyProcess);
    
    // Extract shell name without path (e.g., "bash", "zsh", "fish", "powershell.exe")
    const shellName = require("path").basename(shell);
    return { id: terminalId, shell: shellName };
  });

  ipcMain.on("terminal-pty-input", (event, { id, data }) => {
    const ptyProcess = ptyProcesses.get(id);
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on("terminal-pty-resize", (event, { id, cols, rows }) => {
    const ptyProcess = ptyProcesses.get(id);
    if (ptyProcess && cols > 0 && rows > 0) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (err) {
        console.error(`[PTY ${id}] Resize error:`, err);
      }
    }
  });

  ipcMain.on("terminal-pty-close", (event, id) => {
    const ptyProcess = ptyProcesses.get(id);
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch (e) {}
      ptyProcesses.delete(id);
    }
  });
}

module.exports = { registerTerminalIPC };
