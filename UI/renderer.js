// =====================================================================
// LANGUAGE DETECTION ENGINE
// =====================================================================
const EXT_LANG_MAP = {
  'c':'c','h':'c',
  'cpp':'cpp','cc':'cpp','cxx':'cpp','c++':'cpp','hpp':'cpp','hh':'cpp','hxx':'cpp',
  'cs':'csharp',
  'java':'java','kt':'kotlin','kts':'kotlin','scala':'scala','groovy':'groovy',
  'py':'python','pyw':'python',
  'rb':'ruby','php':'php','lua':'lua','pl':'perl','r':'r',
  'js':'javascript','mjs':'javascript','cjs':'javascript',
  'ts':'typescript','mts':'typescript',
  'jsx':'javascript','tsx':'typescript',
  'html':'html','htm':'html','css':'css','scss':'scss','less':'less','vue':'html',
  'rs':'rust','go':'go','swift':'swift',
  'sh':'shell','bash':'shell','zsh':'shell','fish':'shell',
  'ps1':'powershell','bat':'bat','cmd':'bat',
  'json':'json','jsonc':'json','yaml':'yaml','yml':'yaml',
  'toml':'ini','ini':'ini','cfg':'ini','conf':'ini',
  'xml':'xml','svg':'xml','xaml':'xml','sql':'sql','env':'ini',
  'md':'markdown','mdx':'markdown','tex':'latex','rst':'restructuredtext',
  'mmd':'mermaid','puml':'plaintext',
  'txt':'plaintext','log':'plaintext','diff':'diff','patch':'diff',
  'dockerfile':'dockerfile','makefile':'makefile',
};

const ALL_LANGUAGES = [
  {value:'plaintext',label:'Plain Text'},{value:'c',label:'C'},{value:'cpp',label:'C++'},
  {value:'csharp',label:'C#'},{value:'python',label:'Python'},{value:'javascript',label:'JavaScript'},
  {value:'typescript',label:'TypeScript'},{value:'java',label:'Java'},{value:'kotlin',label:'Kotlin'},
  {value:'rust',label:'Rust'},{value:'go',label:'Go'},{value:'swift',label:'Swift'},
  {value:'php',label:'PHP'},{value:'ruby',label:'Ruby'},{value:'lua',label:'Lua'},
  {value:'shell',label:'Shell/Bash'},{value:'powershell',label:'PowerShell'},{value:'bat',label:'Batch'},
  {value:'html',label:'HTML'},{value:'css',label:'CSS'},{value:'scss',label:'SCSS'},
  {value:'less',label:'Less'},{value:'json',label:'JSON'},{value:'yaml',label:'YAML'},
  {value:'xml',label:'XML'},{value:'sql',label:'SQL'},{value:'markdown',label:'Markdown'},
  {value:'mermaid',label:'Mermaid'},{value:'ini',label:'INI / TOML'},{value:'dockerfile',label:'Dockerfile'},
  {value:'makefile',label:'Makefile'},{value:'diff',label:'Diff / Patch'},{value:'latex',label:'LaTeX'},
  {value:'r',label:'R'},{value:'scala',label:'Scala'},
];

function detectLanguage(filename) {
  if (!filename) return 'plaintext';
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'ini';
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return 'plaintext';
  return EXT_LANG_MAP[lower.slice(dotIdx + 1)] || 'plaintext';
}

// =====================================================================
// STATE PERSISTENCE (localStorage — tồn tại qua restart)
// =====================================================================
const LS_FOLDER   = 'rce_last_folder';
const LS_EXPANDED = 'rce_expanded_folders';
const LS_THEME    = 'rce_theme';

function saveTreeState() {
  const expanded = [];
  document.querySelectorAll('.tree-item.open[data-path]').forEach(li => expanded.push(li.dataset.path));
  localStorage.setItem(LS_EXPANDED, JSON.stringify(expanded));
}

function restoreExpandedState() {
  let expandedPaths;
  try { expandedPaths = new Set(JSON.parse(localStorage.getItem(LS_EXPANDED) || '[]')); }
  catch { return; }
  document.querySelectorAll('.tree-item[data-path]').forEach(li => {
    if (expandedPaths.has(li.dataset.path)) {
      const label = li.querySelector('.tree-folder-label');
      if (label) label.click();
    }
  });
}

