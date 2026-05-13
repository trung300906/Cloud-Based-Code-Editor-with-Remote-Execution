// =====================================================================
// EDITOR SETTINGS — load/save/apply Monaco editor options
// =====================================================================
import { LS, state } from "./state.js";

export const DEFAULT_EDITOR_SETTINGS = {
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: "off",
  minimap: true,
  lineNumbers: "on",
  smoothScrolling: false,
  renderWhitespace: "none",
};

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

export function normalizeEditorSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    fontSize: clampNumber(src.fontSize, 10, 24, DEFAULT_EDITOR_SETTINGS.fontSize),
    tabSize: clampNumber(src.tabSize, 2, 8, DEFAULT_EDITOR_SETTINGS.tabSize),
    insertSpaces: Boolean(
      Object.prototype.hasOwnProperty.call(src, "insertSpaces")
        ? src.insertSpaces
        : DEFAULT_EDITOR_SETTINGS.insertSpaces,
    ),
    wordWrap: src.wordWrap === "on" ? "on" : "off",
    minimap: Boolean(
      Object.prototype.hasOwnProperty.call(src, "minimap")
        ? src.minimap
        : DEFAULT_EDITOR_SETTINGS.minimap,
    ),
    lineNumbers: src.lineNumbers === "off" ? "off" : "on",
    smoothScrolling: Boolean(
      Object.prototype.hasOwnProperty.call(src, "smoothScrolling")
        ? src.smoothScrolling
        : DEFAULT_EDITOR_SETTINGS.smoothScrolling,
    ),
    renderWhitespace:
      src.renderWhitespace === "all" || src.renderWhitespace === "boundary"
        ? src.renderWhitespace
        : DEFAULT_EDITOR_SETTINGS.renderWhitespace,
  };
}

export function loadEditorSettings() {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(LS.EDITOR_SETTINGS);
    if (!raw) return { ...DEFAULT_EDITOR_SETTINGS };
    return normalizeEditorSettings(JSON.parse(raw));
  } catch (_) {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
}

export function saveEditorSettings(settings) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS.EDITOR_SETTINGS, JSON.stringify(settings));
  } catch (_) {}
}

export function applyEditorSettingsToEditor(editor, settings) {
  if (!editor) return;
  editor.updateOptions({
    fontSize: settings.fontSize,
    wordWrap: settings.wordWrap,
    minimap: { enabled: settings.minimap },
    lineNumbers: settings.lineNumbers,
    smoothScrolling: settings.smoothScrolling,
    renderWhitespace: settings.renderWhitespace,
  });

  const model = editor.getModel();
  if (model) applyEditorSettingsToModel(model, settings);
}

export function applyEditorSettingsToModel(model, settings) {
  if (!model) return;
  model.updateOptions({
    tabSize: settings.tabSize,
    insertSpaces: settings.insertSpaces,
  });
}

export function applyEditorSettingsToAll(settings = loadEditorSettings()) {
  state.panes.forEach((pane) => {
    if (pane.editor) applyEditorSettingsToEditor(pane.editor, settings);
  });
  for (const tab of state.tabs.values()) {
    if (tab.model) applyEditorSettingsToModel(tab.model, settings);
  }
}

export function getEditorCreateOptions(theme) {
  const settings = loadEditorSettings();
  return {
    theme,
    automaticLayout: true,
    fontSize: settings.fontSize,
    minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false,
    wordWrap: settings.wordWrap,
    lineNumbers: settings.lineNumbers,
    smoothScrolling: settings.smoothScrolling,
    renderWhitespace: settings.renderWhitespace,
  };
}
