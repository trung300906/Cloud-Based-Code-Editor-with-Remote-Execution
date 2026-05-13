"use strict";

const STORAGE_PREFIX = "cbce.session.";

function _getStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function _readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function _writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

class SessionManager {
  constructor(opts = {}) {
    this.storageKey = opts.storageKey || `${STORAGE_PREFIX}default`;
    this.memory = { token: "", roomId: "", fileState: {} };
    this.storage = _getStorage();
    this._load();
  }

  _load() {
    if (!this.storage) return;
    const data = _readJson(this.storage, this.storageKey);
    if (!data) return;
    this.memory = {
      token: typeof data.token === "string" ? data.token : "",
      roomId: typeof data.roomId === "string" ? data.roomId : "",
      fileState: typeof data.fileState === "object" && data.fileState
        ? data.fileState
        : {},
    };
  }

  _save() {
    if (!this.storage) return;
    _writeJson(this.storage, this.storageKey, this.memory);
  }

  getToken() {
    return this.memory.token || "";
  }

  setToken(token) {
    this.memory.token = typeof token === "string" ? token : "";
    this._save();
  }

  getRoomId() {
    return this.memory.roomId || "";
  }

  setRoomId(roomId) {
    this.memory.roomId = typeof roomId === "string" ? roomId : "";
    this._save();
  }

  getFileState() {
    return this.memory.fileState || {};
  }

  setFileState(fileState) {
    this.memory.fileState = fileState && typeof fileState === "object" ? fileState : {};
    this._save();
  }

  clear() {
    this.memory = { token: "", roomId: "", fileState: {} };
    if (this.storage) this.storage.removeItem(this.storageKey);
  }
}

module.exports = { SessionManager };
