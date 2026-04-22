// =====================================================================
// TAB — Quản lý tabs trong mỗi pane (mở, đóng, activate, build DOM)
//
// Circular imports với pane.js và drag-drop.js là có chủ đích và an toàn
// (tất cả cross-references xảy ra trong function bodies, không phải init)
// =====================================================================
import { state }                       from './state.js';
import { detectLanguage }              from './lang-detect.js';
import { BC_ICON, getBcFileIcon }      from './icons.js';
import { escapeHtml }                  from './utils.js';
import { updateBreadcrumb }            from './breadcrumb.js';
import { getFocusedPane, getPaneById, getPaneForTab, focusPane, removePane } from './pane.js';
// showDropZones dùng trong dragstart handler — circular với drag-drop.js, OK
import { showDropZones, hideDropZones } from './drag-drop.js';

// ---- Tìm tab theo file path ----
export function getTabByPath(fp) {
  for (const t of state.tabs.values()) if (t.filePath === fp) return t;
  return null;
}

/**
 * Mở file trong tab mới hoặc focus tab đang có nếu file đã mở.
 * @param {string|null} filePath
 * @param {string} content
 * @param {number|null} [paneId]  — nếu null, dùng focused pane
 */
export function openOrActivateTab(filePath, content, paneId) {
  if (!state.monacoReady) {
    state.pendingOpen.push({ filePath, content });
    return;
  }
  // Nếu file đã mở → focus pane + activate tab
  const existing = filePath ? getTabByPath(filePath) : null;
  if (existing) {
    const p = getPaneForTab(existing.id);
    if (p) { focusPane(p.id); activateTab(existing.id); }
    return;
  }

  const id    = ++state.tabCounter;
  const label = filePath ? filePath.split(/[\\/]/).pop() : `untitled-${id}`;
  const lang  = filePath ? detectLanguage(label) : 'cpp';
  const uri   = filePath
    ? monaco.Uri.file(filePath)
    : monaco.Uri.parse(`inmemory://model/${id}`);
  const model = monaco.editor.createModel(content || '', lang, uri);

  model.onDidChangeContent(() => {
    const t = state.tabs.get(id);
    if (t && !t.isModified) { t.isModified = true; refreshTabEl(id); }
  });

  state.tabs.set(id, { id, filePath, label, model, isModified: false });

  const target = paneId ? getPaneById(paneId) : getFocusedPane();
  if (!target) return;
  target.tabIds.push(id);
  appendTabElToPane(id, target);
  activateTabInPane(id, target);
}

// ---- Activate tab (tìm pane chứa tab rồi activate) ----
export function activateTab(tabId) {
  const pane = getPaneForTab(tabId);
  if (!pane) return;
  focusPane(pane.id);
  activateTabInPane(tabId, pane);
}

// ---- Activate tab trong một pane cụ thể ----
export function activateTabInPane(tabId, pane) {
  const tab = state.tabs.get(tabId);
  if (!tab || !pane?.editor) return;
  pane.activeTabId = tabId;
  pane.editor.setModel(tab.model);
  if (pane.id === state.focusedPaneId) {
    state.currentFilePath = tab.filePath;
    pane.editor.focus();
    const lang = tab.filePath ? detectLanguage(tab.label) : 'cpp';
    const sel  = document.getElementById('lang-select');
    if (sel) sel.value = lang;
    document.title = tab.filePath || 'untitled';
  }
  updateBreadcrumb(tab.filePath, pane);
  pane.tabBarEl.querySelectorAll('.tab').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.tabId) === tabId));
}

