// =====================================================================
// FILE UTILS — buildTree (dùng chung bởi ipc-file và ipc-menu)
// =====================================================================
const fs = require("fs");
const path = require("node:path");

// Thêm tên folder vào đây nếu muốn bỏ qua (vd: 'node_modules')
const SKIP_DIRS = new Set([]);

/**
 * Đệ quy xây dựng cây thư mục từ dirPath.
 * @param {string} dirPath
 * @returns {Array<{name, path, isDirectory, children?}>}
 */
function buildTree(dirPath, depth = 0) {
  if (depth > 50) return []; // safety limit

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error("Lỗi đọc thư mục:", dirPath, err.message);
    return [];
  }

  const result = [];

  for (const entry of entries) {
    const name = entry.name;

    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, name);

    try {
      // 🚫 Skip symlinks completely
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        result.push({
          name,
          path: fullPath,
          isDirectory: true,
          children: buildTree(fullPath, depth + 1),
        });
      } else {
        result.push({
          name,
          path: fullPath,
          isDirectory: false,
        });
      }
    } catch (err) {
      // ignore unreadable files
    }
  }

  return result;
}

module.exports = { buildTree, SKIP_DIRS };
