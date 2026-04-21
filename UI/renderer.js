// =====================================================================
// LANGUAGE DETECTION ENGINE
// Map extension -> Monaco language ID
// =====================================================================
const EXT_LANG_MAP = {
  // C family
  'c':    'c',
  'h':    'c',
  'cpp':  'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'c++': 'cpp',
  'hpp':  'cpp', 'hh': 'cpp', 'hxx': 'cpp',
  'cs':   'csharp',
  // JVM
  'java': 'java',
  'kt':   'kotlin', 'kts': 'kotlin',
  'scala':'scala',
  'groovy':'groovy',
  // Scripting
  'py':   'python', 'pyw': 'python',
  'rb':   'ruby',
  'php':  'php',
  'lua':  'lua',
  'pl':   'perl',
  'r':    'r',
  // Web
  'js':   'javascript', 'mjs': 'javascript', 'cjs': 'javascript',
  'ts':   'typescript', 'mts': 'typescript',
  'jsx':  'javascript',
  'tsx':  'typescript',
  'html': 'html', 'htm': 'html',
  'css':  'css',
  'scss': 'scss',
  'less': 'less',
  'vue':  'html',  // best-effort
  // Systems
  'rs':   'rust',
  'go':   'go',
  'swift':'swift',
  // Shell
  'sh':   'shell', 'bash': 'shell', 'zsh': 'shell', 'fish': 'shell',
  'ps1':  'powershell',
  'bat':  'bat', 'cmd': 'bat',
  // Data / Config
  'json': 'json', 'jsonc': 'json',
  'yaml': 'yaml', 'yml': 'yaml',
  'toml': 'ini',   // Monaco ko có TOML riêng, dùng ini gần nhất
  'ini':  'ini',   'cfg': 'ini', 'conf': 'ini',
  'xml':  'xml',   'svg': 'xml', 'xaml': 'xml',
  'sql':  'sql',
  'env':  'ini',
  // Docs / Markup
  'md':   'markdown', 'mdx': 'markdown',
  'tex':  'latex',
  'rst':  'restructuredtext',
  // Diagram
  'mmd':  'mermaid',  // custom language registered below
  'puml': 'plaintext', // PlantUML - dùng plaintext fallback
  // Misc
  'txt':  'plaintext',
  'log':  'plaintext',
  'diff': 'diff', 'patch': 'diff',
  'dockerfile': 'dockerfile',
  'makefile':   'makefile',
};

// Danh sách tất cả ngôn ngữ cho dropdown
const ALL_LANGUAGES = [
  { value: 'plaintext',    label: 'Plain Text' },
  { value: 'c',            label: 'C' },
  { value: 'cpp',          label: 'C++' },
  { value: 'csharp',       label: 'C#' },
  { value: 'python',       label: 'Python' },
  { value: 'javascript',   label: 'JavaScript' },
  { value: 'typescript',   label: 'TypeScript' },
  { value: 'java',         label: 'Java' },
  { value: 'kotlin',       label: 'Kotlin' },
  { value: 'rust',         label: 'Rust' },
  { value: 'go',           label: 'Go' },
  { value: 'swift',        label: 'Swift' },
  { value: 'php',          label: 'PHP' },
  { value: 'ruby',         label: 'Ruby' },
  { value: 'lua',          label: 'Lua' },
  { value: 'shell',        label: 'Shell/Bash' },
  { value: 'powershell',   label: 'PowerShell' },
  { value: 'bat',          label: 'Batch' },
  { value: 'html',         label: 'HTML' },
  { value: 'css',          label: 'CSS' },
  { value: 'scss',         label: 'SCSS' },
  { value: 'less',         label: 'Less' },
  { value: 'json',         label: 'JSON' },
  { value: 'yaml',         label: 'YAML' },
  { value: 'xml',          label: 'XML' },
  { value: 'sql',          label: 'SQL' },
  { value: 'markdown',     label: 'Markdown' },
  { value: 'mermaid',      label: 'Mermaid' },
  { value: 'ini',          label: 'INI / TOML' },
  { value: 'dockerfile',   label: 'Dockerfile' },
  { value: 'makefile',     label: 'Makefile' },
  { value: 'diff',         label: 'Diff / Patch' },
  { value: 'latex',        label: 'LaTeX' },
  { value: 'r',            label: 'R' },
  { value: 'scala',        label: 'Scala' },
];

// =====================================================================
// HELPER: Lấy language ID từ tên file
// =====================================================================
function detectLanguage(filename) {
  if (!filename) return 'plaintext';
  const lower = filename.toLowerCase();
  // Kiểm tra special basenames trước
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'ini';
  // Lấy extension
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return 'plaintext';
  const ext = lower.slice(dotIdx + 1);
  return EXT_LANG_MAP[ext] || 'plaintext';
}

