import { AuditAction, AuditLogEntry, AuditLogQuery } from '../models/AuditLog';
import { AuditRepository } from '../database/repositories/AuditRepository';

export function createAuditService(auditRepo: AuditRepository) {
  return {
    log(params: {
      keyId: string;
      action: AuditAction;
      actorId: string;
      metadata?: Record<string, unknown>;
      ipAddress?: string;
    }): AuditLogEntry {
      return auditRepo.create({
        keyId: params.keyId,
        action: params.action,
        actorId: params.actorId,
        metadata: params.metadata,
        ipAddress: params.ipAddress,
      });
    },

    getKeyHistory(keyId: string, limit?: number): AuditLogEntry[] {
      return auditRepo.findByKeyId(keyId, limit);
    },

    query(options: AuditLogQuery): AuditLogEntry[] {
      return auditRepo.list(options);
    },

    cleanup(retentionDays: number): number {
      return auditRepo.deleteOlderThan(retentionDays);
    },
  };
}
