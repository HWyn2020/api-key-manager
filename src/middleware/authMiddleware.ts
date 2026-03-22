import { Request, Response, NextFunction } from 'express';
import { KeyService } from '../services/keyService';

export function createAuthMiddleware(keyService: KeyService) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Skip auth for health endpoint
    if (req.path === '/api/health' || req.path === '/health') {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    // Always derive an apiKey and pass it through validateKey to ensure
    // consistent response timing regardless of failure mode (RT4-002).
    let apiKey: string;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      apiKey = 'invalid';
    } else {
      apiKey = authHeader.slice(7) || 'invalid';
    }

    try {
      const entity = await keyService.validateKey(apiKey, req.ip);
      if (!entity) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Valid API key required',
          },
        });
        return;
      }

      req.apiKeyEntity = entity;
      next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid API key required',
        },
      });
    }
  };
}
