import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_ROUNDS = 12;
const API_KEY_PREFIX = 'hg_';
const API_KEY_RANDOM_BYTES = 48;

export function encrypt(
  plaintext: string,
  encryptionKey: string
): { encryptedKey: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (64 hex characters)');
  }
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

export function decrypt(
  encryptedKey: string,
  iv: string,
  authTag: string,
  encryptionKey: string
): string {
  try {
    const key = Buffer.from(encryptionKey, 'hex');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error (internal):', error instanceof Error ? error.message : error);
    throw new Error('Decryption failed: data integrity check failed');
  }
}

export async function hashKey(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function compareKey(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(API_KEY_RANDOM_BYTES);
  const base64url = randomBytes
    .toString('base64url');
  return `${API_KEY_PREFIX}${base64url}`;
}

export function generateKeyPrefix(apiKey: string): string {
  return apiKey.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8);
}
