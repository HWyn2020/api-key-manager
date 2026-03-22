import express, { Express } from 'express';
import { loadConfig, AppConfig } from './config';
import { initializeDatabase } from './database';
import { createKeyService } from './services/keyService';
import { createAuditService } from './services/auditService';
import { createRateLimiter } from './services/rateLimiter';
import { requestLogger, errorHandler, createRateLimitMiddleware, createAuthMiddleware } from './middleware';
import { createRouter } from './routes';

export function createServer(config?: AppConfig): {
  app: Express;
  start: () => void;
} {
  const cfg = config ?? loadConfig();
  const app = express();

  // Trust proxy only if explicitly configured
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', true);
  }

  // Body parsing
  app.use(express.json({ limit: '100kb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
  });

  // CORS: deny cross-origin requests
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      // Cross-origin request — block it
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed' },
      });
      return;
    }
    next();
  });

  // Initialize database and repositories
  const { db, repos } = initializeDatabase(cfg.database);

  // Create services
  const rateLimiter = createRateLimiter();
  const auditService = createAuditService(repos.audit);
  const keyService = createKeyService({
    keyRepo: repos.keys,
    rotationRepo: repos.rotations,
    auditRepo: repos.audit,
    encryptionKey: cfg.encryptionKey,
    db,
  });

  // Middleware
  app.use(requestLogger);
  app.use(createAuthMiddleware(keyService));
  app.use(createRateLimitMiddleware(rateLimiter));

  // Routes
  app.use('/api', createRouter({ keyService, auditService }));

  // Error handler (must be last)
  app.use(errorHandler);

  function start(): void {
    const httpServer = app.listen(cfg.port, () => {
      console.log(`API Key Manager running on port ${cfg.port} [${cfg.nodeEnv}]`);
    });

    const shutdown = () => {
      rateLimiter.destroy();
      httpServer.close();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  return { app, start };
}

export function startServer(): void {
  const config = loadConfig();
  const server = createServer(config);
  server.start();
}

if (require.main === module) {
  startServer();
}
