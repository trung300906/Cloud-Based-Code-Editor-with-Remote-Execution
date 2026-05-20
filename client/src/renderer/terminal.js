const Terminal = window.Terminal;
const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;

const terminals = new Map(); // id -> { term, fitAddon, container, name }
let activeTerminalId = null;

let terminalWrapper;
let terminalContainer;
let terminalResizeHandle;
let terminalSelect;
let terminalAddBtn;
let terminalKillBtn;
let terminalCloseBtn;

let isLocked = false;
let isGatewayExecution = false;

// Format \n to \r\n for xterm.js
function formatOutput(data) {
  if (typeof data !== 'string') return data;
  return data.replace(/\r?\n/g, '\r\n');
}

export function initTerminal() {
  terminalWrapper = document.getElementById("terminal-wrapper");
  terminalContainer = document.getElementById("terminal-container");
  terminalResizeHandle = document.getElementById("terminal-resize-handle");
  terminalSelect = document.getElementById("terminal-select");
  terminalAddBtn = document.getElementById("terminal-add-btn");
  terminalKillBtn = document.getElementById("terminal-kill-btn");
  terminalCloseBtn = document.getElementById("terminal-close-btn");

  if (!terminalWrapper) return;

  // Resize logic
  let isResizing = false;
  terminalResizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "row-resize";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newHeight = window.innerHeight - e.clientY;
    if (newHeight > 100 && newHeight < window.innerHeight - 100) {
      terminalWrapper.style.height = newHeight + "px";
      const activeTerm = terminals.get(activeTerminalId);
      if (activeTerm) activeTerm.fitAddon.fit();
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "default";
    }
  });

  // UI Event Listeners
  terminalAddBtn.addEventListener("click", () => createTerminal());
  terminalKillBtn.addEventListener("click", () => killTerminal(activeTerminalId));
  terminalCloseBtn.addEventListener("click", hideTerminal);
  
  terminalSelect.addEventListener("change", (e) => {
    switchTerminal(e.target.value);
  });

  if (window.electronAPI) {
    // Listen to output from PTY
    window.electronAPI.onPtyOutput((payload) => {
      const { id, data } = payload;
      const termObj = terminals.get(id);
      if (termObj && !isLocked) {
        termObj.term.write(data);
      }
    });

    window.electronAPI.onPtyExit((id) => {
      removeTerminalFromUI(id);
    });

    // Listen to outputs from Gateway code execution
    window.electronAPI.onTerminalOutput((data) => {
      console.log(`[Renderer] onTerminalOutput received (isLocked=${isLocked}):`, data);
      if (!isLocked) return;
      const activeTerm = terminals.get(activeTerminalId);
      if (!activeTerm) return;

      activeTerm.term.write(formatOutput(data));
      
      if (data.includes('[Process Exited:')) {
        activeTerm.term.write('\r\n\x1b[1;32mExecution finished. Press Enter to continue...\x1b[0m\r\n');
        isGatewayExecution = true;
      }
    });
  }

  // Create default terminal on load
  createTerminal("bash");
}

async function createTerminal(namePrefix = "bash") {
  const termObj = {
    name: `${namePrefix} ${terminals.size + 1}`,
    container: document.createElement("div")
  };
  
  termObj.container.style.width = "100%";
  termObj.container.style.height = "100%";
  termObj.container.style.display = "none";
  terminalContainer.appendChild(termObj.container);

  termObj.term = new Terminal({
    theme: { background: "#000000", foreground: "#ffffff" },
    cursorBlink: true,
    fontFamily: 'monospace',
    fontSize: 14,
  });

  termObj.fitAddon = new FitAddon();
  termObj.term.loadAddon(termObj.fitAddon);
  termObj.term.open(termObj.container);

  let id = null;
  if (window.electronAPI) {
    const result = await window.electronAPI.startPty();
    id = typeof result === "object" ? result.id : result;
    const shellName = typeof result === "object" ? result.shell : namePrefix;
    termObj.name = `${shellName} ${terminals.size + 1}`;
    
    termObj.term.onData((data) => {
      console.log(`[Terminal] Key pressed, isLocked: ${isLocked}, isGatewayExecution: ${isGatewayExecution}, key: ${JSON.stringify(data)}`);
      if (isLocked) {
        if (isGatewayExecution) {
          if (data === '\r') unlockTerminal();
          return;
        }
        
        const translatedData = data.replace(/\r/g, '\n');
        console.log(`[Terminal] Sending run-input: ${JSON.stringify(translatedData)}`);
        
        // Gửi input lên Gateway (\r phải đổi thành \n để C++/Python nhận diện Enter)
        if (window.electronAPI.sendRunInput) {
          window.electronAPI.sendRunInput(translatedData);
        }
        
        // Local Echo
        if (data === '\r') {
          termObj.term.write('\r\n');
        } else if (data === '\x7F') {
          // Xoá lùi ký tự (Backspace)
          termObj.term.write('\b \b');
        } else if (data === '\x03') {
          // Bấm Ctrl+C, hiện ra ^C rồi đợi Gateway dập
          termObj.term.write('^C\r\n');
        } else {
          termObj.term.write(data);
        }
        
        return;
      }
      window.electronAPI.sendPtyInput(id, data);
    });
    
    termObj.term.onResize(({ cols, rows }) => {
      window.electronAPI.resizePty(id, cols, rows);
    });
  } else {
    id = "local_" + Date.now();
  }

  terminals.set(id, termObj);

  // Add to dropdown
  const option = document.createElement("option");
  option.value = id;
  option.textContent = termObj.name;
  terminalSelect.appendChild(option);

  switchTerminal(id);
  
  // Fit later to ensure DOM is updated
  setTimeout(() => termObj.fitAddon.fit(), 50);
}

