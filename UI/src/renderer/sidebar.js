// =====================================================================
// SIDEBAR — File Explorer tree, toolbar actions, resize handle
// =====================================================================
import { state, LS }                  from './state.js';
import { SVG, getFileIcon }           from './icons.js';
import { isBinaryFile, rebuildFileIndex } from './utils.js';
import { openOrActivateTab }          from './tab.js';

// =====================================================================
// TREE STATE PERSISTENCE
// =====================================================================

/** Lưu danh sách folder đang expanded vào localStorage. */
export function saveTreeState() {
  const expanded = [];
  document.querySelectorAll('.tree-item.open[data-path]').forEach(li =>
    expanded.push(li.dataset.path));
  localStorage.setItem(LS.EXPANDED, JSON.stringify(expanded));
}

/** Khôi phục trạng thái expand của các folder từ localStorage. */
function restoreExpandedState() {
  let expandedPaths;
  try {
    expandedPaths = new Set(JSON.parse(localStorage.getItem(LS.EXPANDED) || '[]'));
  } catch { return; }
  document.querySelectorAll('.tree-item[data-path]').forEach(li => {
    if (expandedPaths.has(li.dataset.path)) {
      li.querySelector('.tree-folder-label')?.click();
    }
  });
}

// =====================================================================
// FOLDER OPENED — build file tree DOM từ data gửi từ main process
// =====================================================================

/**
 * Handler cho event 'folder-opened' từ Electron IPC.
 * Được gọi từ index.js: window.electronAPI.onFolderOpened(onFolderOpened)
 * @param {{ items: Array, folderPath: string }} data
 */
export function onFolderOpened(data) {
  state.rootFolderPath = data.folderPath;
  state.currentDirPath = data.folderPath;
  localStorage.setItem(LS.FOLDER, data.folderPath);

  // Rebuild file index để quick-open có thể search
  state.fileIndex = rebuildFileIndex(data.items, data.folderPath);

  const fileList = document.getElementById('file-list');
  fileList.innerHTML = '';

  // Header hiển thị tên root folder
  const header = document.createElement('div');
  header.className   = 'tree-root-header';
  header.textContent = data.folderPath.split(/[\\/]/).pop().toUpperCase();
  fileList.appendChild(header);

  const rootUl = document.createElement('ul');
  rootUl.className = 'tree-root';
  fileList.appendChild(rootUl);

  buildTreeDOM(data.items, rootUl);
  restoreExpandedState();
}

