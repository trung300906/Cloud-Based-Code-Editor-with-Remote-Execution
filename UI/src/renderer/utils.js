// =====================================================================
// UTILS — Pure utilities dùng chung bởi nhiều module
// =====================================================================

export const BINARY_EXTS = new Set([
  'exe','dll','so','dylib','bin','o','obj','a','lib',
  'zip','tar','gz','bz2','xz','7z','rar',
  'jpg','jpeg','png','gif','bmp','ico','webp','tiff',
  'mp3','mp4','wav','ogg','flac','mkv','avi','mov',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'woff','woff2','ttf','eot','pyc','pyo','class',
]);

/**
 * Kiểm tra file có phải binary không (không thể mở dạng text).
 * @param {string} filename
 * @returns {boolean}
 */
export function isBinaryFile(filename) {
  return BINARY_EXTS.has(filename.split('.').pop().toLowerCase());
}

/**
 * Escape HTML entities để tránh XSS khi inject vào innerHTML.
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight phần match trong text (dùng cho quick-open results).
 * @param {string} text
 * @param {string} query
 * @returns {string} HTML string với <span class="qo-highlight">
 */
export function highlightMatch(text, query) {
  const safe  = escapeHtml(text);
  if (!query) return safe;
  const lower  = safe.toLowerCase();
  const qLower = escapeHtml(query).toLowerCase();
  const idx    = lower.indexOf(qLower);
  if (idx === -1) return safe;
  return (
    safe.slice(0, idx) +
    `<span class="qo-highlight">${safe.slice(idx, idx + qLower.length)}</span>` +
    safe.slice(idx + qLower.length)
  );
}

/**
 * Xây dựng flat index tất cả file từ cây thư mục (dùng cho quick-open).
 * @param {Array} items   — mảng tree nodes từ main process
 * @param {string} basePath — đường dẫn root folder
 * @param {Array} [result]  — internal accumulator (đệ quy)
 * @returns {Array<{name, path, rel}>}
 */
export function rebuildFileIndex(items, basePath, result = []) {
  for (const item of items) {
    if (item.isDirectory) {
      if (item.children) rebuildFileIndex(item.children, basePath, result);
    } else {
      const rel = item.path.startsWith(basePath)
        ? item.path.slice(basePath.length).replace(/^[\\/]/, '')
        : item.name;
      result.push({ name: item.name, path: item.path, rel });
    }
  }
  return result;
}
