import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const ip = process.env.TRUST_PROXY === 'true'
    ? req.headers['x-forwarded-for'] || req.socket.remoteAddress
    : req.socket.remoteAddress;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms - IP: ${ip}`
    );
  });

  next();
}