// ---- Đóng tab ----
export function closeTab(tabId) {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  if (tab.isModified && !confirm(`"${tab.label}" có thay đổi chưa lưu. Đóng vẫn tiếp tục?`)) return;

  const pane = getPaneForTab(tabId);
  if (!pane) return;

  // Dispose model nếu không còn tab nào khác dùng chung
  let shared = false;
  for (const [tid, t] of state.tabs) {
    if (tid !== tabId && t.model === tab.model) { shared = true; break; }
  }
  if (!shared) tab.model.dispose();

  state.tabs.delete(tabId);
  pane.tabIds = pane.tabIds.filter(x => x !== tabId);
  pane.tabBarEl.querySelector(`[data-tab-id="${tabId}"]`)?.remove();

  if (pane.activeTabId === tabId) {
    if (pane.tabIds.length > 0) {
      activateTabInPane(pane.tabIds[pane.tabIds.length - 1], pane);
    } else if (state.panes.length > 1) {
      removePane(pane.id);
    } else {
      pane.activeTabId     = null;
      state.currentFilePath = null;
      if (pane.editor) pane.editor.setModel(monaco.editor.createModel('', 'plaintext'));
      updateBreadcrumb(null, pane);
      document.title = 'RCE App';
    }
  }
}

// ---- Append tab element vào tab bar của pane ----
export function appendTabElToPane(tabId, pane) {
  if (!pane?.tabBarEl) return;
  pane.tabBarEl.appendChild(buildTabEl(tabId, pane));
  setTimeout(() => pane.tabBarEl
    .querySelector(`[data-tab-id="${tabId}"]`)
    ?.scrollIntoView({ inline: 'nearest' }), 0);
}

// ---- Build DOM element cho một tab ----
export function buildTabEl(tabId, pane) {
  const tab = state.tabs.get(tabId);
  const el  = document.createElement('div');
  el.className  = `tab${pane?.activeTabId === tabId ? ' active' : ''}${tab.isModified ? ' modified' : ''}`;
  el.dataset.tabId = tabId;
  el.title      = tab.filePath || tab.label;
  el.draggable  = true;

  el.innerHTML = `
    <span class="tab-file-icon">${tab.filePath ? getBcFileIcon(tab.label) : BC_ICON.__default__}</span>
    <span class="tab-name">${escapeHtml(tab.label)}</span>
    <span class="tab-modified-dot" title="Unsaved changes">●</span>
    <button class="tab-close" title="Close">×</button>
  `;

  el.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) activateTab(tabId);
  });
  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });
  // Middle click để đóng tab
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); closeTab(tabId); }
  });

  // Drag & Drop (showDropZones từ drag-drop.js — circular import nhưng safe)
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(tabId));
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
    setTimeout(() => showDropZones(), 0);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    hideDropZones();
  });

  return el;
}

// ---- Refresh trạng thái modified của tab element ----
export function refreshTabEl(tabId) {
  const pane = getPaneForTab(tabId);
  if (!pane) return;
  const el = pane.tabBarEl.querySelector(`[data-tab-id="${tabId}"]`);
  if (!el) return;
  el.classList.toggle('modified', state.tabs.get(tabId)?.isModified ?? false);
}

// ---- Di chuyển tab sang pane khác (dùng bởi drag-drop) ----
export function moveTabToPane(tabId, targetPaneId) {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  const src = getPaneForTab(tabId);
  const dst = getPaneById(targetPaneId);
  if (!src || !dst || src === dst) return;

  src.tabIds = src.tabIds.filter(x => x !== tabId);
  src.tabBarEl.querySelector(`[data-tab-id="${tabId}"]`)?.remove();

  if (src.activeTabId === tabId) {
    if (src.tabIds.length > 0) {
      activateTabInPane(src.tabIds[src.tabIds.length - 1], src);
    } else {
      src.activeTabId = null;
      if (src.editor) src.editor.setModel(monaco.editor.createModel('', 'plaintext'));
      updateBreadcrumb(null, src);
    }
  }

  dst.tabIds.push(tabId);
  appendTabElToPane(tabId, dst);
  focusPane(dst.id);
  activateTabInPane(tabId, dst);

  // Xóa pane nguồn nếu không còn tab nào
  if (src.tabIds.length === 0 && state.panes.length > 1) removePane(src.id);
}
