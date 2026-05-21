 
// MONACO INIT — Cấu hình Monaco, đăng ký Mermaid, khởi tạo editor
//
// Module này có side effect: gọi require.config() và require() ngay khi load.
// Monaco AMD loader (từ CDN) phải được load TRƯỚC module này.
 
import { state, LS } from "./state.js";
import { ALL_LANGUAGES } from "./lang-detect.js";
import { openOrActivateTab } from "./tab.js";
import { getEditorCreateOptions } from "./editor-settings.js";
import { oneDarkPro } from "./themes.js";

 
// LANGUAGE DROPDOWN
 

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

 
// MERMAID CUSTOM LANGUAGE
 

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

 
// MONACO INIT — side effect xảy ra khi module được import lần đầu
 

require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs",
  },
});

require(["vs/editor/editor.main"], function () {
  buildLangDropdown();
  registerMermaidLanguage();

  // Helper formatter for brace-based languages (C, C++, Java, etc.)
  function formatBraceLanguage(code, options) {
    const tabSize = options.tabSize || 4;
    const insertSpaces = options.insertSpaces !== false;
    const indentStr = insertSpaces ? ' '.repeat(tabSize) : '\t';
    
    const lines = code.split('\n');
    let indentLevel = 0;
    const result = [];
    
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();
      if (rawLine === '') {
        result.push('');
        continue;
      }
      
      // Remove strings and comments to analyze braces cleanly
      let cleanLine = rawLine
        .replace(/"([^"\\]|\\.)*"/g, '')
        .replace(/'([^'\\]|\\.)*'/g, '')
        .replace(/\/\/.*$/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
        
      let openBraces = (cleanLine.match(/\{/g) || []).length;
      let closeBraces = (cleanLine.match(/\}/g) || []).length;
      
      let thisLineIndent = indentLevel;
      if (cleanLine.trim().startsWith('}')) {
        thisLineIndent = Math.max(0, thisLineIndent - 1);
      }
      
      result.push(indentStr.repeat(thisLineIndent) + rawLine);
      indentLevel = Math.max(0, indentLevel + openBraces - closeBraces);
    }
    
    return result.join('\n');
  }

  const braceFormatter = {
    provideDocumentFormattingEdits(model, options, token) {
      const code = model.getValue();
      const formatted = formatBraceLanguage(code, options);
      return [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ];
    },
  };

  monaco.languages.registerDocumentFormattingEditProvider("cpp", braceFormatter);
  monaco.languages.registerDocumentFormattingEditProvider("c", braceFormatter);
  monaco.languages.registerDocumentFormattingEditProvider("java", braceFormatter);

  monaco.editor.defineTheme("zera-dark", oneDarkPro);

  // Tạo editor cho pane đầu tiên (đã được tạo bởi initRootPane ở DOMContentLoaded)
  const pane = state.panes[0];
  if (pane && !pane.editor) {
    const theme = document.body.classList.contains("light-mode") ? "vs" : "zera-dark";
    pane.editor = monaco.editor.create(pane.containerEl, {
      value: "",
      language: "cpp",
      ...getEditorCreateOptions(theme),
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
  } else {
    monaco.editor.setTheme("zera-dark");
  }
});
