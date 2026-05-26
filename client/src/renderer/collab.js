// COLLAB — Real-time collaboration via Yjs CRDT + y-monaco binding
//
// Sử dụng ?deps= trên esm.sh để ép tất cả package dùng CÙNG MỘT bản Yjs,
// tránh lỗi "Yjs was already imported" làm hỏng instanceof checks.
//
// ROOM_EVENT (sub-type 4): Gateway gửi số lượng thành viên khác trong room.
// "Await Sync or Seed": Khi isInCollabRoom=true, KHÔNG seed local content vào Yjs.
// Đợi SyncStep 2 từ room member (timeout 2s). Nếu không ai trả lời → seed local.

import * as Y from "https://esm.sh/yjs@13.6.14";
import { state } from "./state.js";
import { MonacoBinding } from "https://esm.sh/y-monaco@0.1.6?deps=yjs@13.6.14";
import * as awarenessProtocol from "https://esm.sh/y-protocols@1.0.6/awareness?deps=yjs@13.6.14";

export let ydoc = new Y.Doc();
export let awareness = new awarenessProtocol.Awareness(ydoc);

// Map<editor, { binding, docId }> — dùng Map thường để dọn dẹp chủ động
const editorBindings = new Map();

// Danh sách file đang chờ sync (Await Sync or Seed)
// Map<docId, { model, editor, timeout, resolve }>
const pendingSyncFiles = new Map();
let syncReceived = false; // Đã nhận SyncStep 2 ít nhất 1 lần?

const SYNC_TIMEOUT_MS = 2000; // Đợi tối đa 2 giây cho SyncStep 2

const userColors = ['#30bced', '#6eeb83', '#ffbc42', '#ecd444', '#ee6352', '#9ac2c9', '#8acb88', '#1be7ff'];
let currentUsername = "guest";
let isCollabInited = false;

let _docUpdateListener = null;
let _awarenessUpdateListener = null;
// Track chính xác instance nào chứa listener
// để tránh gọi .off() trên instance mới sau resetCollab
let _listenerYdoc = null;
let _listenerAwareness = null;

function detachDocListeners() {
  if (_docUpdateListener && _listenerYdoc) {
    try { _listenerYdoc.off("update", _docUpdateListener); } catch (_) {}
  }
  if (_awarenessUpdateListener && _listenerAwareness) {
    try { _listenerAwareness.off("update", _awarenessUpdateListener); } catch (_) {}
  }
  _docUpdateListener = null;
  _awarenessUpdateListener = null;
  _listenerYdoc = null;
  _listenerAwareness = null;
}

