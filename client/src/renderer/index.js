// =====================================================================
// RENDERER ENTRY POINT — Khởi tạo UI và kết nối Electron IPC events
//
// Import monaco-init.js trước để require.config() chạy sớm nhất có thể,
// song song với DOMContentLoaded (Monaco tải async từ CDN).
// =====================================================================
import "./monaco-init.js";

import { state, LS } from "./state.js";
import { initRootPane } from "./pane.js";
import { openOrActivateTab, openViewerTab, buildTabEl } from "./tab.js";
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

// =====================================================================
// DOM READY — khởi tạo toàn bộ UI components
// =====================================================================
window.addEventListener("DOMContentLoaded", () => {
  initRootPane(); // Tạo pane đầu tiên (Monaco chưa load, editor sẽ được tạo sau)
  buildSidebarToolbar(); // Inject toolbar vào sidebar
  initCustomMenubar(); // Dropdown menu + theme toggle + lang dropdown
  initKeyboardShortcuts(); // Ctrl+N, Ctrl+S, ...
  initQuickOpen(); // Ctrl+P command palette
  initResizeHandle(); // Kéo divider sidebar

  // Khôi phục folder mở lần trước
  const lastFolder = localStorage.getItem(LS.FOLDER);
  if (lastFolder) window.electronAPI.requestOpenFolder(lastFolder);
});

// =====================================================================
// ELECTRON IPC — nhận events từ main process
// =====================================================================

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