function switchTerminal(id) {
  if (!terminals.has(id)) return;
  
  terminals.forEach((termObj, key) => {
    termObj.container.style.display = key === id ? "block" : "none";
  });
  
  activeTerminalId = id;
  terminalSelect.value = id;
  
  const activeTerm = terminals.get(id);
  activeTerm.fitAddon.fit();
  activeTerm.term.focus();
}

function removeTerminalFromUI(id) {
  if (!terminals.has(id)) return;
  const termObj = terminals.get(id);
  
  // Remove from DOM
  termObj.term.dispose();
  termObj.container.remove();
  terminals.delete(id);
  
  // Remove from Select
  const option = terminalSelect.querySelector(`option[value="${id}"]`);
  if (option) option.remove();

  if (terminals.size === 0) {
    activeTerminalId = null;
    hideTerminal();
  } else if (activeTerminalId === id) {
    // Switch to another terminal
    const nextId = terminals.keys().next().value;
    switchTerminal(nextId);
  }
}

function killTerminal(id) {
  if (!id) return;
  if (window.electronAPI) {
    window.electronAPI.closePty(id);
  }
  removeTerminalFromUI(id);
}

export function showTerminal() {
  if (terminalWrapper.style.display === "none") {
    terminalWrapper.style.display = "flex";
    terminalResizeHandle.style.display = "block";
    
    if (terminals.size === 0) {
      createTerminal();
    } else {
      const activeTerm = terminals.get(activeTerminalId);
      if (activeTerm) {
        setTimeout(() => activeTerm.fitAddon.fit(), 10);
      }
    }
  }
}

export function hideTerminal() {
  terminalWrapper.style.display = "none";
  terminalResizeHandle.style.display = "none";
}

export function toggleTerminal() {
  if (terminalWrapper.style.display === "none") {
    showTerminal();
  } else {
    hideTerminal();
  }
}

export function clearTerminal() {
  const activeTerm = terminals.get(activeTerminalId);
  if (activeTerm) activeTerm.term.clear();
}

export function writeTerminal(text) {
  showTerminal();
  const activeTerm = terminals.get(activeTerminalId);
  if (activeTerm) activeTerm.term.write(formatOutput(text));
}

export function lockTerminalForExecution(lang) {
  isLocked = true;
  isGatewayExecution = false;
  showTerminal();
  clearTerminal();
  const activeTerm = terminals.get(activeTerminalId);
  if (activeTerm) {
    activeTerm.term.write(`\x1b[33m🚀 Executing ${lang} code on Gateway...\x1b[0m\r\n`);
  }
}

export function unlockTerminal() {
  isLocked = false;
  isGatewayExecution = false;
  const activeTerm = terminals.get(activeTerminalId);
  if (activeTerm) {
    if (window.electronAPI) {
      // Gửi Ctrl+C (0x03) kết hợp Enter (0x0D) để buộc bash in lại prompt ngay lập tức
      // tránh bị dính input thừa nếu người dùng lỡ gõ bậy lúc locked
      window.electronAPI.sendPtyInput(activeTerminalId, '\x03\r');
    }
  }
}
