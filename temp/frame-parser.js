const { verifyHmac } = require("./crypto");

class FrameParser {
    constructor(onPacket) {
        this.buffer = Buffer.alloc(0);
        this.onPacket = onPacket;
    }

    push(data) {
        this.buffer = Buffer.concat([this.buffer, data]);

        while (true) {
            if (this.buffer.length < 4) return;

            const length = this.buffer.readUInt32BE(0);

            if (this.buffer.length < 4 + length) return;

            const packet = this.buffer.slice(0, 4 + length);

            this.buffer = this.buffer.slice(4 + length);

            const body = packet.slice(4);

            const type = body.readUInt8(0);
            const payloadwithHmac = body.slice(1);

            const payload = payloadwithHmac.slice(0, -32);
            const receivedHmac = payloadwithHmac.slice(-32);

            if (!verifyHmac(payload, receivedHmac)) {
                console.log("❌ HMAC INVALID → DROP PACKET");
                continue;
            }

            this.onPacket(packet);
        }
    }
}

module.exports = FrameParser;