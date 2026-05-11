const TYPE = require("./types");

const handleAuth = require("./handlers/authHandler");
const handleEdit = require("./handlers/editHandler");
const handleRun = require("./handlers/runHandler");
const handleCursor = require("./handlers/cursorHandler");

const handlers = {
    [TYPE.AUTH]: handleAuth,
    [TYPE.EDIT]: handleEdit,
    [TYPE.RUN]: handleRun,
    [TYPE.CURSOR]: handleCursor
};

function route(type, data, socket) {
    const handler = handlers[type];

    if (!handler) {
        console.log("❌ Unknown TYPE:", type);
        return;
    }

    // 🔐 check auth (trừ AUTH)
    if (type !== TYPE.AUTH && !socket.user) {
        socket.write("❌ Not authenticated\n");
        return;
    }

    handler(data, socket);
}

module.exports = { route };