// =====================================================================
// STATE PERSISTENCE — dùng localStorage (tồn tại qua các lần restart app)
// =====================================================================
const LS_FOLDER_KEY    = 'rce_last_folder';
const LS_EXPANDED_KEY  = 'rce_expanded_folders';
const LS_THEME_KEY     = 'rce_theme';
const LS_FILE_KEY      = 'rce_last_file';

function saveTreeState() {
  const expanded = [];
  document.querySelectorAll('.tree-item.open[data-path]').forEach(li => {
    expanded.push(li.dataset.path);
  });
  localStorage.setItem(LS_EXPANDED_KEY, JSON.stringify(expanded));
}

function restoreExpandedState() {
  const raw = localStorage.getItem(LS_EXPANDED_KEY);
  if (!raw) return;
  let expandedPaths;
  try { expandedPaths = new Set(JSON.parse(raw)); } catch { return; }

  // Expand tất cả folder có path nằm trong danh sách đã lưu
  document.querySelectorAll('.tree-item[data-path]').forEach(li => {
    if (expandedPaths.has(li.dataset.path)) {
      const label = li.querySelector('.tree-folder-label');
      if (label) label.click(); // click để trigger open + icon/arrow đúng
    }
  });
}

// Khởi động: nếu có folder cũ thì yêu cầu main reload ngay
window.addEventListener('DOMContentLoaded', () => {
  const lastFolder = localStorage.getItem(LS_FOLDER_KEY);
  if (lastFolder) {
    window.electronAPI.requestOpenFolder(lastFolder);
  }
});



// =====================================================================
// RUNTIME STATE
// =====================================================================
let currentFilePath = null;
let editor;

// =====================================================================
// FILE EVENT HANDLERS (đặt trước Monaco load để ko miss event)
// =====================================================================
window.electronAPI.onNewFile(() => {
  if (!editor) return;
  editor.setValue('// Enter your code here...');
  currentFilePath = null;
  setEditorLanguage('cpp');
  document.title = 'New File - RCE App';
});

window.electronAPI.onFileSaved((path) => {
  currentFilePath = path;
  document.title = path;
});

window.electronAPI.onOpenFile((data) => {
  if (!editor) return;
  editor.setValue(data.content);
  currentFilePath = data.filePath;
  document.title = data.filePath;

  // Auto-detect ngôn ngữ từ tên file
  const lang = detectLanguage(data.filePath.split(/[\\/]/).pop());
  setEditorLanguage(lang);
});

// =====================================================================
// BUILD LANGUAGE DROPDOWN (thay thế cái dropdown hardcode trong HTML)
// =====================================================================
function buildLangDropdown() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.innerHTML = '';
  ALL_LANGUAGES.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  sel.value = 'cpp'; // default
}

// =====================================================================
// SET LANGUAGE (cập nhật cả editor lẫn dropdown)
// =====================================================================
function setEditorLanguage(langId) {
  if (!editor) return;
  // Nếu là mermaid custom language, check xem đã register chưa
  if (langId === 'mermaid' && !monaco.languages.getLanguages().find(l => l.id === 'mermaid')) {
    registerMermaidLanguage();
  }
  monaco.editor.setModelLanguage(editor.getModel(), langId);
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = langId;
}

// =====================================================================
// MERMAID CUSTOM LANGUAGE DEFINITION
// Monaco không có Mermaid built-in, tự đăng ký tokenizer
// =====================================================================
function registerMermaidLanguage() {
  monaco.languages.register({ id: 'mermaid' });

  monaco.languages.setMonarchTokensProvider('mermaid', {
    keywords: [
      'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
      'erDiagram', 'gantt', 'pie', 'gitGraph', 'journey', 'mindmap', 'timeline',
      'quadrantChart', 'xychart-beta',
      'LR', 'RL', 'TD', 'TB', 'BT',
      'subgraph', 'end',
      'participant', 'actor', 'Note', 'note', 'loop', 'alt', 'else', 'opt',
      'activate', 'deactivate', 'autonumber',
      'class', 'interface', 'abstract', 'enum', 'state', 'direction',
      'title', 'section', 'dateFormat', 'axisFormat',
    ],
    tokenizer: {
      root: [
        // Comments
        [/%%.*$/, 'comment'],
        // Directives (%%{...}%%)
        [/%%\{/, { token: 'comment.doc', next: '@directive' }],
        // Strings
        [/"([^"]*)"/, 'string'],
        // Keywords
        [/\b(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|quadrantChart|xychart-beta)\b/, 'keyword'],
        [/\b(LR|RL|TD|TB|BT)\b/, 'keyword.direction'],
        [/\b(subgraph|end|participant|actor|Note|note|loop|alt|else|opt|activate|deactivate|autonumber)\b/, 'keyword'],
        [/\b(class|interface|abstract|enum|state|direction|title|section|dateFormat|axisFormat)\b/, 'keyword'],
        // Node shapes: []  ()  {}  (())  [[]]  [/\] etc.
        [/\[(\|)?([^\]]*?)(\|)?\]/, 'type'],
        [/\(([^)]*?)\)/, 'string.node'],
        [/\{([^}]*?)\}/, 'variable'],
        // Arrow types
        [/--?>|===>|~~~|-.->|--x|--o|<-->|<-\.->/, 'keyword.operator'],
        [/-->|==>|-.->|--/, 'keyword.operator'],
        // Labels on arrows: |label|
        [/\|([^|]*)\|/, 'string'],
        // Identifiers
        [/[A-Za-z_][\w]*/, 'identifier'],
        // Numbers
        [/\d+(\.\d+)?/, 'number'],
        // Punctuation
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
    brackets: [
      ['{', '}'], ['[', ']'], ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });
}

