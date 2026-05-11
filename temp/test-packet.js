const { buildPacket } = require("./packet");

// payload JSON
const data = {
    msg: "hello"
};

// convert → Buffer
const payloadBuffer = Buffer.from(JSON.stringify(data));

// build packet
const packet = buildPacket(0x02, payloadBuffer);

// in ra
console.log("Packet buffer:", packet);
console.log("Hex:", packet.toString("hex"));

//Test parse (Decode)
const { buildPacket, parsePacket } = require("./packet");

const data = { msg: "hello" };
const payloadBuffer = Buffer.from(JSON.stringify(data));

const packet = buildPacket(0x02, payloadBuffer);

const parsed = parsePacket(packet);

console.log(parsed.type); // 2
console.log(parsed.payload.toString()); // JSON string