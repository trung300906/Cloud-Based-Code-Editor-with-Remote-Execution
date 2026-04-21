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
let currentDirPath  = null; // folder đang được focus (để tạo file/folder mới)
let rootFolderPath  = null; // folder gốc đang mở
let editor;
let selectedFileEl  = null;

// =====================================================================
// BREADCRUMB — cập nhật thanh đường dẫn phía trên editor
// =====================================================================
// Map ext → SVG-style icon chữ (giống VS Code, không dùng emoji)
const BC_ICON = {
  // Folders (special key)
  __folder__: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 4.5A1 1 0 012 3.5h4l1.5 2H14A1 1 0 0115 6.5v7a1 1 0 01-1 1H2a1 1 0 01-1-1v-9z" fill="#dcb67a" opacity=".9"/></svg>`,
  // Files by ext
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

  // — Untitled / new file —
  if (!filePath) {
    bar.innerHTML =
      `${BC_ICON.__default__}<span class="bc-segment bc-file" style="color:#858585;font-style:italic">untitled</span>`;
    return;
  }

  // Normalise separators
  const norm    = filePath.replace(/\\/g, '/');
  const normRoot = (rootFolderPath || '').replace(/\\/g, '/');

  // Build segments: prefer relative path inside open folder
  let allParts = norm.split('/').filter(Boolean);

  if (normRoot && norm.startsWith(normRoot)) {
    // Start from the root folder name itself
    const rootParts = normRoot.split('/').filter(Boolean);
    allParts = allParts.slice(rootParts.length - 1); // keep root folder name
  } else {
    // File outside root — show last 3 parts
    allParts = allParts.slice(-3);
  }

  // Clamp to avoid overflow: keep first + last, collapse middle
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

  // --- New File ---
  document.getElementById('stb-new-file').addEventListener('click', () => {
    const dir = currentDirPath || rootFolderPath;
    if (!dir) return alert('Hãy mở một folder trước!');
    showNameInput(dir, 'file');
  });

  // --- New Folder ---
  document.getElementById('stb-new-folder').addEventListener('click', () => {
    const dir = currentDirPath || rootFolderPath;
    if (!dir) return alert('Hãy mở một folder trước!');
    showNameInput(dir, 'folder');
  });

  // --- Refresh ---
  document.getElementById('stb-refresh').addEventListener('click', () => {
    if (!rootFolderPath) return;
    window.electronAPI.requestOpenFolder(rootFolderPath);
  });

  // --- Collapse All ---
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
// INLINE NAME INPUT — xuất hiện ngay trong tree để đặt tên file/folder mới
// =====================================================================
function showNameInput(dirPath, type) {
  // Xóa input cũ nếu còn sót
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
      // Refresh tree rồi mở file nếu vừa tạo
      window.electronAPI.requestOpenFolder(rootFolderPath);
      if (type === 'file') {
        // Đợi tree render xong rồi tự mở file
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

  // Restore folder mở lần trước
  const lastFolder = localStorage.getItem(LS_FOLDER);
  if (lastFolder) window.electronAPI.requestOpenFolder(lastFolder);
});

// =====================================================================
// FILE EVENT HANDLERS
// =====================================================================
window.electronAPI.onNewFile(() => {
  if (!editor) return;
  editor.setValue('// Enter your code here...');
  currentFilePath = null;
  setEditorLanguage('cpp');
  document.title = 'New File - RCE App';
  updateBreadcrumb(null);
});

window.electronAPI.onFileSaved((path) => {
  currentFilePath = path;
  document.title = path;
  updateBreadcrumb(path);
});

window.electronAPI.onOpenFile((data) => {
  if (!editor) return;
  editor.setValue(data.content);
  currentFilePath = data.filePath;
  document.title = data.filePath;
  setEditorLanguage(detectLanguage(data.filePath.split(/[\\/]/).pop()));
  updateBreadcrumb(data.filePath);
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
    value: '// Enter your code here...',
    language: 'cpp',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 14,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
  });

  // Restore theme
  const savedTheme = localStorage.getItem(LS_THEME);
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    monaco.editor.setTheme('vs');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = '☀️ Light Mode: ON';
  }

  // Save handler
  window.electronAPI.onSaveRequest((isSaveAs) => {
    const content = editor.getValue();
    window.electronAPI.sendSaveFile({
      filePath: (isSaveAs || !currentFilePath) ? null : currentFilePath,
      content,
    });
  });

  // Language dropdown
  const sel = document.getElementById('lang-select');
  if (sel) sel.addEventListener('change', (e) => setEditorLanguage(e.target.value));

  // Theme toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  let isDarkMode = localStorage.getItem(LS_THEME) !== 'light';
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem(LS_THEME, isDarkMode ? 'dark' : 'light');
      if (isDarkMode) {
        document.body.classList.remove('light-mode');
        themeBtn.textContent = '🌙 Dark Mode: ON';
        monaco.editor.setTheme('vs-dark');
      } else {
        document.body.classList.add('light-mode');
        themeBtn.textContent = '☀️ Light Mode: ON';
        monaco.editor.setTheme('vs');
      }
    });
  }
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
  currentDirPath = data.folderPath; // reset về root
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
        li.dataset.path = item.path; // dùng để save/restore expanded state

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
          currentDirPath = item.path; // cập nhật "folder đang active"
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
  restoreExpandedState(); // khôi phục trạng thái expand
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