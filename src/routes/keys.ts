import { Router, Request, Response, NextFunction } from 'express';
import { KeyService } from '../services/keyService';
import { createAuditService } from '../services/auditService';
import { createRateLimiter } from '../services/rateLimiter';
import { AuditAction } from '../models/AuditLog';
import { validateKeyCreate, validateRevoke, validateRotate, isNonEmptyString } from '../utils/validator';
import { KeyStatus } from '../models/Key';

const VALID_KEY_STATUSES = new Set(Object.values(KeyStatus));

type AuditService = ReturnType<typeof createAuditService>;

function getActorId(req: Request): string {
  return req.apiKeyEntity?.userId ?? 'anonymous';
}

function notFoundResponse(res: Response, id: string): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Key not found: ${id}`,
    },
  });
}

export function createKeysRouter(keyService: KeyService, auditService: AuditService): Router {
  const router = Router();

  // Dedicated rate limiter for the validate endpoint (max 10 per minute per IP)
  const validateRateLimiter = createRateLimiter();
  const VALIDATE_WINDOW_MS = 60 * 1000; // 1 minute
  const VALIDATE_MAX_REQUESTS = 10;

  // POST / — Create key
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.apiKeyEntity!.userId;
      const validation = validateKeyCreate({ ...req.body, userId });
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.errors.join('; '),
          },
        });
        return;
      }

      const { keyName, scopes, expiresInHours, rateLimit } = req.body;
      const actorId = getActorId(req);
      const result = await keyService.createKey(
        { userId, keyName, scopes, expiresInHours, rateLimit },
        actorId,
        req.ip
      );

      res.status(201).json({
        success: true,
        data: {
          ...result.key,
          plaintext: result.plaintext,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET / — List keys
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, limit, offset } = req.query;
      const userId = req.apiKeyEntity!.userId;

      if (status !== undefined) {
        if (!VALID_KEY_STATUSES.has(status as KeyStatus)) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `status must be one of: ${[...VALID_KEY_STATUSES].join(', ')}`,
            },
          });
          return;
        }
      }

      if (limit !== undefined) {
        const parsed = Number(limit);
        if (!Number.isInteger(parsed) || parsed < 1) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'limit must be a positive integer' },
          });
          return;
        }
      }
      if (offset !== undefined) {
        const parsed = Number(offset);
        if (!Number.isInteger(parsed) || parsed < 0) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'offset must be a non-negative integer' },
          });
          return;
        }
      }

      const parsedLimit = limit ? Math.min(parseInt(limit as string, 10), 100) : undefined;

      const keys = await keyService.listKeys(userId, {
        status: status as string | undefined,
        limit: parsedLimit,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      res.json({
        success: true,
        data: keys,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /:id — Get key by ID
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = await keyService.getKey(req.params.id);

      if (!key || req.apiKeyEntity!.userId !== key.userId) {
        notFoundResponse(res, req.params.id);
        return;
      }

      res.json({
        success: true,
        data: key,
      });
    } catch (err) {
      next(err);
    }
  });

  // PUT /:id/rotate — Rotate key
  router.put('/:id/rotate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = validateRotate(req.body);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.errors.join('; '),
          },
        });
        return;
      }

      const { reason, gracePeriodMs } = req.body;

      const targetKey = await keyService.getKey(req.params.id);
      if (!targetKey || req.apiKeyEntity!.userId !== targetKey.userId) {
        notFoundResponse(res, req.params.id);
        return;
      }

      const actorId = getActorId(req);
      const result = await keyService.rotateKey(
        req.params.id,
        reason,
        actorId,
        gracePeriodMs
      );

      res.json({
        success: true,
        data: {
          oldKey: result.oldKey,
          newKey: result.newKey,
          plaintext: result.plaintext,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // PUT /:id/revoke — Revoke key
  router.put('/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = validateRevoke(req.body);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.errors.join('; '),
          },
        });
        return;
      }

      const { reason } = req.body;

      const targetKey = await keyService.getKey(req.params.id);
      if (!targetKey || req.apiKeyEntity!.userId !== targetKey.userId) {
        notFoundResponse(res, req.params.id);
        return;
      }

      const actorId = getActorId(req);
      const key = await keyService.revokeKey(req.params.id, reason, actorId, req.ip);

      res.json({
        success: true,
        data: key,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /:id/validate — Validate a key
  router.post('/:id/validate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = req.body;

      if (!isNonEmptyString(key)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'key (plaintext) is required and must be a non-empty string',
          },
        });
        return;
      }

      const targetKey = await keyService.getKey(req.params.id);
      if (!targetKey || req.apiKeyEntity!.userId !== targetKey.userId) {
        notFoundResponse(res, req.params.id);
        return;
      }

      // Rate limit validation attempts per IP
      const clientIp = req.ip || 'unknown';
      const rateLimitKey = `validate:${clientIp}`;
      const rlResult = validateRateLimiter.check(rateLimitKey, VALIDATE_WINDOW_MS, VALIDATE_MAX_REQUESTS);
      if (!rlResult.allowed) {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many validation attempts. Please try again later.',
          },
        });
        return;
      }
      validateRateLimiter.increment(rateLimitKey);

      const entity = await keyService.validateKey(key, req.ip);

      if (!entity) {
        // Audit log failed validation attempt
        auditService.log({
          keyId: req.params.id,
          action: AuditAction.KEY_VALIDATED,
          actorId: 'anonymous',
          metadata: { success: false, ip: clientIp },
          ipAddress: clientIp,
        });

        // Generic response — don't reveal whether key ID exists or key was wrong
        res.json({
          success: true,
          data: {
            valid: false,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          valid: true,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /:id/audit — Get audit logs for key
  router.get('/:id/audit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.query.limit !== undefined) {
        const parsed = Number(req.query.limit);
        if (!Number.isInteger(parsed) || parsed < 1) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'limit must be a positive integer' },
          });
          return;
        }
      }

      const targetKey = await keyService.getKey(req.params.id);
      if (!targetKey || req.apiKeyEntity!.userId !== targetKey.userId) {
        notFoundResponse(res, req.params.id);
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const logs = auditService.getKeyHistory(req.params.id, limit);

      res.json({
        success: true,
        data: logs,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
