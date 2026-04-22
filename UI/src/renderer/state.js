// =====================================================================
// STATE — Trạng thái runtime toàn cục của renderer
// Tất cả module import { state } và đọc/ghi state.X
// =====================================================================

/** Mutable state object — share bằng object reference, không cần getter/setter */
export const state = {
  // ---- Pane & split tree ----
  panes:        [],    // flat list of all leaf panes
  focusedPaneId: null,
  paneIdCounter:  0,
  splitIdCounter: 0,
  splitRoot:      null, // root node của recursive split tree

  // ---- Tabs & Monaco ----
  tabs:        new Map(), // tabId → tab object
  tabCounter:  0,
  monacoReady: false,
  pendingOpen: [],        // queue files opened trước khi Monaco sẵn sàng

  // ---- File context ----
  currentFilePath: null,
  currentDirPath:  null,
  rootFolderPath:  null,
  selectedFileEl:  null,  // element đang selected trong file tree
  fileIndex:       [],    // flat list của tất cả file để quick-open search

  // ---- UI state ----
  openMenuItem: null,   // menu item đang mở trong custom menubar
  dropActive:   false,  // đang hiển thị drop zones (drag & drop tab)
};

/** localStorage keys */
export const LS = {
  FOLDER:   'rce_last_folder',
  EXPANDED: 'rce_expanded_folders',
  THEME:    'rce_theme',
  SIDEBAR_W:'rce_sidebar_width',
};
