// =====================================================================
// MONACO INIT — Cấu hình Monaco, đăng ký Mermaid, khởi tạo editor
//
// Module này có side effect: gọi require.config() và require() ngay khi load.
// Monaco AMD loader (từ CDN) phải được load TRƯỚC module này.
// =====================================================================
import { state, LS } from "./state.js";
import { ALL_LANGUAGES } from "./lang-detect.js";
import { openOrActivateTab } from "./tab.js";

// =====================================================================
// LANGUAGE DROPDOWN
// =====================================================================

/** Populate dropdown #lang-select với tất cả supported languages. */
export function buildLangDropdown() {
  const sel = document.getElementById("lang-select");
  if (!sel) return;
  sel.innerHTML = "";
  ALL_LANGUAGES.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  sel.value = "cpp";
}

/**
 * Thay đổi language của model trong focused pane editor.
 * Được gọi từ menubar.js khi user chọn language trong dropdown.
 * @param {string} langId — Monaco language id
 */
export function setEditorLanguage(langId) {
  const pane =
    state.panes.find((p) => p.id === state.focusedPaneId) || state.panes[0];
  if (!pane?.editor) return;
  if (
    langId === "mermaid" &&
    !monaco.languages.getLanguages().find((l) => l.id === "mermaid")
  ) {
    registerMermaidLanguage();
  }
  monaco.editor.setModelLanguage(pane.editor.getModel(), langId);
  const sel = document.getElementById("lang-select");
  if (sel) sel.value = langId;
}

// =====================================================================
// MERMAID CUSTOM LANGUAGE
// =====================================================================

/** Đăng ký syntax highlighting cho Mermaid diagram language. */
export function registerMermaidLanguage() {
  monaco.languages.register({ id: "mermaid" });
  monaco.languages.setMonarchTokensProvider("mermaid", {
    tokenizer: {
      root: [
        [/%%.*$/, "comment"],
        [/%%\{/, { token: "comment.doc", next: "@directive" }],
        [/"([^"]*)"/, "string"],
        [
          /\b(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|quadrantChart|xychart-beta)\b/,
          "keyword",
        ],
        [/\b(LR|RL|TD|TB|BT)\b/, "keyword"],
        [
          /\b(subgraph|end|participant|actor|Note|note|loop|alt|else|opt|activate|deactivate|autonumber)\b/,
          "keyword",
        ],
        [
          /\b(class|interface|abstract|enum|state|direction|title|section|dateFormat|axisFormat)\b/,
          "keyword",
        ],
        [/\[(\|)?([^\]]*?)(\|)?\]/, "type"],
        [/--?>|===>|~~~|-.->|--x|--o|<-->/, "keyword.operator"],
        [/-->|==>|-.->|--/, "keyword.operator"],
        [/\|([^|]*)\|/, "string"],
        [/[A-Za-z_][\w]*/, "identifier"],
        [/\d+(\.\d+)?/, "number"],
        [/[;,:]/, "delimiter"],
      ],
      directive: [
        [/\}%%/, { token: "comment.doc", next: "@pop" }],
        [/./, "comment.doc"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("mermaid", {
    comments: { lineComment: "%%" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
  });
}

// =====================================================================
// MONACO INIT — side effect xảy ra khi module được import lần đầu
// =====================================================================

require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs",
  },
});

require(["vs/editor/editor.main"], function () {
  buildLangDropdown();
  registerMermaidLanguage();

  // Tạo editor cho pane đầu tiên (đã được tạo bởi initRootPane ở DOMContentLoaded)
  const pane = state.panes[0];
  if (pane && !pane.editor) {
    pane.editor = monaco.editor.create(pane.containerEl, {
      value: "",
      language: "cpp",
      theme: document.body.classList.contains("light-mode") ? "vs" : "vs-dark",
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
    });
  }

  state.monacoReady = true;

  // Flush các file đang chờ mở trước khi Monaco sẵn sàng
  state.pendingOpen.forEach(({ filePath, content }) =>
    openOrActivateTab(filePath, content),
  );
  state.pendingOpen.length = 0;

  // Mở tab mặc định nếu chưa có tab nào
  if (state.tabs.size === 0)
    openOrActivateTab(null, "// Enter your code here...");

  // Áp dụng theme đã lưu
  if (localStorage.getItem(LS.THEME) === "light") {
    monaco.editor.setTheme("vs");
  }
});
