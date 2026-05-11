const net = require("net");
const { buildPacket } = require("./packet");
const { encrypt, decrypt } = require("./crypto");
const TYPE = require("./types");

const CLIENT_NAME = process.argv[2] || "A";

const client = net.createConnection({ port: 8080 }, () => {
    console.log(`[${CLIENT_NAME}] Connected to server`);

    // 🔐 AUTH
    const authData = {
        username: "levinh",
        password: "nhincaiditmemay"
    };

    const authPayload = Buffer.from(JSON.stringify(authData));
    const authEncrypted = encrypt(authPayload);

    const authPacket = buildPacket(TYPE.AUTH, authEncrypted);

    client.write(authPacket);

    // ✏️ CLIENT A gửi 3 packet (ENCRYPTED)
    if (CLIENT_NAME === "A") {
        setTimeout(() => {
            console.log(`[${CLIENT_NAME}] 👉 Sending 3 EDIT packets`);

            const packets = [];

            for (let i = 1; i <= 3; i++) {
                const data = { content: `Packet ${i}` };

                const payload = Buffer.from(JSON.stringify(data));
                const encrypted = encrypt(payload);

                packets.push(buildPacket(TYPE.EDIT, encrypted));
            }

            const combined = Buffer.concat(packets);

            client.write(combined);

        }, 3000);
    }
});