/** Đệ quy tạo DOM nodes cho file tree. */
function buildTreeDOM(items, parentUl) {
  const sorted = [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(item => {
    const li = document.createElement('li');
    li.className = 'tree-item';

    if (item.isDirectory) {
      li.dataset.path = item.path;
      li.appendChild(buildFolderLabel(item, li));

      const childrenUl = document.createElement('ul');
      childrenUl.className = 'tree-children';
      if (item.children?.length > 0) buildTreeDOM(item.children, childrenUl);
      li.appendChild(childrenUl);
    } else {
      li.appendChild(buildFileLabel(item));
    }

    parentUl.appendChild(li);
  });
}

function buildFolderLabel(item, li) {
  const label  = document.createElement('span');
  label.className = 'tree-label tree-folder-label';

  const arrow = document.createElement('span');
  arrow.className  = 'tree-arrow';
  arrow.textContent = '▶';

  const icon = document.createElement('span');
  icon.className  = 'tree-icon';
  icon.textContent = '📁';

  const name = document.createElement('span');
  name.className  = 'tree-name';
  name.textContent = item.name;

  label.appendChild(arrow);
  label.appendChild(icon);
  label.appendChild(name);

  const childrenUl = li.querySelector?.('.tree-children') ||
    li.nextElementSibling; // fallback — will be attached by caller

  label.addEventListener('click', (e) => {
    e.stopPropagation();
    state.currentDirPath = item.path;
    const isOpen = li.classList.toggle('open');
    arrow.textContent = isOpen ? '▼' : '▶';
    icon.textContent  = isOpen ? '📂' : '📁';
    // childrenUl đã là sibling thứ 2 của li
    const ul = li.querySelector('.tree-children');
    if (ul) ul.style.display = isOpen ? 'block' : 'none';
    saveTreeState();
  });

  return label;
}

function buildFileLabel(item) {
  const label  = document.createElement('span');
  label.className = 'tree-label tree-file-label';
  label.title     = item.path;

  const spacer = document.createElement('span');
  spacer.className = 'tree-arrow tree-arrow-spacer';

  const iconEl = document.createElement('span');
  iconEl.className  = 'tree-icon';
  iconEl.textContent = getFileIcon(item.name);

  const nameEl = document.createElement('span');
  nameEl.className  = 'tree-name';
  nameEl.textContent = item.name;

  label.appendChild(spacer);
  label.appendChild(iconEl);
  label.appendChild(nameEl);

  label.addEventListener('click', (e) => {
    e.stopPropagation();
    // Deselect cũ, select mới
    if (state.selectedFileEl) state.selectedFileEl.classList.remove('tree-selected');
    label.classList.add('tree-selected');
    state.selectedFileEl = label;

    if (isBinaryFile(item.name)) {
      alert(`"${item.name}" là file binary, không thể mở dạng text.`);
    } else {
      window.electronAPI.requestReadFile(item.path);
    }
  });

  return label;
}

// =====================================================================
// SIDEBAR TOOLBAR — New File / New Folder / Refresh / Collapse All
// =====================================================================

/** Inject toolbar vào đầu sidebar. Chỉ tạo một lần. */
export function buildSidebarToolbar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || document.getElementById('sidebar-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.id        = 'sidebar-toolbar';
  toolbar.className = 'sidebar-toolbar';
  toolbar.innerHTML = `
    <span class="sidebar-toolbar-title">EXPLORER</span>
    <div class="sidebar-toolbar-actions" id="stb-actions">
      <button class="stb-btn" id="stb-new-file"   title="New File">${SVG.newFile}</button>
      <button class="stb-btn" id="stb-new-folder" title="New Folder">${SVG.newFolder}</button>
      <button class="stb-btn" id="stb-refresh"    title="Refresh Explorer">${SVG.refresh}</button>
      <button class="stb-btn" id="stb-collapse"   title="Collapse All">${SVG.collapseAll}</button>
    </div>
  `;
  sidebar.insertBefore(toolbar, sidebar.firstChild);

  document.getElementById('stb-new-file').addEventListener('click', () => {
    const dir = state.currentDirPath || state.rootFolderPath;
    if (!dir) return alert('Hãy mở một folder trước!');
    showNameInput(dir, 'file');
  });

  document.getElementById('stb-new-folder').addEventListener('click', () => {
    const dir = state.currentDirPath || state.rootFolderPath;
    if (!dir) return alert('Hãy mở một folder trước!');
    showNameInput(dir, 'folder');
  });

  document.getElementById('stb-refresh').addEventListener('click', () => {
    if (state.rootFolderPath) window.electronAPI.requestOpenFolder(state.rootFolderPath);
  });

  document.getElementById('stb-collapse').addEventListener('click', () => {
    document.querySelectorAll('.tree-item.open').forEach(li => {
      li.classList.remove('open');
      const arrow  = li.querySelector('.tree-arrow');
      const icon   = li.querySelector('.tree-icon');
      const childUl = li.querySelector('.tree-children');
      if (arrow)   arrow.textContent  = '▶';
      if (icon)    icon.textContent   = '📁';
      if (childUl) childUl.style.display = 'none';
    });
    saveTreeState();
  });
}

// =====================================================================
// INLINE NAME INPUT — tạo file / folder mới ngay trong tree
// =====================================================================

function showNameInput(dirPath, type) {
  document.getElementById('inline-name-input-item')?.remove();

  const fileList = document.getElementById('file-list');
  const rootUl   = fileList.querySelector('.tree-root');
  if (!rootUl) return;

  const li  = document.createElement('li');
  li.id        = 'inline-name-input-item';
  li.className = 'tree-item tree-name-input-item';
  li.innerHTML = `
    <span class="tree-label" style="padding-left:4px">
      <span class="tree-arrow tree-arrow-spacer"></span>
      <span class="tree-icon">${type === 'file' ? '📄' : '📁'}</span>
      <input id="inline-name-input" class="tree-inline-input" type="text"
             placeholder="${type === 'file' ? 'tên-file.txt' : 'tên-folder'}"
             autocomplete="off" spellcheck="false"/>
    </span>
  `;
  rootUl.prepend(li);

  const input = document.getElementById('inline-name-input');
  input.focus();

  const confirm = async () => {
    const name = input.value.trim();
    li.remove();
    if (!name) return;
    const result = await window.electronAPI.createEntry(type, dirPath, name);
    if (result.success) {
      window.electronAPI.requestOpenFolder(state.rootFolderPath);
      if (type === 'file') {
        setTimeout(() => window.electronAPI.requestReadFile(result.path), 300);
      }
    } else {
      alert(`Lỗi tạo ${type}: ${result.error}`);
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  confirm();
    if (e.key === 'Escape') li.remove();
    e.stopPropagation();
  });
  input.addEventListener('blur', () => setTimeout(() => li.remove(), 150));
}

// =====================================================================
// SIDEBAR RESIZE HANDLE — kéo divider để thay đổi width sidebar
// =====================================================================

/** Khởi tạo sidebar resize handle (kéo từ trái editor sang). */
export function initResizeHandle() {
  const handle    = document.getElementById('resize-handle');
  const sidebar   = document.querySelector('.sidebar');
  const container = document.querySelector('.container');
  if (!handle || !sidebar || !container) return;

  // Restore width đã lưu
  const saved = parseInt(localStorage.getItem(LS.SIDEBAR_W), 10);
  if (saved && saved >= 120) sidebar.style.width = saved + 'px';

  let dragging = false, startX, startW;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newW = Math.min(
      Math.max(120, startW + (startX - e.clientX)),
      container.offsetWidth * 0.6,
    );
    sidebar.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    localStorage.setItem(LS.SIDEBAR_W, sidebar.offsetWidth);
  });

  // Double-click → reset về 250px
  handle.addEventListener('dblclick', () => {
    sidebar.style.width = '250px';
    localStorage.setItem(LS.SIDEBAR_W, 250);
  });
}
