import {
  encrypt,
  decrypt,
  hashKey,
  compareKey,
  generateApiKey,
  generateKeyPrefix,
} from '../../src/services/encryptionService';

const TEST_KEY = '0'.repeat(64);

describe('encryptionService', () => {
  describe('encrypt / decrypt', () => {
    it('round-trip returns the original plaintext', () => {
      const plaintext = 'my-secret-api-key-value';
      const { encryptedKey, iv, authTag } = encrypt(plaintext, TEST_KEY);
      const result = decrypt(encryptedKey, iv, authTag, TEST_KEY);
      expect(result).toBe(plaintext);
    });

    it('decrypt with wrong key throws', () => {
      const { encryptedKey, iv, authTag } = encrypt('secret', TEST_KEY);
      const wrongKey = '1'.repeat(64);
      expect(() => decrypt(encryptedKey, iv, authTag, wrongKey)).toThrow('Decryption failed');
    });

    it('decrypt with tampered ciphertext throws', () => {
      const { encryptedKey, iv, authTag } = encrypt('secret', TEST_KEY);
      const tampered = 'ff' + encryptedKey.slice(2);
      expect(() => decrypt(tampered, iv, authTag, TEST_KEY)).toThrow('Decryption failed');
    });

    it('decrypt with tampered authTag throws', () => {
      const { encryptedKey, iv, authTag } = encrypt('secret', TEST_KEY);
      const tampered = 'ff' + authTag.slice(2);
      expect(() => decrypt(encryptedKey, iv, tampered, TEST_KEY)).toThrow('Decryption failed');
    });
  });

  describe('hashKey / compareKey', () => {
    it('hashKey returns a bcrypt hash', async () => {
      const hash = await hashKey('test-plaintext');
      expect(hash).toMatch(/^\$2[aby]\$/);
    });

    it('compareKey returns true for matching plaintext', async () => {
      const plaintext = 'test-plaintext';
      const hash = await hashKey(plaintext);
      const result = await compareKey(plaintext, hash);
      expect(result).toBe(true);
    });

    it('compareKey returns false for non-matching plaintext', async () => {
      const hash = await hashKey('correct-plaintext');
      const result = await compareKey('wrong-plaintext', hash);
      expect(result).toBe(false);
    });
  });

  describe('generateApiKey', () => {
    it('starts with hg_ prefix', () => {
      const key = generateApiKey();
      expect(key.startsWith('hg_')).toBe(true);
    });

    it('has correct length (prefix + 64 base64url chars from 48 bytes)', () => {
      const key = generateApiKey();
      // 48 random bytes -> 64 base64url chars + 3 char prefix = 67
      expect(key.length).toBe(67);
    });

    it('produces unique keys each call', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('generateKeyPrefix', () => {
    it('returns 8 chars after the hg_ prefix', () => {
      const key = 'hg_abcdefghijklmnop';
      const prefix = generateKeyPrefix(key);
      expect(prefix).toBe('abcdefgh');
      expect(prefix.length).toBe(8);
    });

    it('handles short key (less than prefix + 8 chars)', () => {
      const key = 'hg_abc';
      const prefix = generateKeyPrefix(key);
      // slice returns whatever is available, padded with undefined -> shorter string
      expect(prefix.length).toBeLessThanOrEqual(8);
    });
  });
});
