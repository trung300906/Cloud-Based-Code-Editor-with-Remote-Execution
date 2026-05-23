 
// RENDERER ENTRY POINT — Khởi tạo UI và kết nối Electron IPC events
//
// Import monaco-init.js trước để require.config() chạy sớm nhất có thể,
// song song với DOMContentLoaded (Monaco tải async từ CDN).
 
import "./monaco-init.js";
import "./toast.js";

import { state, LS } from "./state.js";
import { initRootPane } from "./pane.js";
import { openOrActivateTab, openViewerTab, buildTabEl, getTabByPath, closeTab } from "./tab.js";
import { getFocusedPane } from "./pane.js";
import { updateBreadcrumb } from "./breadcrumb.js";
import { doSave } from "./menubar.js";
import { initCustomMenubar } from "./menubar.js";
import { initKeyboardShortcuts } from "./keyboard.js";
import { initQuickOpen } from "./quick-open.js";
import {
  buildSidebarToolbar,
  initResizeHandle,
  onFolderOpened,
} from "./sidebar.js";
import { initTerminal, showTerminal, clearTerminal, writeTerminal, toggleTerminal, lockTerminalForExecution } from "./terminal.js";

 
// DOM READY — khởi tạo toàn bộ UI components
 
window.addEventListener("DOMContentLoaded", async () => {
  initRootPane(); // Tạo pane đầu tiên (Monaco chưa load, editor sẽ được tạo sau)
  buildSidebarToolbar(); // Inject toolbar vào sidebar
  await initCustomMenubar(); // Dropdown menu + theme toggle + lang dropdown + decrypt token
  initKeyboardShortcuts(); // Ctrl+N, Ctrl+S, ...
  initQuickOpen(); // Ctrl+P command palette
  initResizeHandle(); // Kéo divider sidebar

  // Khôi phục folder mở lần trước
  const lastFolder = localStorage.getItem(LS.FOLDER);
  if (lastFolder) window.electronAPI.requestOpenFolder(lastFolder);

  // Khởi tạo Terminal
  initTerminal();

  // Nút Toggle Terminal
  const toggleTerminalBtn = document.getElementById("toggle-terminal-btn");
  if (toggleTerminalBtn) {
    toggleTerminalBtn.addEventListener("click", () => {
      toggleTerminal();
    });
  }

  // Nút Run Code
  const runCodeBtn = document.getElementById("submit-btn");
  if (runCodeBtn) {
    runCodeBtn.addEventListener("click", () => {
      const pane = getFocusedPane();
      if (!pane || !pane.editor) {
        alert("Please open a file to run");
        return;
      }
      const code = pane.editor.getValue();
      // Check language
      const lang = document.getElementById("lang-select")?.value || "cpp";
      
      let entryPoint = "";
      if (state.currentFilePath && state.rootFolderPath) {
        entryPoint = state.currentFilePath.replace(state.rootFolderPath + "/", "");
        entryPoint = entryPoint.replace(/\\/g, "/");
      }

      lockTerminalForExecution(lang);
      
      // Send code to Gateway via IPC -> tcpClient
      if (window.electronAPI && window.electronAPI.sendRunCode) {
         window.electronAPI.sendRunCode({ lang, code, entryPoint });
      }
    });
  }
});

 
// ELECTRON IPC — nhận events từ main process
 

/** Ctrl+N hoặc File > New */
window.electronAPI.onNewFile(() => {
  openOrActivateTab(null, "// Enter your code here...");
});

/** File > Open File hoặc kéo file từ sidebar */
window.electronAPI.onOpenFile((data) => {
  openOrActivateTab(data.filePath, data.content);
});

/** Sau khi file được save thành công (kể cả Save As) */
window.electronAPI.onFileSaved((savedPath) => {
  const pane = getFocusedPane();
  const tabId = pane?.activeTabId;
  const tab = tabId ? state.tabs.get(tabId) : null;

  if (tab) {
    tab.filePath = savedPath;
    tab.label = savedPath.split(/[\\/]/).pop();
    tab.isModified = false;
    // Rebuild tab element để cập nhật tên và icon
    const old = pane.tabBarEl.querySelector(`[data-tab-id="${tabId}"]`);
    if (old) old.replaceWith(buildTabEl(tabId, pane));
    pane.tabBarEl
      .querySelector(`[data-tab-id="${tabId}"]`)
      ?.classList.add("active");
  }

  state.currentFilePath = savedPath;
  document.title = savedPath;
  updateBreadcrumb(savedPath, pane);
});

/** File > Save (Ctrl+S) — main process yêu cầu renderer gửi content */
window.electronAPI.onSaveRequest(() => {
  doSave();
});

/** Mở binary file (image/PDF) từ sidebar */
window.electronAPI.onBinaryFileOpen((data) => {
  openViewerTab(data.filePath, data.dataUrl, data.mime);
});

/** Mở folder từ File > Open Folder hoặc restore session */
window.electronAPI.onFolderOpened(onFolderOpened);

if (window.electronAPI.onShowToast) {
  window.electronAPI.onShowToast(({ message, type, title, duration }) => {
    if (window.showToast) {
      window.showToast(message, type, title, duration);
    }
  });
}

if (window.electronAPI.onLintResult) {
  window.electronAPI.onLintResult((markers) => {
    if (!state.monacoReady) return;
    const pane = state.panes.find(p => p.id === state.focusedPaneId);
    if (pane && pane.editor) {
      const model = pane.editor.getModel();
      if (model && Array.isArray(markers)) {
        monaco.editor.setModelMarkers(model, "remote-linter", markers);
      }
    }
  });

  window.electronAPI.onFsEvent((event) => {
    if (event.action === "delete") {
      // 1. Refresh Sidebar nếu thư mục root đang mở
      if (state.rootFolderPath) {
        window.electronAPI.requestOpenFolder(state.rootFolderPath);
      }
      
      // 2. Tìm tab của file đã bị xóa và đóng lại
      // Lấy đường dẫn tuyệt đối (hoặc tương đối) từ event để khớp với tab.filePath
      const deletedPathFragment = event.filepath; // e.g. "test.cpp"
      // Vì tab.filePath có thể là tuyệt đối (e.g. /mnt/HDDdrive/.../test.cpp)
      // Ta duyệt qua tất cả các tab
      for (const tab of state.tabs.values()) {
        if (tab.filePath && (tab.filePath === deletedPathFragment || tab.filePath.endsWith("/" + deletedPathFragment) || tab.filePath.endsWith("\\" + deletedPathFragment))) {
          // Bỏ cờ isModified để tránh hiện popup confirm "chưa lưu"
          tab.isModified = false;
          closeTab(tab.id);
        }
      }
    } else if (event.action === "update") {
      // Refresh sidebar cho trường hợp có file mới
      if (state.rootFolderPath) {
        window.electronAPI.requestOpenFolder(state.rootFolderPath);
      }
    }
  });
}
