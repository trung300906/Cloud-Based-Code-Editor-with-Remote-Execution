// =====================================================================
// PANE — Quản lý pane system (leaf panes, recursive split tree, focus)
//
// Circular imports với tab.js là có chủ đích và an toàn:
// - pane.js dùng activateTabInPane, appendTabElToPane, openOrActivateTab
//   từ tab.js — nhưng chỉ trong function bodies (không phải init code)
// - ES modules xử lý circular fine với live bindings
// =====================================================================
import { state }                from './state.js';
import { detectLanguage }       from './lang-detect.js';
import { initSplitHandleResize } from './split-resize.js';
// circular import — chỉ dùng trong function bodies
import { activateTabInPane, appendTabElToPane, openOrActivateTab } from './tab.js';

// ---- Helpers ----
export function getFocusedPane()   { return getPaneById(state.focusedPaneId) || state.panes[0]; }
export function getPaneById(id)    { return state.panes.find(p => p.id === id); }
export function getPaneForTab(tid) { return state.panes.find(p => p.tabIds.includes(tid)); }

// ---- Tạo một leaf pane mới (chưa insert vào DOM) ----
export function createLeafPane() {
  const id = ++state.paneIdCounter;
  const el = document.createElement('div');
  el.className   = 'editor-pane';
  el.dataset.paneId = id;

  const tabBarEl    = document.createElement('div');
  tabBarEl.className = 'tab-bar';

  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.className = 'breadcrumb-bar';
  breadcrumbEl.innerHTML = '<span class="bc-segment bc-file">untitled</span>';

  const containerEl = document.createElement('div');
  containerEl.className = 'pane-editor-container';

  el.appendChild(tabBarEl);
  el.appendChild(breadcrumbEl);
  el.appendChild(containerEl);

  const pane = { id, el, tabBarEl, breadcrumbEl, containerEl, editor: null, tabIds: [], activeTabId: null };
  state.panes.push(pane);

  // Focus pane khi click vào
  el.addEventListener('mousedown', () => focusPane(id), true);

  // Tạo Monaco editor nếu đã sẵn sàng (trường hợp tạo pane sau khi Monaco load)
  if (state.monacoReady) {
    pane.editor = monaco.editor.create(containerEl, {
      value: '', language: 'plaintext',
      theme: document.body.classList.contains('light-mode') ? 'vs' : 'vs-dark',
      automaticLayout: true, fontSize: 14,
      minimap: { enabled: true }, scrollBeyondLastLine: false,
    });
  }
  return pane;
}

// ---- Khởi tạo root pane đầu tiên ----
export function initRootPane() {
  const pane = createLeafPane();
  const main = document.getElementById('main-editor');
  main.innerHTML = '';
  main.appendChild(pane.el);
  state.splitRoot = { type: 'leaf', paneId: pane.id, el: pane.el };
  focusPane(pane.id);
  return pane;
}

// ---- Tìm node trong split tree ----
export function findNode(node, paneId) {
  if (!node) return null;
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  for (const child of node.children) {
    const found = findNode(child, paneId);
    if (found) return found;
  }
  return null;
}

export function findParent(node, paneId, parent) {
  if (!node) return null;
  if (node.type === 'leaf') return node.paneId === paneId ? parent : null;
  for (const child of node.children) {
    const found = findParent(child, paneId, node);
    if (found) return found;
  }
  return null;
}

export function replaceChildInTree(node, oldChild, newChild) {
  if (!node || node.type !== 'split') return false;
  const idx = node.children.indexOf(oldChild);
  if (idx !== -1) { node.children[idx] = newChild; return true; }
  for (const c of node.children) {
    if (replaceChildInTree(c, oldChild, newChild)) return true;
  }
  return false;
}

export function findNodeByEl(node, el) {
  if (!node) return null;
  if (node.el === el) return node;
  if (node.type === 'split') {
    for (const c of node.children) {
      const f = findNodeByEl(c, el);
      if (f) return f;
    }
  }
  return null;
}

// ---- Focus pane ----
export function focusPane(paneId) {
  const pane = getPaneById(paneId);
  if (!pane) return;
  state.focusedPaneId = paneId;
  state.panes.forEach(p => p.el.classList.toggle('focused', p.id === paneId));
  const tab = pane.activeTabId ? state.tabs.get(pane.activeTabId) : null;
  state.currentFilePath = tab?.filePath || null;
  if (tab) {
    const lang = tab.filePath ? detectLanguage(tab.label) : 'cpp';
    const sel  = document.getElementById('lang-select');
    if (sel) sel.value = lang;
    document.title = tab.filePath || 'untitled';
  }
}

