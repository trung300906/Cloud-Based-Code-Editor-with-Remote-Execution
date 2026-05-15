// =====================================================================
// DIFF EDITOR UI — Trình giải quyết xung đột bằng Monaco Diff Editor
// Supports OCC: passes cloudVersion through resolution for version-aware push
// =====================================================================

import { getFocusedPane } from "./pane.js";

let diffEditorInstance = null;
let originalModel = null;
let modifiedModel = null;

/**
 * Hiển thị giao diện giải quyết xung đột
 * @param {string} filepath Đường dẫn file đang bị xung đột
 * @param {string} localContent Nội dung trên máy local
 * @param {string} cloudContent Nội dung từ máy chủ cloud
 * @param {number} cloudVersion Version hiện tại trên server (dùng cho OCC push sau resolve)
 */
export function showDiffResolution(filepath, localContent, cloudContent, cloudVersion) {
  const diffContainer = document.getElementById("diff-editor-container");
  const mainEditor = document.getElementById("main-editor");
  
  if (!diffContainer || !mainEditor) return;

  // 1. Ẩn editor thường, hiện container của diff editor
  mainEditor.style.display = "none";
  diffContainer.style.display = "flex";
  diffContainer.innerHTML = ""; // Clear old UI

  // 2. Tạo phần header chứa tiêu đề và các nút thao tác
  const header = document.createElement("div");
  header.className = "diff-header";
  header.innerHTML = `
    <div class="diff-title">
      <span class="diff-icon">⚠️</span>
      <strong>Sync Conflict:</strong> ${filepath}
      <span class="diff-version-badge">Server v${cloudVersion}</span>
    </div>
    <div class="diff-actions">
      <button id="btn-accept-cloud" class="ghost-btn">Accept Cloud (Left)</button>
      <button id="btn-accept-local" class="primary-btn">Accept Local / Manual (Right)</button>
    </div>
  `;
  diffContainer.appendChild(header);

  // 3. Tạo phần chứa Monaco Editor
  const editorWrapper = document.createElement("div");
  editorWrapper.style.flex = "1";
  editorWrapper.style.minHeight = "0";
  diffContainer.appendChild(editorWrapper);

  // 4. Khởi tạo Monaco Diff Editor
  diffEditorInstance = monaco.editor.createDiffEditor(editorWrapper, {
    theme: "vs-dark",
    readOnly: false, // Cho phép sửa code bên phải để merge tay
    originalEditable: false, // Bên trái (Cloud) không được sửa
    automaticLayout: true,
    renderSideBySide: true,
  });

  originalModel = monaco.editor.createModel(cloudContent, "text/plain");
  modifiedModel = monaco.editor.createModel(localContent, "text/plain");

  diffEditorInstance.setModel({
    original: originalModel,
    modified: modifiedModel
  });

  function saveAndClose(finalContent) {
    // Gửi sự kiện giải quyết xung đột lên Main Process
    // Truyền cloudVersion để OCC push sử dụng đúng version
    window.electronAPI.resolveConflict(filepath, finalContent, cloudVersion);

    // Cập nhật lại editor chính hiển thị nội dung vừa merge
    const pane = getFocusedPane();
    if (pane && pane.editor) {
      // Giữ nguyên vị trí scroll/cursor nếu có thể
      const position = pane.editor.getPosition();
      pane.editor.setValue(finalContent);
      if (position) pane.editor.setPosition(position);
    }
    
    // Đóng giao diện diff
    closeDiffResolution();
  }

  // 5. Lắng nghe sự kiện click các nút
  document.getElementById("btn-accept-cloud").addEventListener("click", () => {
    // Chấp nhận cloud thì lấy nội dung bên trái
    saveAndClose(originalModel.getValue());
  });

  document.getElementById("btn-accept-local").addEventListener("click", () => {
    // Chấp nhận local (hoặc những gì vừa sửa thủ công bên phải)
    saveAndClose(modifiedModel.getValue());
  });
}

function closeDiffResolution() {
  const diffContainer = document.getElementById("diff-editor-container");
  const mainEditor = document.getElementById("main-editor");

  if (diffEditorInstance) {
    diffEditorInstance.dispose();
    diffEditorInstance = null;
  }
  if (originalModel) {
    originalModel.dispose();
    originalModel = null;
  }
  if (modifiedModel) {
    modifiedModel.dispose();
    modifiedModel = null;
  }

  if (diffContainer && mainEditor) {
    diffContainer.style.display = "none";
    diffContainer.innerHTML = "";
    mainEditor.style.display = "flex";
  }
}
