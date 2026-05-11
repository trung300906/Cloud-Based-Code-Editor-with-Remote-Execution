const net = require('net');

const TYPE = {
  ERR:    0x00,
  AUTH:   0x01,
  EDIT:   0x02,
  RUN:    0x03,
  CURSOR: 0x04,
  CHAT:   0x05,
  RESULT: 0x06,
  PING:   0xFF // Định nghĩa thêm type PING/PONG cho chuẩn
};

let buffer = Buffer.alloc(0);
let heartbeatTimer = null;
let pongTimer = null;
let reconnectDelay = 1000;

const client = new net.Socket();

function connect() {
  // 🔧 SỬA 1: Trỏ IP về con máy ảo Middleware (Tailscale IP)
  client.connect(8080, '100.124.23.95', () => {
    console.log('[TCP Client] 🚀 Kết nối Gateway thành công');
    reconnectDelay = 1000;
    startHeartbeat();
  });
}

// 🔧 SỬA 2: Hàm send đóng gói đúng cấu trúc Gateway cần: Header(5B) + idLen(4B) + ID + Data
function send(type, requestId, data) {
  const idBuf = Buffer.from(requestId, 'utf8');
  const idLenBuf = Buffer.alloc(4);
  idLenBuf.writeUInt32BE(idBuf.length, 0);
  
  // Hỗ trợ gửi cả Object (OT diff) hoặc String (Code thuần)
  const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const dataBuf = Buffer.from(dataStr, 'utf8');

  // Gộp lõi Payload (ID_LEN + ID + DATA)
  const payloadBuf = Buffer.concat([idLenBuf, idBuf, dataBuf]);
  
  // Gắn Header (5 byte: 4 byte chiều dài + 1 byte loại lệnh)
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payloadBuf.length, 0);
  header.writeUInt8(type, 4);
  
  client.write(Buffer.concat([header, payloadBuf]));
}

client.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  
  while (buffer.length >= 5) {
    const len  = buffer.readUInt32BE(0);
    const type = buffer.readUInt8(4);
    
    if (buffer.length < 5 + len) break;
    
    // Dùng subarray thay vì slice để tiết kiệm RAM
    const payload = buffer.subarray(5, 5 + len); 
    buffer = buffer.subarray(5 + len);
    
    // Nếu là Server trả Pong thì xử lý riêng
    if (type === TYPE.PING || type === 0xFF) {
      handlePong();
      continue;
    }

    // 🔧 SỬA 3: Bóc tách payload Gateway gửi về (ID_LEN + ID + DATA)
    if (payload.length < 4) continue; 
    
    const idLen = payload.readUInt32BE(0);
    if (payload.length < 4 + idLen) continue;

    // Lấy ID và nội dung
    const requestId = payload.subarray(4, 4 + idLen).toString('utf8');
    const rawData = payload.subarray(4 + idLen).toString('utf8');
    
    // Cố gắng parse JSON, nếu thất bại thì giữ nguyên chuỗi Text (Phù hợp cho Log STDOUT từ Worker)
    let parsedData = rawData;
    try { parsedData = JSON.parse(rawData); } catch (e) {}

    dispatch(type, requestId, parsedData);
  }
});

function dispatch(type, requestId, data) {
  if (type === TYPE.RESULT) handleResult(requestId, data);
  if (type === TYPE.EDIT)   handleEdit(requestId, data);
  if (type === TYPE.CURSOR) handleCursor(requestId, data);
  if (type === TYPE.ERR)    handleError(requestId, data);
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    // Gọi hàm send mới với Request ID là "sys"
    send(TYPE.PING, "sys", { ping: Date.now() }); 
    pongTimer = setTimeout(() => {
      console.warn('[TCP Client] ⚠️ Không nhận pong → mất kết nối');
      client.destroy();
    }, 5000);
  }, 15000);
}

function handlePong() {
  clearTimeout(pongTimer);
}

function handleResult(requestId, data) {
  console.log(`[💻 Code Result - ${requestId}]:`, data);
}

function handleEdit(requestId, data) {
  console.log(`[🔄 OT Diff - ${requestId}]:`, data);
}

function handleCursor(requestId, data) {
  console.log(`[🖱 Cursor - ${requestId}]:`, data);
}

function handleError(requestId, data) {
  console.error(`[❌ Error - ${requestId}]:`, data);
}

client.on('close', () => {
  clearInterval(heartbeatTimer);
  clearTimeout(pongTimer);
  console.log(`[TCP Client] 🔴 Mất kết nối — reconnect sau ${reconnectDelay}ms`);
  setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }, reconnectDelay);
});

client.on('error', (err) => {
  console.error('[TCP Client] 💥 Socket error:', err.message);
});

connect();

// Export với cấu trúc mới
module.exports = { send, TYPE };