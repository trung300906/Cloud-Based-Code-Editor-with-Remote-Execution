// =====================================================================
// ICONS — SVG toolbar icons, file emoji icons, breadcrumb SVG icons
// =====================================================================

// ---- Sidebar toolbar buttons ----
export const SVG = {
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

// ---- Breadcrumb mini SVG icons theo extension ----
export const BC_ICON = {
  __folder__: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 4.5A1 1 0 012 3.5h4l1.5 2H14A1 1 0 0115 6.5v7a1 1 0 01-1 1H2a1 1 0 01-1-1v-9z" fill="#dcb67a" opacity=".9"/></svg>`,
  cpp: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#9cdcfe" font-family="monospace">C+</text></svg>`,
  c: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#9cdcfe" font-family="monospace">C</text></svg>`,
  h: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#9cdcfe" font-family="monospace">H</text></svg>`,
  py: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#4ec9b0" font-family="monospace">Py</text></svg>`,
  js: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#f0db4f" opacity=".15"/><text y="13" font-size="11" fill="#f0db4f" font-family="monospace">JS</text></svg>`,
  ts: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#3178c6" opacity=".2"/><text y="13" font-size="11" fill="#3d9fe0" font-family="monospace">TS</text></svg>`,
  json: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="10" fill="#cbcb41" font-family="monospace">{}</text></svg>`,
  md: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="10" fill="#519aba" font-family="monospace">MD</text></svg>`,
  html: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="9"  fill="#e34c26" font-family="monospace">HTML</text></svg>`,
  css: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="9"  fill="#563d7c" font-family="monospace">CSS</text></svg>`,
  rs: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#dea584" font-family="monospace">Rs</text></svg>`,
  go: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#00acd7" font-family="monospace">Go</text></svg>`,
  yaml: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="9"  fill="#cbcb41" font-family="monospace">YML</text></svg>`,
  mmd: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><text y="13" font-size="11" fill="#a78bfa" font-family="monospace">⬡</text></svg>`,
  __default__: `<svg class="bc-icon" width="14" height="14" viewBox="0 0 16 16"><path d="M4 1h6l4 4v10H4V1z" fill="none" stroke="#cccccc" stroke-width="1.2"/><polyline points="10,1 10,5 14,5" fill="none" stroke="#cccccc" stroke-width="1.2"/></svg>`,
};

/**
 * Emoji icon cho file trong file tree.
 * @param {string} filename
 * @returns {string}
 */
export function getFileIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const m = {
    cpp: "⚙️",
    cc: "⚙️",
    cxx: "⚙️",
    c: "⚙️",
    h: "⚙️",
    hpp: "⚙️",
    py: "🐍",
    js: "📜",
    ts: "📜",
    jsx: "📜",
    tsx: "📜",
    html: "🌐",
    htm: "🌐",
    css: "🎨",
    scss: "🎨",
    json: "📋",
    yaml: "📋",
    yml: "📋",
    toml: "📋",
    xml: "📋",
    md: "📝",
    txt: "📝",
    mmd: "🔷",
    rs: "🦀",
    go: "🔵",
    java: "☕",
    rb: "💎",
    sh: "🖥️",
    bash: "🖥️",
    sql: "🗄️",
    dockerfile: "🐳",
    makefile: "🔧",
  };
  return m[ext] || "📄";
}

/**
 * SVG icon nhỏ cho breadcrumb/tab, theo extension.
 * @param {string} filename
 * @returns {string} HTML string của SVG
 */
export function getBcFileIcon(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  const aliases = {
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hh: "cpp",
    hxx: "cpp",
    mjs: "js",
    cjs: "js",
    jsx: "js",
    tsx: "ts",
    yml: "yaml",
    jsonc: "json",
    htm: "html",
    scss: "css",
    less: "css",
  };
  const key = aliases[ext] || ext;
  return BC_ICON[key] || BC_ICON.__default__;
}
