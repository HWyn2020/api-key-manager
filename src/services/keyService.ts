import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import {
  encrypt,
  decrypt,
  hashKey,
  compareKey,
  generateApiKey,
  generateKeyPrefix,
} from './encryptionService';
import { withTransaction } from '../database/connection';
import {
  ApiKeyEntity,
  KeyStatus,
  KeyCreateRequest,
  KeyResponse,
  entityToResponse,
} from '../models/Key';
import { AuditAction } from '../models/AuditLog';
import { KeyRepository, KeyInsert } from '../database/repositories/KeyRepository';
import { RotationRepository } from '../database/repositories/RotationRepository';
import { AuditRepository } from '../database/repositories/AuditRepository';

// Pre-computed bcrypt hash used for constant-time responses when no candidate matches.
// Prevents timing oracles that let attackers enumerate valid key prefixes (RT4-002).
const DUMMY_HASH = '$2b$12$LJ3m4ys3Lg2VEe3BDkUJqe4FvfRcWiJiJyHC1mGd15KxYADHz7.vy';

export interface KeyServiceDeps {
  keyRepo: KeyRepository;
  rotationRepo: RotationRepository;
  auditRepo: AuditRepository;
  encryptionKey: string;
  db: Database.Database;
}

export function createKeyService(deps: KeyServiceDeps) {
  const { keyRepo, rotationRepo, auditRepo, encryptionKey, db } = deps;

  async function createKey(
    request: KeyCreateRequest,
    actorId: string,
    ipAddress?: string
  ): Promise<{ key: KeyResponse; plaintext: string }> {
    const plaintext = generateApiKey();
    const keyHash = await hashKey(plaintext);
    const encrypted = encrypt(plaintext, encryptionKey);
    const prefix = generateKeyPrefix(plaintext);
    const id = uuidv4();

    const expiresAt = request.expiresInHours
      ? new Date(Date.now() + request.expiresInHours * 60 * 60 * 1000).toISOString()
      : null;

    const insertData: KeyInsert = {
      id,
      userId: request.userId,
      keyName: request.keyName,
      keyHash,
      keyPrefix: prefix,
      encryptedKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      scopes: request.scopes,
      rateLimitWindowMs: request.rateLimit?.windowMs ?? 60000,
      rateLimitMaxRequests: request.rateLimit?.maxRequests ?? 100,
      expiresAt,
    };

    const entity = withTransaction(db, () => {
      const created = keyRepo.create(insertData);

      auditRepo.create({
        keyId: id,
        action: AuditAction.KEY_CREATED,
        actorId,
        metadata: { keyName: request.keyName, scopes: request.scopes },
        ipAddress,
      });

      return created;
    });

    return { key: entityToResponse(entity), plaintext };
  }

  async function validateKey(
    plaintextKey: string,
    ipAddress?: string
  ): Promise<ApiKeyEntity | null> {
    const prefix = generateKeyPrefix(plaintextKey);
    const candidates = keyRepo.findByPrefix(prefix);

    if (candidates.length === 0) {
      // Perform a dummy bcrypt compare to ensure consistent response time
      // whether or not a prefix matches (RT4-002 timing oracle fix).
      await compareKey('dummy-comparison', DUMMY_HASH);

      auditRepo.create({
        keyId: null,
        action: AuditAction.KEY_VALIDATED,
        actorId: 'unknown',
        metadata: { success: false, reason: 'not_found' },
        ipAddress,
      });
      return null;
    }

    for (const entity of candidates) {
      const hashMatch = await compareKey(plaintextKey, entity.keyHash);
      if (!hashMatch) {
        auditRepo.create({
          keyId: entity.id,
          action: AuditAction.KEY_VALIDATED,
          actorId: entity.userId,
          metadata: { success: false, reason: 'invalid_key' },
          ipAddress,
        });
        continue;
      }

      if (entity.status !== KeyStatus.ACTIVE && entity.status !== KeyStatus.ROTATING) {
        auditRepo.create({
          keyId: entity.id,
          action: AuditAction.KEY_VALIDATED,
          actorId: entity.userId,
          metadata: { success: false, reason: 'inactive', status: entity.status },
          ipAddress,
        });
        continue;
      }

      // Check grace period for ROTATING keys
      if (entity.status === KeyStatus.ROTATING) {
        const rotation = rotationRepo.findByOldKeyId(entity.id);
        if (rotation && new Date(rotation.oldKeyValidUntil) <= new Date()) {
          keyRepo.updateStatus(entity.id, KeyStatus.REVOKED, 'Grace period expired');
          auditRepo.create({
            keyId: entity.id,
            action: AuditAction.KEY_REVOKED,
            actorId: 'system',
            metadata: { reason: 'grace_period_expired', oldKeyValidUntil: rotation.oldKeyValidUntil },
            ipAddress,
          });
          continue;
        }
      }

      if (entity.expiresAt && new Date(entity.expiresAt) <= new Date()) {
        auditRepo.create({
          keyId: entity.id,
          action: AuditAction.KEY_VALIDATED,
          actorId: entity.userId,
          metadata: { success: false, reason: 'expired' },
          ipAddress,
        });
        continue;
      }

      keyRepo.updateLastUsed(entity.id);

      auditRepo.create({
        keyId: entity.id,
        action: AuditAction.KEY_ACCESSED,
        actorId: entity.userId,
        metadata: { prefix },
        ipAddress,
      });

      return entity;
    }

    return null;
  }

  async function rotateKey(
    keyId: string,
    reason: string,
    actorId: string,
    gracePeriodMs?: number
  ): Promise<{ oldKey: KeyResponse; newKey: KeyResponse; plaintext: string }> {
    const newPlaintext = generateApiKey();
    const newKeyHash = await hashKey(newPlaintext);
    const newEncrypted = encrypt(newPlaintext, encryptionKey);
    const newPrefix = generateKeyPrefix(newPlaintext);
    const newId = uuidv4();

    const result = withTransaction(db, () => {
      // Check existence and status inside transaction to prevent TOCTOU race
      const existing = keyRepo.findById(keyId);
      if (!existing) {
        throw new Error(`Key not found: ${keyId}`);
      }
      if (existing.status !== KeyStatus.ACTIVE) {
        throw new Error(`Cannot rotate key with status '${existing.status}'. Key must be ACTIVE.`);
      }

      const newExpiresAt = existing.expiresAt;

      // Set old key to ROTATING
      keyRepo.updateStatus(keyId, KeyStatus.ROTATING);

      // Create new key
      const newInsert: KeyInsert = {
        id: newId,
        userId: existing.userId,
        keyName: existing.keyName,
        keyHash: newKeyHash,
        keyPrefix: newPrefix,
        encryptedKey: newEncrypted.encryptedKey,
        iv: newEncrypted.iv,
        authTag: newEncrypted.authTag,
        scopes: existing.scopes,
        rateLimitWindowMs: existing.rateLimit.windowMs,
        rateLimitMaxRequests: existing.rateLimit.maxRequests,
        expiresAt: newExpiresAt,
      };
      const newEntity = keyRepo.create(newInsert);

      // Determine old key validity
      const oldKeyValidUntil = gracePeriodMs
        ? new Date(Date.now() + gracePeriodMs).toISOString()
        : new Date().toISOString();

      // Create rotation history record
      rotationRepo.create({
        oldKeyId: keyId,
        newKeyId: newId,
        reason,
        rotatedBy: actorId,
        oldKeyValidUntil,
      });

      // If no grace period, revoke old key immediately
      if (!gracePeriodMs) {
        keyRepo.updateStatus(keyId, KeyStatus.REVOKED, `Rotated: ${reason}`);
      }

      auditRepo.create({
        keyId,
        action: AuditAction.KEY_ROTATED,
        actorId,
        metadata: {
          newKeyId: newId,
          reason,
          gracePeriodMs: gracePeriodMs ?? null,
        },
      });

      const updatedOld = keyRepo.findById(keyId)!;
      return { oldEntity: updatedOld, newEntity };
    });

    return {
      oldKey: entityToResponse(result.oldEntity),
      newKey: entityToResponse(result.newEntity),
      plaintext: newPlaintext,
    };
  }

  async function revokeKey(
    keyId: string,
    reason: string,
    actorId: string,
    ipAddress?: string
  ): Promise<KeyResponse> {
    const updated = withTransaction(db, () => {
      const existing = keyRepo.findById(keyId);
      if (!existing) {
        throw new Error(`Key not found: ${keyId}`);
      }
      if (existing.status === KeyStatus.REVOKED) {
        throw new Error(`Key is already revoked: ${keyId}`);
      }

      keyRepo.updateStatus(keyId, KeyStatus.REVOKED, reason);

      auditRepo.create({
        keyId,
        action: AuditAction.KEY_REVOKED,
        actorId,
        metadata: { reason },
        ipAddress,
      });

      return keyRepo.findById(keyId)!;
    });

    return entityToResponse(updated);
  }

  async function listKeys(
    userId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<KeyResponse[]> {
    const entities = keyRepo.list({
      userId,
      status: options?.status as KeyStatus | undefined,
      limit: options?.limit,
      offset: options?.offset,
    });

    return entities.map(entityToResponse);
  }

  async function getKey(keyId: string): Promise<KeyResponse | null> {
    const entity = keyRepo.findById(keyId);
    return entity ? entityToResponse(entity) : null;
  }

  async function expireKeys(): Promise<number> {
    const expiredEntities = keyRepo.findExpired();
    const count = keyRepo.expireKeys();

    for (const entity of expiredEntities) {
      auditRepo.create({
        keyId: entity.id,
        action: AuditAction.KEY_EXPIRED,
        actorId: 'system',
        metadata: { expiresAt: entity.expiresAt },
      });
    }

    // Revoke ROTATING keys whose grace period has expired
    const rotatingKeys = keyRepo.list({ status: KeyStatus.ROTATING, limit: 1000 });
    let graceExpiredCount = 0;
    for (const entity of rotatingKeys) {
      const rotation = rotationRepo.findByOldKeyId(entity.id);
      if (rotation && new Date(rotation.oldKeyValidUntil) <= new Date()) {
        keyRepo.updateStatus(entity.id, KeyStatus.REVOKED, 'Grace period expired');
        auditRepo.create({
          keyId: entity.id,
          action: AuditAction.KEY_REVOKED,
          actorId: 'system',
          metadata: { reason: 'grace_period_expired', oldKeyValidUntil: rotation.oldKeyValidUntil },
        });
        graceExpiredCount++;
      }
    }

    return count + graceExpiredCount;
  }

  return {
    createKey,
    validateKey,
    rotateKey,
    revokeKey,
    listKeys,
    getKey,
    expireKeys,
  };
}

export type KeyService = ReturnType<typeof createKeyService>;
