import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

/**
 * AES-256-GCM needs exactly 32 bytes.
 * - 64 hex chars → raw key bytes
 * - UTF-8 length exactly 32 → used as raw key
 * - anything else → SHA-256(passphrase) so accidental long .env lines still work
 */
function resolveEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY is required in production');
    }
    return crypto.createHash('sha256').update('breath-kyc-dev-default-key').digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const asUtf8 = Buffer.from(raw, 'utf8');
  if (asUtf8.length === 32) {
    return asUtf8;
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function key32(): Buffer {
  if (!cachedKey) {
    cachedKey = resolveEncryptionKey();
  }
  return cachedKey;
}

export function encrypt(text: string): string {
  const key = key32();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(data: string): string {
  const key = key32();
  const [ivHex, authTagHex, encrypted] = data.split(':');

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encryption format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * SHA-256 Hash for one-way PII tracking (CPF deduplication)
 */
export function hashPII(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
