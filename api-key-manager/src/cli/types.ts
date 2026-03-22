import { createKeyService } from '../services/keyService';
import { createAuditService } from '../services/auditService';
import { RotationRepository } from '../database/repositories/RotationRepository';

export interface CliDeps {
  keyService: ReturnType<typeof createKeyService>;
  auditService: ReturnType<typeof createAuditService>;
  rotationRepo: RotationRepository;
}
