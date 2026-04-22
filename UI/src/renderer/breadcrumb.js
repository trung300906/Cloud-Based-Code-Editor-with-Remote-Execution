// =====================================================================
// BREADCRUMB — cập nhật thanh path bên dưới tab bar của mỗi pane
// =====================================================================
import { state }              from './state.js';
import { BC_ICON, getBcFileIcon } from './icons.js';
import { getFocusedPane }     from './pane.js'; // circular với pane→tab→breadcrumb, OK vì dùng trong function body

/**
 * Cập nhật breadcrumb bar cho pane (hoặc focused pane nếu không truyền).
 * @param {string|null} filePath
 * @param {object|null} pane
 */
export function updateBreadcrumb(filePath, pane) {
  const bar = pane ? pane.breadcrumbEl : getFocusedPane()?.breadcrumbEl;
  if (!bar) return;

  if (!filePath) {
    bar.innerHTML =
      `${BC_ICON.__default__}<span class="bc-segment bc-file" style="color:#858585;font-style:italic">untitled</span>`;
    return;
  }

  const norm     = filePath.replace(/\\/g, '/');
  const normRoot = (state.rootFolderPath || '').replace(/\\/g, '/');

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
      { name: allParts[0],                   isFile: false },
      { name: '…',                            isFile: false, isEllipsis: true },
      { name: allParts[allParts.length - 2], isFile: false },
      { name: allParts[allParts.length - 1], isFile: true  },
    ];
  }

  bar.innerHTML = segments.map((seg, i) => {
    const sep  = i > 0 ? `<span class="bc-sep">›</span>` : '';
    const icon = seg.isEllipsis ? '' :
                 seg.isFile ? getBcFileIcon(seg.name) : BC_ICON.__folder__;
    const cls  = `bc-segment ${seg.isFile ? 'bc-file' : 'bc-dir'}${seg.isEllipsis ? ' bc-ellipsis' : ''}`;
    return `${sep}<span class="${cls}" title="${seg.name}">${icon}${seg.name}</span>`;
  }).join('');
}
