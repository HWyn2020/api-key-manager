export enum AuditAction {
  KEY_CREATED = 'key.created',
  KEY_VALIDATED = 'key.validated',
  KEY_REVOKED = 'key.revoked',
  KEY_ROTATED = 'key.rotated',
  KEY_EXPIRED = 'key.expired',
  KEY_DELETED = 'key.deleted',
  KEY_UPDATED = 'key.updated',
  KEY_ACCESSED = 'key.accessed',
}

export interface AuditLogEntry {
  id: number;
  keyId: string | null;
  action: AuditAction;
  actorId: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogCreate {
  keyId: string | null;
  action: AuditAction;
  actorId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export interface AuditLogQuery {
  keyId?: string;
  action?: AuditAction;
  actorId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}
