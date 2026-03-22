// Key model with encryption metadata and lifecycle state

export enum KeyStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  ROTATING = 'rotating',
}

// Database row representation
export interface ApiKeyRow {
  id: string;
  user_id: string;
  key_name: string;
  key_hash: string;
  key_prefix: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  scopes: string; // JSON-serialized string[]
  status: KeyStatus;
  rate_limit_window_ms: number;
  rate_limit_max_requests: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

// Application-level key entity
export interface ApiKeyEntity {
  id: string;
  userId: string;
  keyName: string;
  keyHash: string;
  keyPrefix: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
  scopes: string[];
  status: KeyStatus;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

// Encryption metadata for storage
export interface EncryptedKey {
  key: string;
  iv: string;
  authTag: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface KeyMetadata {
  keyId: string;
  userId: string;
  keyName: string;
  scopes: string[];
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  isRotating?: boolean;
}

export interface KeyState {
  metadata: KeyMetadata;
  encryptedKey: EncryptedKey;
  isActive: boolean;
  lastUsedAt: number;
  rotationHistory: {
    oldKeyId: string;
    newKeyId: string;
    rotatedAt: number;
    validUntil: number;
  }[];
}

export interface KeyTransition {
  oldKeyId: string;
  newKeyId: string;
  validUntil: number;
  rotatedAt: number;
}

export interface KeyCreateRequest {
  userId: string;
  keyName: string;
  scopes: string[];
  expiresInHours?: number;
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
}

export interface KeyResponse {
  keyId: string;
  userId: string;
  keyName: string;
  scopes: string[];
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  createdAt: string;
  expiresAt: string | null;
  status: KeyStatus;
  lastUsedAt: string | null;
}

// Conversion helpers
export function rowToEntity(row: ApiKeyRow): ApiKeyEntity {
  return {
    id: row.id,
    userId: row.user_id,
    keyName: row.key_name,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    encryptedKey: row.encrypted_key,
    iv: row.iv,
    authTag: row.auth_tag,
    scopes: JSON.parse(row.scopes),
    status: row.status,
    rateLimit: {
      windowMs: row.rate_limit_window_ms,
      maxRequests: row.rate_limit_max_requests,
    },
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

export function entityToResponse(entity: ApiKeyEntity): KeyResponse {
  return {
    keyId: entity.id,
    userId: entity.userId,
    keyName: entity.keyName,
    scopes: entity.scopes,
    rateLimit: entity.rateLimit,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    status: entity.status,
    lastUsedAt: entity.lastUsedAt,
  };
}