function attachDocListeners() {
  detachDocListeners();

  _docUpdateListener = (update, origin) => {
    if (origin !== "network") {
      const payload = new Uint8Array(update.length + 1);
      payload[0] = 0; 
      payload.set(update, 1);
      window.electronAPI.sendCollabData(payload);
    }
  };

  _awarenessUpdateListener = ({ added, updated, removed }) => {
    const changedClients = added.concat(updated).concat(removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
    const payload = new Uint8Array(update.length + 1);
    payload[0] = 3; 
    payload.set(update, 1);
    window.electronAPI.sendCollabData(payload);
  };

  ydoc.on("update", _docUpdateListener);
  awareness.on("update", _awarenessUpdateListener);
  // Lưu lại đúng instance để detach sau này
  _listenerYdoc = ydoc;
  _listenerAwareness = awareness;
}

/**
 * Tạo MonacoBinding cho editor + ytext + awareness.
 * Luôn gọi sau khi ytext đã có content (hoặc có thể trống nếu file mới).
 */
function _createBinding(editor, docId, ytext, model) {
  // Kiểm tra nếu đã bind đúng docId rồi thì bỏ qua
  const existing = editorBindings.get(editor);
  if (existing && existing.docId === docId) return;
  if (existing) {
    try { existing.binding.destroy(); } catch (_) {}
    editorBindings.delete(editor);
  }

  // Guard: nếu model đã bị dispose (tab đóng trong lúc chờ sync) thì bỏ qua
  if (!model || model.isDisposed()) return;

  const binding = new MonacoBinding(ytext, model, new Set([editor]), awareness);
  editorBindings.set(editor, { binding, docId });

  // Broadcast awareness sau khi binding được tạo để remote user thấy cursor ngay.
  // Dùng setTimeout(fn, 0) thay vì queueMicrotask — microtask vẫn chạy trong
  // task hiện tại và có thể trigger deltaDecorations recursion.
  // setTimeout defer hoàn toàn sang event loop mới, sau khi Monaco xong cycle.
  setTimeout(() => {
    if (currentUsername && !model.isDisposed()) {
      try {
        awareness.setLocalStateField("user", {
          name: currentUsername,
          color: userColors[ydoc.clientID % userColors.length]
        });
      } catch (_) {}
    }
  }, 0);
}

/**
 * Xử lý khi nhận được SyncStep 2 (Full State) từ room member.
 * Với mỗi file đang chờ:
 *   - Nếu CRDT có content cho file đó: dùng CRDT (tạo binding luôn)
 *   - Nếu CRDT trống (A chưa mở file): seed từ local model rồi tạo binding
 */
function onSyncStep2Received(payload) {
  Y.applyUpdate(ydoc, payload, "network");
  syncReceived = true;
  console.log("[Collab] Đã đồng bộ Full State từ Room!");

  for (const [docId, pending] of pendingSyncFiles) {
    clearTimeout(pending.timeout);
    const ytext = ydoc.getText(docId);

    if (ytext.length === 0 && pending.model) {
      // File này không có trong CRDT state của A → seed từ local của B
      const localContent = pending.model.getValue();
      if (localContent !== "") {
        console.log(`[Collab] File "${docId}" — không có trong CRDT, seed từ local.`);
        ydoc.transact(() => { ytext.insert(0, localContent); });
      }
    } else {
      console.log(`[Collab] File "${docId}" — dùng CRDT state.`);
    }

    // Tạo binding sau khi ytext đã có content
    if (pending.editor && pending.model) {
      _createBinding(pending.editor, docId, ytext, pending.model);
    }
  }
  pendingSyncFiles.clear();
}

export function initCollab() {
  if (isCollabInited || !window.electronAPI || !window.electronAPI.onCollabData) return;
  isCollabInited = true;

  attachDocListeners();

  window.electronAPI.onCollabData((dataBuf) => {
    if (!dataBuf || dataBuf.length === 0) return;
    const type = dataBuf[0];
    const payload = dataBuf.subarray(1);

    if (type === 0) {
      // Doc update
      Y.applyUpdate(ydoc, payload, "network");
    } else if (type === 1) {
      // SyncStep 1: Ai đó xin State → gửi Full State về
      const stateUpdate = Y.encodeStateAsUpdate(ydoc);
      const response = new Uint8Array(stateUpdate.length + 1);
      response[0] = 2; 
      response.set(stateUpdate, 1);
      window.electronAPI.sendCollabData(response);
      
      const awareUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [ydoc.clientID]);
      const awareResponse = new Uint8Array(awareUpdate.length + 1);
      awareResponse[0] = 3;
      awareResponse.set(awareUpdate, 1);
      window.electronAPI.sendCollabData(awareResponse);
    } else if (type === 2) {
      // SyncStep 2: Nhận Full State từ room member
      onSyncStep2Received(payload);
    } else if (type === 3) {
      // Awareness update
      awarenessProtocol.applyAwarenessUpdate(awareness, payload, "network");
    } else if (type === 4) {
      // ROOM_EVENT: Gateway thông báo số lượng thành viên khác trong room
      const memberCount = payload[0] || 0;
      const wasInRoom = state.isInCollabRoom;
      state.isInCollabRoom = memberCount > 0;
      console.log(`[Collab] Gateway ROOM_EVENT: ${memberCount} other member(s). isInCollabRoom=${state.isInCollabRoom}`);

      // Vừa có người mới join → gửi SyncStep 1 để họ nhận state
      if (!wasInRoom && state.isInCollabRoom) {
        console.log("[Collab] Room member detected — requesting sync...");
        requestCollabSync();
      }

      // Phòng vừa trống → xóa ngay tất cả remote awareness.
      // Dùng setTimeout(fn, 0) tránh deltaDecorations recursion:
      // removeAwarenessStates trigger _rerenderDecorations trong MonacoBinding
      // nếu chạy đồng bộ có thể vào đúng lúc Monaco đang vẽ decorations.
      if (memberCount === 0) {
        setTimeout(() => {
          const remoteClientIds = [...awareness.getStates().keys()]
            .filter(id => id !== ydoc.clientID);
          if (remoteClientIds.length > 0) {
            try {
              awarenessProtocol.removeAwarenessStates(awareness, remoteClientIds, "local");
              console.log(`[Collab] Removed ${remoteClientIds.length} remote cursor(s) — room empty.`);
            } catch (_) {}
          }
        }, 0);
      }
    }
  });
}

export function setCollabUser(username) {
  currentUsername = username;
  const color = userColors[ydoc.clientID % userColors.length];
  // setTimeout(fn, 0): defer hoàn toàn sang event loop mới.
  // Tránh deltaDecorations recursion khi gọi trong context Monaco đang render.
  setTimeout(() => {
    try { awareness.setLocalStateField("user", { name: username, color }); } catch (_) {}
  }, 0);
}

