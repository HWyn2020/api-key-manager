import { Router } from 'express';
import { KeyService } from '../services/keyService';
import { createAuditService } from '../services/auditService';
import { createHealthRouter } from './health';
import { createKeysRouter } from './keys';
import { createAuditRouter } from './audit';

type AuditService = ReturnType<typeof createAuditService>;

export function createRouter(deps: {
  keyService: KeyService;
  auditService: AuditService;
}): Router {
  const router = Router();

  router.use('/health', createHealthRouter());
  router.use('/keys', createKeysRouter(deps.keyService, deps.auditService));
  router.use('/audit', createAuditRouter(deps.auditService, deps.keyService));

  return router;
}
