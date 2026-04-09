"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.hashPII = hashPII;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;
let cachedKey = null;
/**
 * AES-256-GCM needs exactly 32 bytes.
 * - 64 hex chars → raw key bytes
 * - UTF-8 length exactly 32 → used as raw key
 * - anything else → SHA-256(passphrase) so accidental long .env lines still work
 */
function resolveEncryptionKey() {
    const raw = process.env.ENCRYPTION_KEY?.trim();
    if (!raw) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('ENCRYPTION_KEY is required in production');
        }
        return crypto_1.default.createHash('sha256').update('breath-kyc-dev-default-key').digest();
    }
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    const asUtf8 = Buffer.from(raw, 'utf8');
    if (asUtf8.length === 32) {
        return asUtf8;
    }
    return crypto_1.default.createHash('sha256').update(raw, 'utf8').digest();
}
function key32() {
    if (!cachedKey) {
        cachedKey = resolveEncryptionKey();
    }
    return cachedKey;
}
function encrypt(text) {
    const key = key32();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
function decrypt(data) {
    const key = key32();
    const [ivHex, authTagHex, encrypted] = data.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encryption format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
/**
 * SHA-256 Hash for one-way PII tracking (CPF deduplication)
 */
function hashPII(value) {
    return crypto_1.default.createHash('sha256').update(value).digest('hex');
}