// ---- Split pane theo chiều ngang hoặc dọc ----
export function splitPane(paneId, direction, side) {
  const pane = getPaneById(paneId);
  if (!pane) return null;

  const leaf   = findNode(state.splitRoot, paneId);
  if (!leaf) return null;
  const parent = findParent(state.splitRoot, paneId, null);

  const newPane = createLeafPane();
  const newLeaf = { type: 'leaf', paneId: newPane.id, el: newPane.el };

  const handle = document.createElement('div');
  handle.className = direction === 'horizontal'
    ? 'split-handle split-handle-h'
    : 'split-handle split-handle-v';

  const container = document.createElement('div');
  container.className        = `split-container split-${direction}`;
  container.dataset.splitId  = ++state.splitIdCounter;

  const first  = side === 'before' ? newLeaf : leaf;
  const second = side === 'before' ? leaf    : newLeaf;

  // Lưu vị trí TRƯỚC khi move element (appendChild detach khỏi parent cũ)
  const origParent = leaf.el.parentNode;
  const origNext   = leaf.el.nextSibling;

  container.appendChild(first.el);
  container.appendChild(handle);
  container.appendChild(second.el);

  if (origParent) origParent.insertBefore(container, origNext);

  const splitNode = { type: 'split', direction, el: container, children: [first, second] };

  if (leaf === state.splitRoot) {
    state.splitRoot = splitNode;
  } else if (parent) {
    const idx = parent.children.indexOf(leaf);
    if (idx !== -1) parent.children[idx] = splitNode;
  }

  initSplitHandleResize(handle, direction);
  focusPane(newPane.id);
  return newPane;
}

// ---- Xóa pane, collapse split tree, chuyển tabs sang pane khác ----
export function removePane(paneId) {
  if (state.panes.length <= 1) return;
  const pane = getPaneById(paneId);
  if (!pane) return;

  // Chuyển tất cả tabs sang pane đầu tiên còn lại
  const target = state.panes.find(p => p.id !== paneId);
  if (!target) return;

  [...pane.tabIds].forEach(tid => {
    pane.tabIds = pane.tabIds.filter(x => x !== tid);
    pane.tabBarEl.querySelector(`[data-tab-id="${tid}"]`)?.remove();
    target.tabIds.push(tid);
    appendTabElToPane(tid, target);
  });

  if (pane.editor) pane.editor.dispose();

  // Collapse tree: tìm sibling, thay thế split-container bằng sibling
  const parent = findParent(state.splitRoot, paneId, null);
  if (parent && parent.type === 'split') {
    const sibling = parent.children.find(c =>
      !(c.type === 'leaf' && c.paneId === paneId)
    );
    if (sibling) {
      sibling.el.style.flex = '';
      if (parent.el.parentNode) parent.el.parentNode.replaceChild(sibling.el, parent.el);
      if (parent === state.splitRoot) {
        state.splitRoot = sibling;
      } else {
        replaceChildInTree(state.splitRoot, parent, sibling);
      }
    }
  } else {
    pane.el.remove();
  }

  const pidx = state.panes.findIndex(p => p.id === paneId);
  if (pidx !== -1) state.panes.splice(pidx, 1);

  focusPane(target.id);
  if (target.tabIds.length > 0)
    activateTabInPane(target.activeTabId || target.tabIds[0], target);
}

// ---- Split editor command (Ctrl+\) ----
export function splitEditor(direction) {
  const src    = getFocusedPane();
  const tab    = src.activeTabId ? state.tabs.get(src.activeTabId) : null;
  const newPane = splitPane(src.id, direction || 'horizontal', 'after');
  if (!newPane) return;

  if (tab) {
    const id = ++state.tabCounter;
    state.tabs.set(id, {
      id, filePath: tab.filePath, label: tab.label,
      model: tab.model, isModified: tab.isModified,
    });
    newPane.tabIds.push(id);
    appendTabElToPane(id, newPane);
    activateTabInPane(id, newPane);
  } else {
    openOrActivateTab(null, '// Enter your code here...', newPane.id);
  }
}
