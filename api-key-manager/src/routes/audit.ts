import { Router, Request, Response, NextFunction } from 'express';
import { createAuditService } from '../services/auditService';
import { KeyService } from '../services/keyService';
import { AuditAction } from '../models/AuditLog';
import { validateQueryParams } from '../utils/validator';

type AuditService = ReturnType<typeof createAuditService>;

export function createAuditRouter(auditService: AuditService, keyService: KeyService): Router {
  const router = Router();

  // GET / — Query audit logs
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const queryValidation = validateQueryParams(req.query as Record<string, unknown>);
      if (!queryValidation.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: queryValidation.errors.join('; '),
          },
        });
        return;
      }

      const { keyId, action, startDate, endDate, limit, offset } = req.query;
      const authenticatedUserId = req.apiKeyEntity!.userId;

      // If a specific keyId is requested, verify ownership
      if (keyId && typeof keyId === 'string') {
        const targetKey = await keyService.getKey(keyId);
        if (!targetKey || targetKey.userId !== authenticatedUserId) {
          res.json({ success: true, data: [] });
          return;
        }
      }

      // Filter audit logs to only show entries for the authenticated user's keys
      const userKeys = await keyService.listKeys(authenticatedUserId, { limit: 1000 });
      const userKeyIds = new Set(userKeys.map(k => k.keyId));

      const parsedLimit = limit ? Math.min(parseInt(limit as string, 10), 100) : undefined;

      const logs = auditService.query({
        keyId: keyId as string | undefined,
        action: action as AuditAction | undefined,
        actorId: authenticatedUserId,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        limit: parsedLimit,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      // Further filter to only include logs for keys owned by the authenticated user
      const filteredLogs = logs.filter(log => log.keyId !== null && userKeyIds.has(log.keyId));

      res.json({
        success: true,
        data: filteredLogs,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
