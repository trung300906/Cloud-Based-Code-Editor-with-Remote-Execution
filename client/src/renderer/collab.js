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

function attachDocListeners() {
  // Dọn listener cũ trước để tránh stacking
  if (_docUpdateListener) ydoc.off("update", _docUpdateListener);
  if (_awarenessUpdateListener) awareness.off("update", _awarenessUpdateListener);

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
}

/**
 * Xử lý khi nhận được SyncStep 2 (Full State) từ room member.
 * Tất cả file đang chờ (pending) sẽ được giải phóng — CRDT state thắng.
 */
function onSyncStep2Received(payload) {
  Y.applyUpdate(ydoc, payload, "network");
  syncReceived = true;
  console.log("[Collab] Đã đồng bộ Full State từ Room!");

  // Giải phóng tất cả file đang chờ sync — CRDT state đã có nội dung
  for (const [docId, pending] of pendingSyncFiles) {
    clearTimeout(pending.timeout);
    // ytext đã được populate bởi CRDT sync → MonacoBinding sẽ tự cập nhật model
    console.log(`[Collab] File "${docId}" — dùng CRDT state (bỏ qua local).`);
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
      // (Gateway đã relay, nhưng gửi lại cho chắc)
      if (!wasInRoom && state.isInCollabRoom) {
        console.log("[Collab] Room member detected — requesting sync...");
        requestCollabSync();
      }
    }
  });
}

export function setCollabUser(username) {
  currentUsername = username;
  const color = userColors[ydoc.clientID % userColors.length];
  try {
    awareness.setLocalStateField("user", { name: username, color });
  } catch (_) {
    // Fallback nếu gọi trong context Monaco đang update decorations
    queueMicrotask(() => awareness.setLocalStateField("user", { name: username, color }));
  }
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

  // Null ra các listener refs trước khi tạo objects mới
  // (Listeners cũ đã gắn vào ydoc/awareness cũ, sẽ bị GC cùng chúng)
  _docUpdateListener = null;
  _awarenessUpdateListener = null;

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

  // Nếu file đã được khởi tạo trong Yjs (hoặc đã nhận sync) → chỉ tạo binding, không seed
  if (!initializedMap.has(docId)) {
    if (state.isInCollabRoom) {
      // ═══ AWAIT SYNC OR SEED ═══
      // Đang trong room → KHÔNG seed local content.
      // Đánh dấu đã init (để tránh seed lại nếu chuyển tab rồi quay lại)
      ydoc.transact(() => {
        initializedMap.set(docId, true);
      });

      // Nếu chưa nhận sync → đợi, với timeout fallback
      if (!syncReceived) {
        const timeoutId = setTimeout(() => {
          // Timeout! Không ai trả lời SyncStep 2.
          // Room có thể trống → seed từ local.
          pendingSyncFiles.delete(docId);
          if (ytext.length === 0 && model) {
            const localContent = model.getValue();
            if (localContent !== "") {
              console.log(`[Collab] Sync timeout cho "${docId}" — seed từ local.`);
              ydoc.transact(() => {
                ytext.insert(0, localContent);
              });
            }
          }
        }, SYNC_TIMEOUT_MS);

        pendingSyncFiles.set(docId, { model, editor, timeout: timeoutId });
        requestCollabSync();
        console.log(`[Collab] File "${docId}" — chờ sync (timeout ${SYNC_TIMEOUT_MS}ms)...`);
      }
      // Nếu đã nhận sync rồi → ytext đã có content từ CRDT, không cần làm gì thêm
    } else {
      // ═══ SOLO MODE ═══
      // Không trong room → seed local content ngay
      const currentContent = model.getValue();
      ydoc.transact(() => {
        initializedMap.set(docId, true);
        if (currentContent !== "" && ytext.length === 0) {
          ytext.insert(0, currentContent);
        }
      });
    }
  }

  const binding = new MonacoBinding(
    ytext,
    model,
    new Set([editor]),
    awareness
  );
  editorBindings.set(editor, { binding, docId });

  // Sau khi binding được tạo, broadcast lại awareness để remote user thấy cursor ngay
  queueMicrotask(() => {
    if (currentUsername) {
      awareness.setLocalStateField("user", {
        name: currentUsername,
        color: userColors[ydoc.clientID % userColors.length]
      });
    }
  });
}