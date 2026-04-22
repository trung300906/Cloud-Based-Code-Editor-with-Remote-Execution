// =====================================================================
// FILE UTILS — buildTree (dùng chung bởi ipc-file và ipc-menu)
// =====================================================================
const fs   = require('fs');
const path = require('node:path');

// Thêm tên folder vào đây nếu muốn bỏ qua (vd: 'node_modules')
const SKIP_DIRS = new Set([]);

/**
 * Đệ quy xây dựng cây thư mục từ dirPath.
 * @param {string} dirPath
 * @returns {Array<{name, path, isDirectory, children?}>}
 */
function buildTree(dirPath) {
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (err) {
    console.error('Lỗi đọc thư mục:', dirPath, err.message);
    return result;
  }
  for (const file of entries) {
    if (SKIP_DIRS.has(file) || file.startsWith('.')) continue;
    const fullPath = path.join(dirPath, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        result.push({ name: file, path: fullPath, isDirectory: true, children: buildTree(fullPath) });
      } else {
        result.push({ name: file, path: fullPath, isDirectory: false });
      }
    } catch (_) { /* bỏ qua file không đọc được */ }
  }
  return result;
}

module.exports = { buildTree, SKIP_DIRS };
