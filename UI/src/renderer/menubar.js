// =====================================================================
// MENUBAR — Custom dropdown menu, doSave, handleMenuAction
// setEditorLanguage được import từ monaco-init.js (tránh circular)
// =====================================================================
import { state, LS }            from './state.js';
import { getFocusedPane, splitEditor, removePane } from './pane.js';
import { openOrActivateTab }    from './tab.js';
import { setEditorLanguage }    from './monaco-init.js';

// ---- Save file hiện tại ----
export function doSave() {
  const pane = getFocusedPane();
  if (!pane?.editor) return;
  const content = pane.editor.getValue();
  window.electronAPI.sendSaveFile({ filePath: state.currentFilePath || null, content });
  if (state.currentFilePath && pane.activeTabId) {
    const tab = state.tabs.get(pane.activeTabId);
    if (tab) { tab.isModified = false; refreshTabElImport(pane.activeTabId); }
  }
}

// Lazy import để tránh circular (refreshTabEl ở tab.js cũng import pane.js)
async function refreshTabElImport(tabId) {
  const { refreshTabEl } = await import('./tab.js');
  refreshTabEl(tabId);
}

// ---- Dispatch action từ menu entry hoặc keyboard shortcut ----
export function handleMenuAction(action) {
  switch (action) {
    // File
    case 'new-file':    openOrActivateTab(null, '// Enter your code here...'); break;
    case 'open-file':   window.electronAPI.menuOpenFile();   break;
    case 'open-folder': window.electronAPI.menuOpenFolder(); break;
    case 'save':        doSave();                            break;
    case 'quit':        window.electronAPI.appQuit();        break;

    // Editor / split
    case 'toggle-theme':
      document.getElementById('theme-toggle-btn')?.click();
      break;
    case 'split-editor':
      splitEditor('horizontal');
      break;
    case 'split-editor-down':
      splitEditor('vertical');
      break;
    case 'close-split':
      if (state.panes.length > 1) removePane(getFocusedPane().id);
      break;

    // Edit (Monaco built-in actions)
    case 'undo':
      getFocusedPane()?.editor?.trigger('menu', 'undo', null);
      break;
    case 'redo':
      getFocusedPane()?.editor?.trigger('menu', 'redo', null);
      break;
    case 'cut':        document.execCommand('cut');   break;
    case 'copy':       document.execCommand('copy');  break;
    case 'paste':      document.execCommand('paste'); break;
    case 'select-all':
      getFocusedPane()?.editor?.trigger('menu', 'editor.action.selectAll', null);
      break;

    // View
    case 'toggle-fullscreen': window.electronAPI.winToggleFullscreen(); break;
    case 'zoom-in':           window.electronAPI.winZoomIn();           break;
    case 'zoom-out':          window.electronAPI.winZoomOut();          break;
    case 'reset-zoom':        window.electronAPI.winResetZoom();        break;
    case 'toggle-devtools':   window.electronAPI.winToggleDevtools();   break;

    // Window
    case 'minimize':      window.electronAPI.winMinimize(); break;
    case 'reload':        window.electronAPI.winReload();   break;
    case 'close-window':  window.electronAPI.winClose();    break;
  }
}

// ---- Khởi tạo dropdown logic + theme toggle + lang dropdown ----
export function initCustomMenubar() {
  const menubar = document.getElementById('custom-menubar');
  if (!menubar) return;

  const menuItems = menubar.querySelectorAll('.menu-item');

  function closeAllMenus() {
    menuItems.forEach(item => item.classList.remove('open'));
    state.openMenuItem = null;
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
        state.openMenuItem = item;
      }
    });

    // Hover chuyển giữa các menu khi đang có menu mở
    label.addEventListener('mouseenter', () => {
      if (state.openMenuItem && state.openMenuItem !== item) {
        closeAllMenus();
        item.classList.add('open');
        state.openMenuItem = item;
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
    if (e.key === 'Escape' && state.openMenuItem) closeAllMenus();
  });

  // ---- Theme toggle ----
  const themeBtn = document.getElementById('theme-toggle-btn');
  let isDarkMode = localStorage.getItem(LS.THEME) !== 'light';
  if (!isDarkMode) {
    document.body.classList.add('light-mode');
    if (themeBtn) themeBtn.textContent = '☀️ Light Mode: ON';
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem(LS.THEME, isDarkMode ? 'dark' : 'light');
      if (isDarkMode) {
        document.body.classList.remove('light-mode');
        themeBtn.textContent = '☀️ Light Mode: OFF';
        if (typeof monaco !== 'undefined') monaco.editor.setTheme('vs-dark');
      } else {
        document.body.classList.add('light-mode');
        themeBtn.textContent = '☀️ Light Mode: ON';
        if (typeof monaco !== 'undefined') monaco.editor.setTheme('vs');
      }
    });
  }

  // ---- Language dropdown ----
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', (e) => setEditorLanguage(e.target.value));
  }
}
