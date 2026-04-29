const { encrypt } = require("../crypto");
const TYPE = require("../types");
const { buildPacket } = require("../packet");
const { broadcast } = require("../roomManager");

function handleEdit(data, socket) {
    console.log("📦 EDIT RECEIVED:", data);

    console.log("SENDER ROOM:", socket.roomId);

    const msg = JSON.stringify({
        type: "EDIT",
        data
    });

    broadcast(socket.roomId, msg, socket);
}

module.exports = handleEdit;

const editData = { content: "Hello secure world!" };

const payload = Buffer.from(JSON.stringify(editData));

const encrypted = encrypt(payload);

const packet = buildPacket(TYPE.EDIT, encrypted);

