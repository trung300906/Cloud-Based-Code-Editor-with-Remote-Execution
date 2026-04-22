// =====================================================================
// QUICK OPEN — Command palette (>) và file search (Ctrl+P)
// =====================================================================
import { state } from "./state.js";
import { getFileIcon } from "./icons.js";
import { isBinaryFile, escapeHtml, highlightMatch } from "./utils.js";
import { handleMenuAction } from "./menubar.js";

// ---- Danh sách commands cho command palette (Ctrl+Shift+P hoặc gõ ">") ----
export const PALETTE_COMMANDS = [
  { label: "New File", shortcut: "Ctrl+N", action: "new-file" },
  { label: "Open File…", shortcut: "Ctrl+O", action: "open-file" },
  { label: "Open Folder…", shortcut: "", action: "open-folder" },
  { label: "Save", shortcut: "Ctrl+S", action: "save" },
  { label: "Split Editor Right", shortcut: "Ctrl+\\", action: "split-editor" },
  { label: "Split Editor Down", shortcut: "", action: "split-editor-down" },
  { label: "Close Split Pane", shortcut: "", action: "close-split" },
  { label: "Toggle Dark / Light Mode", shortcut: "", action: "toggle-theme" },
  { label: "Toggle Fullscreen", shortcut: "F11", action: "toggle-fullscreen" },
  { label: "Zoom In", shortcut: "Ctrl+=", action: "zoom-in" },
  { label: "Zoom Out", shortcut: "Ctrl+-", action: "zoom-out" },
  { label: "Reset Zoom", shortcut: "Ctrl+0", action: "reset-zoom" },
  {
    label: "Developer Tools",
    shortcut: "Ctrl+Shift+I",
    action: "toggle-devtools",
  },
  { label: "Reload Window", shortcut: "Ctrl+Shift+R", action: "reload" },
  { label: "Minimize Window", shortcut: "", action: "minimize" },
  { label: "Close Window", shortcut: "", action: "close-window" },
  { label: "Exit", shortcut: "Ctrl+Q", action: "quit" },
];

/**
 * Khởi tạo quick-open input và result dropdown.
 * - Không có prefix  → hiện command list
 * - Có chữ không ">"  → tìm file trong fileIndex
 * - Prefix ">"        → filter command palette
 */
export function initQuickOpen() {
  const input = document.getElementById("quick-open-input");
  const results = document.getElementById("quick-open-results");
  if (!input || !results) return;

  let selectedIdx = -1;
  let currentItems = [];

  // ---- Render danh sách kết quả ----
  function render(items, query) {
    currentItems = items;
    selectedIdx = items.length > 0 ? 0 : -1;

    if (items.length === 0) {
      results.innerHTML = query
        ? '<div class="qo-empty">No results found</div>'
        : "";
      results.classList.toggle("visible", !!query);
      return;
    }

    results.innerHTML = items
      .slice(0, 50)
      .map((it, i) => {
        const sel = i === 0 ? " selected" : "";
        if (it.type === "cmd") {
          return `<div class="qo-item qo-cmd${sel}" data-idx="${i}">
          <span class="qo-icon">›</span>
          <span class="qo-name">${highlightMatch(it.label, query)}</span>
          ${it.shortcut ? `<span class="qo-shortcut">${it.shortcut}</span>` : ""}
        </div>`;
        }
        const dir =
          it.rel.includes("/") || it.rel.includes("\\")
            ? it.rel.replace(/[\\/][^\\/]*$/, "")
            : "";
        return `<div class="qo-item${sel}" data-idx="${i}">
        <span class="qo-icon">${getFileIcon(it.name)}</span>
        <span class="qo-name">${highlightMatch(it.name, query)}</span>
        ${dir ? `<span class="qo-path">${escapeHtml(dir)}</span>` : ""}
      </div>`;
      })
      .join("");
    results.classList.add("visible");
  }

  function hide() {
    results.classList.remove("visible");
    results.innerHTML = "";
    selectedIdx = -1;
    currentItems = [];
  }

  function execute(idx) {
    const it = currentItems[idx];
    if (!it) return;
    hide();
    input.value = "";
    input.blur();
    if (it.type === "cmd") {
      handleMenuAction(it.action);
    } else {
      if (isBinaryFile(it.name)) {
        alert(`"${it.name}" là file binary, không thể mở dạng text.`);
      } else {
        window.electronAPI.requestReadFile(it.path);
      }
    }
  }

  function updateSelection(newIdx) {
    const els = results.querySelectorAll(".qo-item");
    if (els[selectedIdx]) els[selectedIdx].classList.remove("selected");
    selectedIdx = newIdx;
    if (els[selectedIdx]) {
      els[selectedIdx].classList.add("selected");
      els[selectedIdx].scrollIntoView({ block: "nearest" });
    }
  }

  // ---- Cập nhật danh sách khi user gõ ----
  function refresh() {
    const raw = input.value;

    if (raw.startsWith(">")) {
      // Command palette mode
      const q = raw.slice(1).trim().toLowerCase();
      const cmds = q
        ? PALETTE_COMMANDS.filter((c) => c.label.toLowerCase().includes(q))
        : PALETTE_COMMANDS;
      render(
        cmds.map((c) => ({ type: "cmd", ...c })),
        q,
      );
      return;
    }

    const q = raw.trim().toLowerCase();
    if (!q) {
      // Không có query → hiện command list
      render(
        PALETTE_COMMANDS.map((c) => ({ type: "cmd", ...c })),
        "",
      );
      return;
    }

    // File search mode
    const matches = state.fileIndex
      .filter(
        (f) =>
          f.name.toLowerCase().includes(q) || f.rel.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aN = a.name.toLowerCase(),
          bN = b.name.toLowerCase();
        const inNameDiff = (aN.includes(q) ? 0 : 1) - (bN.includes(q) ? 0 : 1);
        if (inNameDiff !== 0) return inNameDiff;
        const startsDiff =
          (aN.startsWith(q) ? 0 : 1) - (bN.startsWith(q) ? 0 : 1);
        if (startsDiff !== 0) return startsDiff;
        return aN.length - bN.length;
      });
    render(
      matches.map((f) => ({ type: "file", ...f })),
      q,
    );
  }

  // ---- Event listeners ----
  input.addEventListener("input", refresh);
  input.addEventListener("focus", refresh);

  input.addEventListener("keydown", (e) => {
    if (!results.classList.contains("visible")) {
      if (e.key === "Escape") {
        input.blur();
        e.stopPropagation();
      }
      return;
    }
    const count = Math.min(currentItems.length, 50);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedIdx < count - 1) updateSelection(selectedIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectedIdx > 0) updateSelection(selectedIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx >= 0) execute(selectedIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
      input.value = "";
      input.blur();
    }
    e.stopPropagation();
  });

  results.addEventListener("mousedown", (e) => {
    const item = e.target.closest(".qo-item");
    if (item) {
      e.preventDefault();
      execute(Number(item.dataset.idx));
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menubar-search")) hide();
  });
}