// =====================================================================
// MONACO INIT
// =====================================================================
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  // Build dropdown sau khi Monaco load xong
  buildLangDropdown();

  // Đăng ký Mermaid ngay
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

  // Save handler
  window.electronAPI.onSaveRequest((isSaveAs) => {
    const content = editor.getValue();
    if (isSaveAs || !currentFilePath) {
      window.electronAPI.sendSaveFile({ filePath: null, content });
    } else {
      window.electronAPI.sendSaveFile({ filePath: currentFilePath, content });
    }
  });

  // Language dropdown change (manual override)
  const sel = document.getElementById('lang-select');
  if (sel) {
    sel.addEventListener('change', (e) => {
      setEditorLanguage(e.target.value);
    });
  }

  // Theme toggle — restore saved theme trước
  const themeBtn = document.getElementById('theme-toggle-btn');
  let isDarkMode = localStorage.getItem(LS_THEME_KEY) !== 'light';
  // Apply saved theme ngay khi Monaco load xong
  if (!isDarkMode) {
    document.body.classList.add('light-mode');
    themeBtn && (themeBtn.textContent = '☀️ Light Mode: ON');
    monaco.editor.setTheme('vs');
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem(LS_THEME_KEY, isDarkMode ? 'dark' : 'light');
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
// FILE TREE (Sidebar)
// =====================================================================
// Set mở rộng file được phép đọc - thực ra tất cả text file đều OK
// Chặn binary file theo extension
const BINARY_EXTS = new Set([
  'exe','dll','so','dylib','bin','o','obj','a','lib',
  'zip','tar','gz','bz2','xz','7z','rar',
  'jpg','jpeg','png','gif','bmp','ico','svg','webp','tiff',
  'mp3','mp4','wav','ogg','flac','mkv','avi','mov',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'woff','woff2','ttf','eot',
  'pyc','pyo','class',
]);

function isBinaryFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return BINARY_EXTS.has(ext);
}

// Track file đang được chọn để highlight
let selectedFileEl = null;

window.electronAPI.onFolderOpened((data) => {
  const fileList = document.getElementById('file-list');
  fileList.innerHTML = '';

  // Lưu folder path để restore lần sau
  localStorage.setItem(LS_FOLDER_KEY, data.folderPath);

  // Header tên folder gốc
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
        li.dataset.path = item.path; // [ADDED] dùng để save/restore expanded state

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

        label.appendChild(arrow);
        label.appendChild(icon);
        label.appendChild(name);

        const childrenUl = document.createElement('ul');
        childrenUl.className = 'tree-children';

        if (item.children && item.children.length > 0) {
          createTreeHTML(item.children, childrenUl);
        }

        label.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = li.classList.toggle('open');
          arrow.textContent = isOpen ? '▼' : '▶';
          icon.textContent  = isOpen ? '📂' : '📁';
          childrenUl.style.display = isOpen ? 'block' : 'none';
          saveTreeState(); // [ADDED] lưu state mỗi khi toggle
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

        label.appendChild(spacer);
        label.appendChild(iconEl);
        label.appendChild(nameEl);

        label.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedFileEl) selectedFileEl.classList.remove('tree-selected');
          label.classList.add('tree-selected');
          selectedFileEl = label;
          localStorage.setItem(LS_FILE_KEY, item.path); // [ADDED] ghi nhớ file đang mở

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

  // Restore trạng thái expand sau khi build xong toàn bộ DOM
  restoreExpandedState();
});

// Icon đơn giản theo nhóm extension
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const iconMap = {
    cpp: '⚙️', cc: '⚙️', cxx: '⚙️', c: '⚙️', h: '⚙️', hpp: '⚙️',
    py: '🐍',
    js: '📜', ts: '📜', jsx: '📜', tsx: '📜',
    html: '🌐', htm: '🌐', css: '🎨', scss: '🎨',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋', xml: '📋',
    md: '📝', txt: '📝',
    mmd: '🔷',
    rs: '🦀', go: '🔵', java: '☕', rb: '💎',
    sh: '🖥️', bash: '🖥️',
    sql: '🗄️',
    dockerfile: '🐳',
    makefile: '🔧',
  };
  return iconMap[ext] || '📄';
}