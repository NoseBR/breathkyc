"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.hashCpf = hashCpf;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
function getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error("ENCRYPTION_KEY environment variable is required");
    }
    // Key must be 32 bytes for AES-256
    return node_crypto_1.default.scryptSync(key, "breathkyc-salt", 32);
}
function encrypt(text) {
    const key = getEncryptionKey();
    const iv = node_crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = node_crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}
function decrypt(encryptedText) {
    const key = getEncryptionKey();
    const parts = encryptedText.split(":");
    if (parts.length !== 3)
        throw new Error("Invalid encrypted text format");
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    const decipher = node_crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
function hashCpf(cpf) {
    return node_crypto_1.default.createHash("sha256").update(cpf).digest("hex");
}
//# sourceMappingURL=encryption.js.map