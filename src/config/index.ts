import path from 'path';

export interface DatabaseConfig {
  path: string;
  walMode: boolean;
  busyTimeout: number;
}

export interface AppConfig {
  database: DatabaseConfig;
  encryptionKey: string;
  port: number;
  nodeEnv: string;
  redisUrl: string;
  logLevel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function validateEncryptionKey(key: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      `Received ${key.length} characters.`
    );
  }
  return key;
}

export function loadConfig(): AppConfig {
  const dbPath = optionalEnv('DATABASE_PATH', path.join(process.cwd(), 'data', 'api-key-manager.db'));

  return {
    database: {
      path: dbPath,
      walMode: true,
      busyTimeout: 5000,
    },
    encryptionKey: validateEncryptionKey(requireEnv('ENCRYPTION_KEY')),
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    redisUrl: optionalEnv('REDIS_URL', 'redis://localhost:6379'),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
  };
}

export function loadTestConfig(): AppConfig {
  return {
    database: {
      path: ':memory:',
      walMode: false,
      busyTimeout: 5000,
    },
    encryptionKey: 'a'.repeat(64),
    port: 3001,
    nodeEnv: 'test',
    redisUrl: 'redis://localhost:6379',
    logLevel: 'error',
  };
}
