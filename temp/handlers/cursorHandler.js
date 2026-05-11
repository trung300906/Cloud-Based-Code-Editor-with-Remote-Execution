const { broadcast } = require("../roomManager");
const { encrypt } = require("../crypto");
const { buildPacket } = require("../packet");
const TYPE = require("../types");

function handleCursor(data, socket) {
    console.log("👁 CURSOR RECEIVED:", data);

    const msg = {
        type: "CURSOR",
        data
    };

    const payload = Buffer.from(JSON.stringify(msg));
    const encrypted = encrypt(payload);

    const packet = buildPacket(TYPE.CURSOR, encrypted);

    broadcast(socket.roomId, packet, socket);
}

module.exports = handleCursor;