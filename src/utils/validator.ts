// Request validation helpers

import { AuditAction } from '../models/AuditLog';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Type guard helpers

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function stripNullBytes(str: string): string {
  return str.replace(/\0/g, '');
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value) && value > 0;
}

// Validators

export function validateKeyCreate(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.userId)) {
    errors.push('userId is required and must be a non-empty string');
  }

  if (!isNonEmptyString(b.keyName)) {
    errors.push('keyName is required and must be a non-empty string');
  } else {
    b.keyName = stripNullBytes(b.keyName as string);
    if ((b.keyName as string).length > 255) {
      errors.push('keyName must be at most 255 characters');
    }
  }

  if (!Array.isArray(b.scopes) || b.scopes.length === 0) {
    errors.push('scopes is required and must be a non-empty array');
  } else if (b.scopes.length > 50) {
    errors.push('scopes must contain at most 50 entries');
  } else if (!b.scopes.every((s: unknown) => isNonEmptyString(s))) {
    errors.push('Each scope must be a non-empty string');
  } else {
    b.scopes = (b.scopes as string[]).map(s => stripNullBytes(s));
    if ((b.scopes as string[]).some(s => s.length > 100)) {
      errors.push('Each scope must be at most 100 characters');
    }
  }

  if (b.expiresInHours !== undefined) {
    if (!isPositiveNumber(b.expiresInHours)) {
      errors.push('expiresInHours must be a positive number');
    }
  }

  if (b.rateLimit !== undefined) {
    if (!b.rateLimit || typeof b.rateLimit !== 'object') {
      errors.push('rateLimit must be an object');
    } else {
      const rl = b.rateLimit as Record<string, unknown>;
      if (!isPositiveNumber(rl.windowMs)) {
        errors.push('rateLimit.windowMs must be a positive number');
      }
      if (!isPositiveNumber(rl.maxRequests)) {
        errors.push('rateLimit.maxRequests must be a positive number');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRevoke(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.reason)) {
    errors.push('reason is required and must be a non-empty string');
  } else if ((b.reason as string).length > 1000) {
    errors.push('reason must be at most 1000 characters');
  }

  return { valid: errors.length === 0, errors };
}

export function validateRotate(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.reason)) {
    errors.push('reason is required and must be a non-empty string');
  } else if ((b.reason as string).length > 1000) {
    errors.push('reason must be at most 1000 characters');
  }

  if (b.gracePeriodMs !== undefined) {
    if (!isPositiveNumber(b.gracePeriodMs)) {
      errors.push('gracePeriodMs must be a positive number');
    } else if ((b.gracePeriodMs as number) > 604800000) {
      errors.push('gracePeriodMs must be at most 604800000 (7 days)');
    }
  }

  return { valid: errors.length === 0, errors };
}

const VALID_AUDIT_ACTIONS = new Set(Object.values(AuditAction));

export function validateQueryParams(
  query: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];

  if (query.action !== undefined) {
    if (
      !isNonEmptyString(query.action) ||
      !VALID_AUDIT_ACTIONS.has(query.action as AuditAction)
    ) {
      errors.push(
        `action must be one of: ${[...VALID_AUDIT_ACTIONS].join(', ')}`,
      );
    }
  }

  if (query.actorId !== undefined) {
    if (!isNonEmptyString(query.actorId)) {
      errors.push('actorId must be a non-empty string');
    }
  }

  if (query.startDate !== undefined) {
    if (!isNonEmptyString(query.startDate) || isNaN(Date.parse(query.startDate))) {
      errors.push('startDate must be a valid ISO date string');
    }
  }

  if (query.endDate !== undefined) {
    if (!isNonEmptyString(query.endDate) || isNaN(Date.parse(query.endDate))) {
      errors.push('endDate must be a valid ISO date string');
    }
  }

  if (
    query.startDate &&
    query.endDate &&
    isNonEmptyString(query.startDate) &&
    isNonEmptyString(query.endDate)
  ) {
    if (Date.parse(query.startDate) > Date.parse(query.endDate)) {
      errors.push('startDate must be before endDate');
    }
  }

  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!isPositiveNumber(limit) || !Number.isInteger(limit)) {
      errors.push('limit must be a positive integer');
    }
  }

  if (query.offset !== undefined) {
    const offset = Number(query.offset);
    if (typeof offset !== 'number' || !isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
      errors.push('offset must be a non-negative integer');
    }
  }

  return { valid: errors.length === 0, errors };
}
