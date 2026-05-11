const buf = Buffer.alloc(4);

buf.writeUInt32BE(10, 0);

console.log(buf);

console.log(buf.readUnit32BE(0));