// =====================================================================
// SVG ICONS cho Sidebar Toolbar
// =====================================================================
const SVG = {
  newFile: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.5 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9.5 1z"/>
    <polyline points="9.5,1 9.5,5 13,5"/>
    <line x1="8" y1="9" x2="8" y2="13"/>
    <line x1="6" y1="11" x2="10" y2="11"/>
  </svg>`,
  newFolder: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 4.5a1 1 0 011-1h4l1.5 1.5H14a1 1 0 011 1V13a1 1 0 01-1 1H2a1 1 0 01-1-1V4.5z"/>
    <line x1="8" y1="8.5" x2="8" y2="12"/>
    <line x1="6.2" y1="10.2" x2="9.8" y2="10.2"/>
  </svg>`,
  refresh: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="1,4 1,8 5,8"/>
    <path d="M3.5 12a6.5 6.5 0 102-9.5L1 8"/>
  </svg>`,
  collapseAll: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="7" width="8" height="8" rx="1"/>
    <path d="M4 7V4a1 1 0 011-1h8a1 1 0 011 1v8a1 1 0 01-1 1h-3"/>
    <polyline points="5,3.5 9,1 13,3.5"/>
  </svg>`,
};

// =====================================================================
// RUNTIME STATE
// =====================================================================
let currentFilePath = null;
let currentDirPath  = null;
let rootFolderPath  = null;
let editor;
let selectedFileEl  = null;

// =====================================================================
// TAB SYSTEM
// =====================================================================
const tabs        = new Map();
let activeTabId   = null;
let tabCounter    = 0;
let monacoReady   = false;
const pendingOpen = [];

function getTabByPath(fp) {
  for (const t of tabs.values()) if (t.filePath === fp) return t;
  return null;
}

function openOrActivateTab(filePath, content) {
  if (!monacoReady) { pendingOpen.push({ filePath, content }); return; }

  const existing = filePath ? getTabByPath(filePath) : null;
  if (existing) { activateTab(existing.id); return; }

  const id    = ++tabCounter;
  const label = filePath ? filePath.split(/[\\/]/).pop()
                         : `untitled-${id}`;
  const lang  = filePath ? detectLanguage(label) : 'cpp';

  const uri   = filePath
    ? monaco.Uri.file(filePath)
    : monaco.Uri.parse(`inmemory://model/${id}`);
  const model = monaco.editor.createModel(content || '', lang, uri);

  model.onDidChangeContent(() => {
    const t = tabs.get(id);
    if (t && !t.isModified) { t.isModified = true; refreshTabEl(id); }
  });

  tabs.set(id, { id, filePath, label, model, isModified: false });
  appendTabEl(id);
  activateTab(id);
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab || !editor) return;

  activeTabId    = id;
  currentFilePath = tab.filePath;

  editor.setModel(tab.model);
  editor.focus();

  const lang = tab.filePath ? detectLanguage(tab.label) : 'cpp';
  const sel  = document.getElementById('lang-select');
  if (sel) sel.value = lang;

  updateBreadcrumb(tab.filePath);
  document.title = tab.filePath || 'untitled';

  document.querySelectorAll('.tab').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.tabId) === id));
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  if (tab.isModified) {
    const yes = confirm(`"${tab.label}" có thay đổi chưa lưu. Đóng vẫn tiếp tục?`);
    if (!yes) return;
  }

  tab.model.dispose();
  tabs.delete(id);

  const el = document.querySelector(`.tab[data-tab-id="${id}"]`);
  if (el) el.remove();

  if (activeTabId === id) {
    const ids = [...tabs.keys()];
    if (ids.length > 0) {
      activateTab(ids[ids.length - 1]);
    } else {
      activeTabId    = null;
      currentFilePath = null;
      editor.setModel(monaco.editor.createModel('', 'plaintext'));
      updateBreadcrumb(null);
      document.title = 'RCE App';
    }
  }
}

function appendTabEl(id) {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.appendChild(buildTabEl(id));
  setTimeout(() => bar.querySelector(`[data-tab-id="${id}"]`)?.scrollIntoView({ inline: 'nearest' }), 0);
}

