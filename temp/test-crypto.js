const { encrypt, decrypt } = require("./crypto");

const original = Buffer.from("Hello Vinh 🚀");

const encrypted = encrypt(original);
const decrypted = decrypt(encrypted);

console.log("Original:", original.toString());
console.log("Decrypted:", decrypted.toString());