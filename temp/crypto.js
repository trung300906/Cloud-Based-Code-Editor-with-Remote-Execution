const crypto = require("crypto");

// key phải 32 bytes
const KEY = Buffer.from("12345678901234567890123456789012");

function encrypt(data) {
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);

    const encrypted = Buffer.concat([
        cipher.update(data),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    // ✅ format chuẩn binary
    return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(buffer) {
    const iv = buffer.slice(0, 12);
    const tag = buffer.slice(12, 28);
    const encrypted = buffer.slice(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);

    return decrypted;
}

module.exports = { encrypt, decrypt };

const HMAC_KEY = "my-hmac-secret";

function createHmac(data) {
    return crypto
        .createHmac("sha256", HMAC_KEY)
        .update(data)
        .digest();
}

function verifyHmac(data, received) {
    const expected = createHmac(data);
    return crypto.timingSafeEqual(expected, received);
}

module.exports.createHmac = createHmac;
module.exports.verifyHmac = verifyHmac;