function buildTabEl(id) {
  const tab = tabs.get(id);
  const el  = document.createElement('div');
  el.className  = `tab${id === activeTabId ? ' active' : ''}${tab.isModified ? ' modified' : ''}`;
  el.dataset.tabId = id;
  el.title = tab.filePath || tab.label;

  el.innerHTML = `
    <span class="tab-file-icon">${tab.filePath ? getBcFileIcon(tab.label) : BC_ICON.__default__}</span>
    <span class="tab-name">${tab.label}</span>
    <span class="tab-modified-dot" title="Unsaved changes">●</span>
    <button class="tab-close" title="Close (middle-click)">×</button>
  `;

  el.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    activateTab(id);
  });
  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation(); closeTab(id);
  });
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); closeTab(id); }
  });

  return el;
}

function refreshTabEl(id) {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  const old = bar.querySelector(`[data-tab-id="${id}"]`);
  if (!old) return;
  const tab = tabs.get(id);
  if (!tab) return;
  old.classList.toggle('modified', tab.isModified);
}

// =====================================================================
// BREADCRUMB
// =====================================================================
const BC_ICON = {
  __folder__: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 4.5A1 1 0 012 3.5h4l1.5 2H14A1 1 0 0115 6.5v7a1 1 0 01-1 1H2a1 1 0 01-1-1v-9z" fill="#dcb67a" opacity=".9"/></svg>`,
  cpp   : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#9cdcfe" font-family="monospace">C+</text></svg>`,
  c     : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#9cdcfe" font-family="monospace">C</text></svg>`,
  h     : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#9cdcfe" font-family="monospace">H</text></svg>`,
  py    : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#4ec9b0" font-family="monospace">Py</text></svg>`,
  js    : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#f0db4f" opacity=".15"/><text y="13" font-size="11" fill="#f0db4f" font-family="monospace">JS</text></svg>`,
  ts    : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#3178c6" opacity=".2"/><text y="13" font-size="11" fill="#3d9fe0" font-family="monospace">TS</text></svg>`,
  json  : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="10" fill="#cbcb41" font-family="monospace">{}</text></svg>`,
  md    : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="10" fill="#519aba" font-family="monospace">MD</text></svg>`,
  html  : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="9"  fill="#e34c26" font-family="monospace">HTML</text></svg>`,
  css   : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="9"  fill="#563d7c" font-family="monospace">CSS</text></svg>`,
  rs    : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#dea584" font-family="monospace">Rs</text></svg>`,
  go    : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#00acd7" font-family="monospace">Go</text></svg>`,
  yaml  : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="9"  fill="#cbcb41" font-family="monospace">YML</text></svg>`,
  mmd   : `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#a78bfa" font-family="monospace">⬡</text></svg>`,
  __default__: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><path d="M4 1h6l4 4v10H4V1z" fill="none" stroke="#cccccc" stroke-width="1.2"/><polyline points="10,1 10,5 14,5" fill="none" stroke="#cccccc" stroke-width="1.2"/></svg>`,
};

function getBcFileIcon(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const aliases = { cc:'cpp', cxx:'cpp', hpp:'cpp', hh:'cpp', hxx:'cpp',
                    mjs:'js', cjs:'js', jsx:'js', tsx:'ts',
                    yml:'yaml', jsonc:'json', htm:'html', scss:'css', less:'css' };
  const key = aliases[ext] || ext;
  return BC_ICON[key] || BC_ICON.__default__;
}

function updateBreadcrumb(filePath) {
  const bar = document.getElementById('breadcrumb');
  if (!bar) return;

  if (!filePath) {
    bar.innerHTML =
      `${BC_ICON.__default__}<span class="bc-segment bc-file" style="color:#858585;font-style:italic">untitled</span>`;
    return;
  }

  const norm    = filePath.replace(/\\/g, '/');
  const normRoot = (rootFolderPath || '').replace(/\\/g, '/');

  let allParts = norm.split('/').filter(Boolean);

  if (normRoot && norm.startsWith(normRoot)) {
    const rootParts = normRoot.split('/').filter(Boolean);
    allParts = allParts.slice(rootParts.length - 1);
  } else {
    allParts = allParts.slice(-3);
  }

  let segments;
  if (allParts.length <= 4) {
    segments = allParts.map((name, i) => ({ name, isFile: i === allParts.length - 1 }));
  } else {
    segments = [
      { name: allParts[0],                      isFile: false },
      { name: '…',                               isFile: false, isEllipsis: true },
      { name: allParts[allParts.length - 2],     isFile: false },
      { name: allParts[allParts.length - 1],     isFile: true  },
    ];
  }

  bar.innerHTML = segments.map((seg, i) => {
    const sep   = i > 0 ? `<span class="bc-sep">›</span>` : '';
    const icon  = seg.isEllipsis ? '' :
                  seg.isFile ? getBcFileIcon(seg.name) : BC_ICON.__folder__;
    const cls   = `bc-segment ${seg.isFile ? 'bc-file' : 'bc-dir'}${seg.isEllipsis ? ' bc-ellipsis' : ''}`;
    return `${sep}<span class="${cls}" title="${seg.name}">${icon}${seg.name}</span>`;
  }).join('');
}

// =====================================================================
// CUSTOM MENU BAR — dropdown logic + action handler
// =====================================================================
let _openMenuItem = null;

function initCustomMenubar() {
  const menubar   = document.getElementById('custom-menubar');
  if (!menubar) return;
  const menuItems = menubar.querySelectorAll('.menu-item');

  function closeAllMenus() {
    menuItems.forEach(item => item.classList.remove('open'));
    _openMenuItem = null;
  }

  menuItems.forEach(item => {
    const label = item.querySelector('.menu-label');

    label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.classList.contains('open')) {
        closeAllMenus();
      } else {
        closeAllMenus();
        item.classList.add('open');
        _openMenuItem = item;
      }
    });

    label.addEventListener('mouseenter', () => {
      if (_openMenuItem && _openMenuItem !== item) {
        closeAllMenus();
        item.classList.add('open');
        _openMenuItem = item;
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-item')) closeAllMenus();
  });

  menubar.querySelectorAll('.menu-entry').forEach(entry => {
    entry.addEventListener('click', () => {
      const action = entry.dataset.action;
      closeAllMenus();
      handleMenuAction(action);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _openMenuItem) { closeAllMenus(); return; }
  });

  // Theme toggle — attached here so it works even before Monaco loads
  const themeBtn = document.getElementById('theme-toggle-btn');
  let isDarkMode = localStorage.getItem(LS_THEME) !== 'light';
  if (!isDarkMode) {
    document.body.classList.add('light-mode');
    if (themeBtn) themeBtn.textContent = '☀️ Light Mode: ON';
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem(LS_THEME, isDarkMode ? 'dark' : 'light');
      if (isDarkMode) {
        document.body.classList.remove('light-mode');
        themeBtn.textContent = '🌙 Dark Mode: ON';
        if (typeof monaco !== 'undefined') monaco.editor.setTheme('vs-dark');
      } else {
        document.body.classList.add('light-mode');
        themeBtn.textContent = '☀️ Light Mode: ON';
        if (typeof monaco !== 'undefined') monaco.editor.setTheme('vs');
      }
    });
  }

  // Language dropdown — also attached early
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', (e) => setEditorLanguage(e.target.value));
  }
}

function doSave() {
  if (!editor) return;
  const content = editor.getValue();
  window.electronAPI.sendSaveFile({ filePath: currentFilePath || null, content });
  if (currentFilePath) {
    const tab = tabs.get(activeTabId);
    if (tab) { tab.isModified = false; refreshTabEl(activeTabId); }
  }
}

function handleMenuAction(action) {
  switch (action) {
    case 'new-file':
      openOrActivateTab(null, '// Enter your code here...');
      break;
    case 'open-file':
      window.electronAPI.menuOpenFile();
      break;
    case 'open-folder':
      window.electronAPI.menuOpenFolder();
      break;
    case 'save':
      doSave();
      break;
    case 'quit':
      window.electronAPI.appQuit();
      break;

    case 'undo':
      if (editor) editor.trigger('menu', 'undo', null);
      break;
    case 'redo':
      if (editor) editor.trigger('menu', 'redo', null);
      break;
    case 'cut':
      document.execCommand('cut');
      break;
    case 'copy':
      document.execCommand('copy');
      break;
    case 'paste':
      document.execCommand('paste');
      break;
    case 'select-all':
      if (editor) editor.trigger('menu', 'editor.action.selectAll', null);
      break;

    case 'toggle-fullscreen':
      window.electronAPI.winToggleFullscreen();
      break;
    case 'zoom-in':
      window.electronAPI.winZoomIn();
      break;
    case 'zoom-out':
      window.electronAPI.winZoomOut();
      break;
    case 'reset-zoom':
      window.electronAPI.winResetZoom();
      break;
    case 'toggle-devtools':
      window.electronAPI.winToggleDevtools();
      break;

    case 'minimize':
      window.electronAPI.winMinimize();
      break;
    case 'reload':
      window.electronAPI.winReload();
      break;
    case 'close-window':
      window.electronAPI.winClose();
      break;
  }
}

// =====================================================================
// KEYBOARD SHORTCUTS (thay thế accelerator của native menu)
// =====================================================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && !e.shiftKey && e.key === 'n') {
      e.preventDefault(); handleMenuAction('new-file');
    } else if (ctrl && !e.shiftKey && e.key === 'o') {
      e.preventDefault(); handleMenuAction('open-file');
    } else if (ctrl && !e.shiftKey && e.key === 's') {
      e.preventDefault(); handleMenuAction('save');
    } else if (ctrl && !e.shiftKey && e.key === 'q') {
      e.preventDefault(); handleMenuAction('quit');
    } else if (e.key === 'F11') {
      e.preventDefault(); handleMenuAction('toggle-fullscreen');
    } else if (ctrl && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
      e.preventDefault(); handleMenuAction('toggle-devtools');
    } else if (ctrl && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
      e.preventDefault(); handleMenuAction('reload');
    }
  });
}

// =====================================================================
// SIDEBAR TOOLBAR — inject vào DOM
// =====================================================================
function buildSidebarToolbar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || document.getElementById('sidebar-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'sidebar-toolbar';
  toolbar.className = 'sidebar-toolbar';
  toolbar.innerHTML = `
    <span class="sidebar-toolbar-title">EXPLORER</span>
    <div class="sidebar-toolbar-actions" id="stb-actions">
      <button class="stb-btn" id="stb-new-file"   title="New File (tạo trong thư mục đang chọn)">${SVG.newFile}</button>
      <button class="stb-btn" id="stb-new-folder" title="New Folder">${SVG.newFolder}</button>
      <button class="stb-btn" id="stb-refresh"    title="Refresh Explorer">${SVG.refresh}</button>
      <button class="stb-btn" id="stb-collapse"   title="Collapse All">${SVG.collapseAll}</button>
    </div>
  `;
  sidebar.insertBefore(toolbar, sidebar.firstChild);

  document.getElementById('stb-new-file').addEventListener('click', () => {
    const dir = currentDirPath || rootFolderPath;
    if (!dir) return alert('Hãy mở một folder trước!');
    showNameInput(dir, 'file');
  });

  document.getElementById('stb-new-folder').addEventListener('click', () => {
    const dir = currentDirPath || rootFolderPath;
    if (!dir) return alert('Hãy mở một folder trước!');
    showNameInput(dir, 'folder');
  });

  document.getElementById('stb-refresh').addEventListener('click', () => {
    if (!rootFolderPath) return;
    window.electronAPI.requestOpenFolder(rootFolderPath);
  });

  document.getElementById('stb-collapse').addEventListener('click', () => {
    document.querySelectorAll('.tree-item.open').forEach(li => {
      li.classList.remove('open');
      const arrow = li.querySelector('.tree-arrow');
      const icon  = li.querySelector('.tree-icon');
      const childUl = li.querySelector('.tree-children');
      if (arrow) arrow.textContent = '▶';
      if (icon)  icon.textContent  = '📁';
      if (childUl) childUl.style.display = 'none';
    });
    saveTreeState();
  });
}

// =====================================================================
// INLINE NAME INPUT
// =====================================================================
function showNameInput(dirPath, type) {
  const old = document.getElementById('inline-name-input-item');
  if (old) old.remove();

  const fileList = document.getElementById('file-list');
  const rootUl   = fileList.querySelector('.tree-root');
  if (!rootUl) return;

  const li = document.createElement('li');
  li.id = 'inline-name-input-item';
  li.className = 'tree-item tree-name-input-item';

  const icon = type === 'file' ? '📄' : '📁';
  li.innerHTML = `
    <span class="tree-label" style="padding-left:4px">
      <span class="tree-arrow tree-arrow-spacer"></span>
      <span class="tree-icon">${icon}</span>
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
      window.electronAPI.requestOpenFolder(rootFolderPath);
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
// INIT: DOMContentLoaded
// =====================================================================
window.addEventListener('DOMContentLoaded', () => {
  buildSidebarToolbar();
  initCustomMenubar();
  initKeyboardShortcuts();

  const lastFolder = localStorage.getItem(LS_FOLDER);
  if (lastFolder) window.electronAPI.requestOpenFolder(lastFolder);
});

// =====================================================================
// FILE EVENT HANDLERS
// =====================================================================
window.electronAPI.onNewFile(() => {
  openOrActivateTab(null, '// Enter your code here...');
});

window.electronAPI.onFileSaved((path) => {
  const tab = tabs.get(activeTabId);
  if (tab) {
    tab.filePath    = path;
    tab.label       = path.split(/[\\/]/).pop();
    tab.isModified  = false;
    const bar = document.getElementById('tab-bar');
    const old = bar?.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (old) old.replaceWith(buildTabEl(activeTabId));
    document.querySelector(`[data-tab-id="${activeTabId}"]`)?.classList.add('active');
  }
  currentFilePath = path;
  document.title  = path;
  updateBreadcrumb(path);
});

window.electronAPI.onOpenFile((data) => {
  openOrActivateTab(data.filePath, data.content);
});

// =====================================================================
// LANGUAGE DROPDOWN
// =====================================================================
function buildLangDropdown() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.innerHTML = '';
  ALL_LANGUAGES.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    sel.appendChild(opt);
  });
  sel.value = 'cpp';
}

