const FrameParser = require("./frame-parser");

const parser = new FrameParser();

parser.onPacket = (packet) => {
    console.log("✅ PACKET:", packet);
};

// giả lập packet bị chia nhỏ
const fullPacket = Buffer.from([
    0,0,0,10,   // length
    1,          // type
    ...Buffer.from("123456789") // payload
]);

// chia nhỏ thành 2 phần
const part1 = fullPacket.slice(0, 6);
const part2 = fullPacket.slice(6);

parser.push(part1);
parser.push(part2);