export function requestCollabSync() {
  const req = new Uint8Array([1]);
  if (window.electronAPI && window.electronAPI.sendCollabData) {
    window.electronAPI.sendCollabData(req);
    console.log("[Collab] Đã gửi yêu cầu Sync State lên Room...");
  }
}

export function resetCollab() {
  // Clear pending syncs
  for (const [, pending] of pendingSyncFiles) {
    clearTimeout(pending.timeout);
  }
  pendingSyncFiles.clear();
  syncReceived = false;

  // Destroy tất cả binding hiện có
  for (const [, info] of editorBindings) {
    try { info.binding.destroy(); } catch (_) {}
  }
  editorBindings.clear();

  // Detach listeners khỏi đúng instance cũ trước khi tạo mới
  detachDocListeners();

  ydoc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(ydoc);
  attachDocListeners();
  setCollabUser(currentUsername);
  state.isInCollabRoom = false;
}

/**
 * Hủy binding Yjs ↔ Monaco cho một editor instance.
 * PHẢI gọi hàm này TRƯỚC khi gọi editor.setModel() để tránh binding cũ
 * phản ứng với model change và phá hỏng ytext.
 */
export function unbindEditor(editor) {
  if (!editor) return;
  const info = editorBindings.get(editor);
  if (info) {
    try { info.binding.destroy(); } catch (_) {}
    editorBindings.delete(editor);
  }
}

/**
 * Tạo binding Yjs ↔ Monaco cho một editor + file.
 * GỌI SAU khi đã setModel cho editor.
 *
 * "Await Sync or Seed" logic:
 * - Nếu KHÔNG trong room: seed local content vào Yjs ngay lập tức (solo mode)
 * - Nếu ĐANG trong room: KHÔNG seed. Gửi SyncStep 1 và đợi 2s.
 *   + Nếu SyncStep 2 đến: CRDT state thắng, MonacoBinding tự cập nhật model.
 *   + Nếu timeout (không ai trả lời): room trống thật → seed từ local.
 */
export function bindEditorToCollab(editor, filePath) {
  if (!filePath || !editor) return;
  
  let relativePath = filePath;
  if (state.rootFolderPath && filePath.startsWith(state.rootFolderPath)) {
    relativePath = filePath.substring(state.rootFolderPath.length).replace(/^[\/\\]+/, "");
  }
  const docId = relativePath || filePath;

  // Nếu editor đang bind đúng docId này rồi thì không cần làm lại
  const existing = editorBindings.get(editor);
  if (existing && existing.docId === docId) return;

  // Hủy binding cũ nếu có
  if (existing) {
    try { existing.binding.destroy(); } catch (_) {}
    editorBindings.delete(editor);
  }

  const ytext = ydoc.getText(docId);
  const initializedMap = ydoc.getMap('initialized_files');
  const model = editor.getModel();
  if (!model) return;

  if (!initializedMap.has(docId)) {
    ydoc.transact(() => { initializedMap.set(docId, true); });

    if (state.isInCollabRoom && !syncReceived) {
      // ═══ AWAIT SYNC OR SEED ═══
      // Đang trong room và chưa nhận Full State → KHÔNG tạo binding ngay.
      // MonacoBinding khởi tạo sẽ sync ytext→model: nếu ytext rỗng, model bị trắng.
      // Phải đợi biết content trước rồi mới tạo binding.
      const timeoutId = setTimeout(() => {
        pendingSyncFiles.delete(docId);
        // Timeout: không ai trả lời → room trống → seed từ local
        if (ytext.length === 0) {
          const localContent = model.getValue();
          if (localContent !== "") {
            console.log(`[Collab] Sync timeout cho "${docId}" — seed từ local.`);
            ydoc.transact(() => { ytext.insert(0, localContent); });
          }
        }
        // Tạo binding sau timeout
        _createBinding(editor, docId, ytext, model);
      }, SYNC_TIMEOUT_MS);

      pendingSyncFiles.set(docId, { model, editor, timeout: timeoutId });
      requestCollabSync();
      console.log(`[Collab] File "${docId}" — chờ sync (timeout ${SYNC_TIMEOUT_MS}ms)...`);
      return; // ← QUAN TRỌNG: không tạo binding ở đây
    } else {
      // ═══ SOLO MODE hoặc đã nhận sync rồi ═══
      // Nếu ytext trống (file mới hoặc chưa có trong CRDT) → seed từ local
      if (ytext.length === 0) {
        const currentContent = model.getValue();
        if (currentContent !== "") {
          ydoc.transact(() => { ytext.insert(0, currentContent); });
        }
      }
      // Nếu syncReceived=true, ytext có thể đã có content từ CRDT → không seed
    }
  }

  // Tạo binding (solo mode, hoặc đã nhận sync, hoặc file đã init trước)
  _createBinding(editor, docId, ytext, model);
}