function setEditorLanguage(langId) {
  if (!editor) return;
  if (langId === 'mermaid' && !monaco.languages.getLanguages().find(l => l.id === 'mermaid'))
    registerMermaidLanguage();
  monaco.editor.setModelLanguage(editor.getModel(), langId);
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = langId;
}

// =====================================================================
// MERMAID CUSTOM LANGUAGE
// =====================================================================
function registerMermaidLanguage() {
  monaco.languages.register({ id: 'mermaid' });
  monaco.languages.setMonarchTokensProvider('mermaid', {
    tokenizer: {
      root: [
        [/%%.*$/, 'comment'],
        [/%%\{/, { token: 'comment.doc', next: '@directive' }],
        [/"([^"]*)"/, 'string'],
        [/\b(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|quadrantChart|xychart-beta)\b/, 'keyword'],
        [/\b(LR|RL|TD|TB|BT)\b/, 'keyword'],
        [/\b(subgraph|end|participant|actor|Note|note|loop|alt|else|opt|activate|deactivate|autonumber)\b/, 'keyword'],
        [/\b(class|interface|abstract|enum|state|direction|title|section|dateFormat|axisFormat)\b/, 'keyword'],
        [/\[(\|)?([^\]]*?)(\|)?\]/, 'type'],
        [/--?>|===>|~~~|-.->|--x|--o|<-->/, 'keyword.operator'],
        [/-->|==>|-.->|--/, 'keyword.operator'],
        [/\|([^|]*)\|/, 'string'],
        [/[A-Za-z_][\w]*/, 'identifier'],
        [/\d+(\.\d+)?/, 'number'],
        [/[;,:]/, 'delimiter'],
      ],
      directive: [
        [/\}%%/, { token: 'comment.doc', next: '@pop' }],
        [/./, 'comment.doc'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration('mermaid', {
    comments: { lineComment: '%%' },
    brackets: [['{','}'],['[',']'],['(',')']],
    autoClosingPairs: [{open:'{',close:'}'},{open:'[',close:']'},{open:'(',close:')'},{open:'"',close:'"'}],
  });
}

// =====================================================================
// MONACO INIT
// =====================================================================
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  buildLangDropdown();
  registerMermaidLanguage();

  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '',
    language: 'cpp',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 14,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
  });

  monacoReady = true;
  pendingOpen.forEach(({ filePath, content }) => openOrActivateTab(filePath, content));
  pendingOpen.length = 0;

  if (tabs.size === 0) openOrActivateTab(null, '// Enter your code here...');

  // Sync Monaco theme with what initCustomMenubar already applied to the DOM
  if (localStorage.getItem(LS_THEME) === 'light') {
    monaco.editor.setTheme('vs');
  }

  // Save handler (IPC from main — kept for backwards compat)
  window.electronAPI.onSaveRequest(() => { doSave(); });
});

