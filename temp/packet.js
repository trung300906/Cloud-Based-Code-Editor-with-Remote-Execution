//Build encode
function buildPacket(type, payloadBuffer) {
    // LENGTH = TYPE (1 byte) + payload
    const length = 1 + payloadBuffer.length;

    // Tổng buffer = 4 byte LEN + length
    const buffer = Buffer.alloc(4 + length);

    // 1. Ghi LENGTH (4 byte, Big Endian)
    buffer.writeUInt32BE(length, 0);

    // 2. Ghi TYPE (1 byte)
    buffer.writeUInt8(type, 4);

    // 3. Copy PAYLOAD vào
    payloadBuffer.copy(buffer, 5);

    return buffer;
}

module.exports = { buildPacket };

//Build decode
function parsePacket(buffer) {
    // 1. đọc length
    const length = buffer.readUInt32BE(0);

    // 2. đọc type
    const type = buffer.readUInt8(4);

    // 3. lấy payload
    const payload = buffer.slice(5, 4 + length);

    return {
        length,
        type,
        payload
    };
}

module.exports = { buildPacket, parsePacket };

const { createHmac } = require("./crypto");

function buildPacket(type, payload) {
    const hmac = createHmac(payload); // 🔐

    const totalLength = 1 + payload.length + hmac.length;

    const buffer = Buffer.alloc(4 + totalLength);

    buffer.writeUInt32BE(totalLength, 0); // LEN
    buffer.writeUInt8(type, 4);           // TYPE

    payload.copy(buffer, 5);              // PAYLOAD
    hmac.copy(buffer, 5 + payload.length); // HMAC

    return buffer;
}

module.exports = { buildPacket };