// =====================================================================
// KEYBOARD — Global keyboard shortcuts (thay thế Electron accelerator)
// =====================================================================
import { handleMenuAction } from './menubar.js';

/**
 * Gắn keyboard shortcut toàn cục vào document.
 * Monaco tự xử lý shortcuts bên trong editor (Ctrl+Z, Ctrl+C, ...),
 * những shortcuts này chỉ áp dụng khi focus nằm ngoài Monaco hoặc
 * khi Monaco không consume chúng (vd: Ctrl+N).
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // File
    if (ctrl && !e.shiftKey && e.key === 'n') {
      e.preventDefault(); handleMenuAction('new-file');
    } else if (ctrl && !e.shiftKey && e.key === 'o') {
      e.preventDefault(); handleMenuAction('open-file');
    } else if (ctrl && !e.shiftKey && e.key === 's') {
      e.preventDefault(); handleMenuAction('save');
    } else if (ctrl && !e.shiftKey && e.key === 'q') {
      e.preventDefault(); handleMenuAction('quit');

    // Quick Open (Ctrl+P → file search, Ctrl+Shift+P → command palette)
    } else if (ctrl && !e.shiftKey && e.key === 'p') {
      e.preventDefault();
      const qo = document.getElementById('quick-open-input');
      if (qo) { qo.value = ''; qo.focus(); }
    } else if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      const qo = document.getElementById('quick-open-input');
      if (qo) { qo.value = '>'; qo.focus(); qo.dispatchEvent(new Event('input')); }

    // Split editor
    } else if (ctrl && !e.shiftKey && e.key === '\\') {
      e.preventDefault(); handleMenuAction('split-editor');

    // View
    } else if (e.key === 'F11') {
      e.preventDefault(); handleMenuAction('toggle-fullscreen');
    } else if (ctrl && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
      e.preventDefault(); handleMenuAction('toggle-devtools');
    } else if (ctrl && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
      e.preventDefault(); handleMenuAction('reload');
    }
  });
}