// =====================================================================
// FILE TREE
// =====================================================================
const BINARY_EXTS = new Set([
  'exe','dll','so','dylib','bin','o','obj','a','lib',
  'zip','tar','gz','bz2','xz','7z','rar',
  'jpg','jpeg','png','gif','bmp','ico','webp','tiff',
  'mp3','mp4','wav','ogg','flac','mkv','avi','mov',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'woff','woff2','ttf','eot','pyc','pyo','class',
]);
function isBinaryFile(filename) {
  return BINARY_EXTS.has(filename.split('.').pop().toLowerCase());
}

window.electronAPI.onFolderOpened((data) => {
  rootFolderPath = data.folderPath;
  currentDirPath = data.folderPath;
  localStorage.setItem(LS_FOLDER, data.folderPath);

  const fileList = document.getElementById('file-list');
  fileList.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'tree-root-header';
  header.textContent = data.folderPath.split(/[\\/]/).pop().toUpperCase();
  fileList.appendChild(header);

  const rootUl = document.createElement('ul');
  rootUl.className = 'tree-root';
  fileList.appendChild(rootUl);

  function createTreeHTML(items, parentUl) {
    const sorted = [...items].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(item => {
      const li = document.createElement('li');
      li.className = 'tree-item';

      if (item.isDirectory) {
        li.dataset.path = item.path;

        const label = document.createElement('span');
        label.className = 'tree-label tree-folder-label';

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow';
        arrow.textContent = '▶';

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = '📁';

        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = item.name;

        label.appendChild(arrow); label.appendChild(icon); label.appendChild(name);

        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children';
        if (item.children && item.children.length > 0)
          createTreeHTML(item.children, childrenUl);

        label.addEventListener('click', (e) => {
          e.stopPropagation();
          currentDirPath = item.path;
          const isOpen = li.classList.toggle('open');
          arrow.textContent = isOpen ? '▼' : '▶';
          icon.textContent  = isOpen ? '📂' : '📁';
          childrenUl.style.display = isOpen ? 'block' : 'none';
          saveTreeState();
        });

        li.appendChild(label);
        li.appendChild(childrenUl);
      } else {
        const label = document.createElement('span');
        label.className = 'tree-label tree-file-label';
        label.title = item.path;

        const spacer = document.createElement('span');
        spacer.className = 'tree-arrow tree-arrow-spacer';

        const iconEl = document.createElement('span');
        iconEl.className = 'tree-icon';
        iconEl.textContent = getFileIcon(item.name);

        const nameEl = document.createElement('span');
        nameEl.className = 'tree-name';
        nameEl.textContent = item.name;

        label.appendChild(spacer); label.appendChild(iconEl); label.appendChild(nameEl);

        label.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedFileEl) selectedFileEl.classList.remove('tree-selected');
          label.classList.add('tree-selected');
          selectedFileEl = label;
          if (isBinaryFile(item.name)) {
            alert(`"${item.name}" là file binary, không thể mở dạng text.`);
          } else {
            window.electronAPI.requestReadFile(item.path);
          }
        });

        li.appendChild(label);
      }
      parentUl.appendChild(li);
    });
  }

  createTreeHTML(data.items, rootUl);
  restoreExpandedState();
});

// =====================================================================
// FILE ICONS
// =====================================================================
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const m = {
    cpp:'⚙️',cc:'⚙️',cxx:'⚙️',c:'⚙️',h:'⚙️',hpp:'⚙️',
    py:'🐍', js:'📜',ts:'📜',jsx:'📜',tsx:'📜',
    html:'🌐',htm:'🌐',css:'🎨',scss:'🎨',
    json:'📋',yaml:'📋',yml:'📋',toml:'📋',xml:'📋',
    md:'📝',txt:'📝',mmd:'🔷',
    rs:'🦀',go:'🔵',java:'☕',rb:'💎',
    sh:'🖥️',bash:'🖥️',sql:'🗄️',
    dockerfile:'🐳',makefile:'🔧',
  };
  return m[ext] || '📄';
}
