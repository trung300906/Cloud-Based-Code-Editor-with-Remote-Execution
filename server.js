const net = require("net");
const FrameParser = require("./frame-parser");
const route = require("./router");
const { decrypt } = require("./crypto"); // ✅ require 1 lần ở ngoài

const server = net.createServer((socket) => {
    console.log("New client connected");

    const parser = new FrameParser();

    // ✅ CHỈ CÓ 1 onPacket DUY NHẤT
    parser.onPacket = (packet) => {
        try {
            const { type, payload } = packet;

            // 🔓 decrypt
            const decrypted = decrypt(payload);

            // parse JSON
            const decoded = JSON.parse(decrypted.toString());

            // route
            route(type, decoded, socket);

        } catch (err) {
            console.log("❌ DECRYPT ERROR:", err.message);
        }
    };

    socket.on("data", (data) => {
        parser.push(data);
    });

    socket.on("end", () => {
        console.log("Client disconnected");
    });
});

server.listen(8080, () => {
    console.log("Server running...");
});