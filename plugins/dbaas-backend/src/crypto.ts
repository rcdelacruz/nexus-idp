import {
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'crypto';

const INFO = Buffer.from('dbaas-credentials-v1');

/**
 * Derive a 32-byte AES key from BACKEND_SECRET using HKDF-SHA256.
 * BACKEND_SECRET is also used for JWT signing — using a separate derived key
 * avoids key reuse across different cryptographic operations.
 */
function deriveKey(secret: string): Buffer {
  // Validate before use — Buffer.from(str, 'hex') silently ignores non-hex chars,
  // producing a shortened key if the secret is base64 or another format.
  if (!/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error(
      'backend.auth.keys[0].secret must be a 64-character hex string (32 bytes). ' +
      "Generate with: node -p 'require(\"crypto\").randomBytes(32).toString(\"hex\")'",
    );
  }
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'hex'), Buffer.alloc(0), INFO, 32) as ArrayBuffer,
  );
}

/**
 * Encrypt a string with AES-256-GCM.
 * Returns: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encrypt(data: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a blob produced by encrypt().
 */
export function decrypt(blob: string, secret: string): string {
  const parts = blob.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted blob format');
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = deriveKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
