// =====================================================================
// DRAG & DROP — 5-region per-pane drop zones (top/bottom/left/right/center)
// Circular import với tab.js là an toàn (chỉ dùng trong event handlers)
// =====================================================================
import { state }                          from './state.js';
import { splitPane }                      from './pane.js';
import { moveTabToPane, activateTabInPane, appendTabElToPane } from './tab.js';

/**
 * Hiển thị drop overlay lên tất cả panes khi đang kéo tab.
 */
export function showDropZones() {
  if (state.dropActive) return;
  state.dropActive = true;

  state.panes.forEach(pane => {
    const ov = document.createElement('div');
    ov.className = 'pane-drop-overlay';
    ov.innerHTML = `
      <div class="pdz pdz-top"    data-action="top"></div>
      <div class="pdz-mid">
        <div class="pdz pdz-left"   data-action="left"></div>
        <div class="pdz pdz-center" data-action="center"></div>
        <div class="pdz pdz-right"  data-action="right"></div>
      </div>
      <div class="pdz pdz-bottom" data-action="bottom"></div>
    `;

    ov.querySelectorAll('.pdz').forEach(z => {
      z.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        z.classList.add('drop-hover');
      });
      z.addEventListener('dragleave', () => z.classList.remove('drop-hover'));
      z.addEventListener('drop', (e) => {
        e.preventDefault();
        const tabId = Number(e.dataTransfer.getData('text/plain'));
        const act   = z.dataset.action;
        hideDropZones();
        switch (act) {
          case 'center': handleDropMove(tabId, pane.id);                             break;
          case 'left':   handleDropSplit(tabId, pane.id, 'horizontal', 'before');   break;
          case 'right':  handleDropSplit(tabId, pane.id, 'horizontal', 'after');    break;
          case 'top':    handleDropSplit(tabId, pane.id, 'vertical',   'before');   break;
          case 'bottom': handleDropSplit(tabId, pane.id, 'vertical',   'after');    break;
        }
      });
    });

    pane.el.appendChild(ov);
  });
}

/**
 * Xóa tất cả drop overlays.
 */
export function hideDropZones() {
  document.querySelectorAll('.pane-drop-overlay').forEach(el => el.remove());
  state.dropActive = false;
}

// ---- Internal helpers ----

function handleDropSplit(tabId, targetPaneId, direction, side) {
  const newPane = splitPane(targetPaneId, direction, side);
  if (!newPane) return;
  moveTabToPane(tabId, newPane.id);
}

function handleDropMove(tabId, targetPaneId) {
  const src = state.panes.find(p => p.tabIds.includes(tabId));
  if (!src || src.id === targetPaneId) return;
  moveTabToPane(tabId, targetPaneId);
}
