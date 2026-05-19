const Terminal = window.Terminal;
const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;

let term;
let fitAddon;
let terminalContainer;
let terminalResizeHandle;

let isLocked = false;
let isGatewayExecution = false;

export function initTerminal() {
  terminalContainer = document.getElementById("terminal-container");
  terminalResizeHandle = document.getElementById("terminal-resize-handle");
  if (!terminalContainer) return;

  term = new Terminal({
    theme: {
      background: "#000000",
      foreground: "#ffffff",
    },
    cursorBlink: true,
    fontFamily: 'monospace',
    fontSize: 14,
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  if (window.electronAPI) {
    // Start PTY in backend
    window.electronAPI.startPty();

    // Listen to output from PTY
    window.electronAPI.onPtyOutput((data) => {
      term.write(data);
    });

    // Handle normal shell input
    term.onData((data) => {
      if (isLocked) {
        if (isGatewayExecution && data === '\r') {
          // User pressed Enter after execution finished
          unlockTerminal();
        }
        return;
      }
      window.electronAPI.sendPtyInput(data);
    });
    
    // When resizing the terminal, tell PTY
    term.onResize(({ cols, rows }) => {
      window.electronAPI.resizePty(cols, rows);
    });

    // Listen to outputs from Gateway code execution
    window.electronAPI.onTerminalOutput((data) => {
      if (!isLocked) return;
      term.write(data);
      term.write('\r\n\x1b[1;32mExecution finished. Press Enter to continue...\x1b[0m\r\n');
      isGatewayExecution = true;
    });
  }

  // Simple vertical resize logic
  let isResizing = false;
  terminalResizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "row-resize";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const containerRect = document.querySelector(".container").getBoundingClientRect();
    const newHeight = containerRect.bottom - e.clientY;
    if (newHeight > 100 && newHeight < containerRect.height - 100) {
      terminalContainer.style.height = newHeight + "px";
      fitAddon.fit();
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "default";
    }
  });
}

export function showTerminal() {
  if (terminalContainer.style.display === "none") {
    terminalContainer.style.display = "block";
    terminalResizeHandle.style.display = "block";
    if (!term.element) {
      term.open(terminalContainer);
    }
    fitAddon.fit();
  }
}

export function hideTerminal() {
  terminalContainer.style.display = "none";
  terminalResizeHandle.style.display = "none";
}

export function toggleTerminal() {
  if (terminalContainer.style.display === "none") {
    showTerminal();
  } else {
    hideTerminal();
  }
}

export function clearTerminal() {
  term.clear();
}

export function writeTerminal(text) {
  showTerminal();
  term.write(text);
}

export function lockTerminalForExecution(lang) {
  isLocked = true;
  isGatewayExecution = false;
  showTerminal();
  clearTerminal();
  term.write(`\x1b[33m🚀 Executing ${lang} code on Gateway...\x1b[0m\r\n`);
}

export function unlockTerminal() {
  isLocked = false;
  isGatewayExecution = false;
  term.clear();
  // Press enter in PTY to restore the prompt
  if (window.electronAPI) {
    window.electronAPI.sendPtyInput('\r');
  }
}
