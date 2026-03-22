# API Key Manager — REST API Reference

> Base URL: `http://localhost:3000/api`

## Response Format

All responses follow the `ApiResponse<T>` envelope:

```typescript
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}
```

**Success:**

```json
{
  "success": true,
  "data": { "..." : "..." }
}
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

## Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `VALIDATION_ERROR` | 400 | Missing or invalid request parameters |
| `BAD_REQUEST` | 400 | Malformed request |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Requested resource does not exist |
| `ALREADY_REVOKED` | 409 | Key is already in revoked state |
| `INVALID_STATUS` | 409 | Key status does not allow the requested operation |
| `RATE_LIMITED` | 429 | Per-key rate limit exceeded |
| `TOO_MANY_REQUESTS` | 429 | Global rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error (details hidden in production) |

## Rate Limiting

When a request is associated with an API key entity, the following headers are included in every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |

When the limit is exceeded the server responds with HTTP 429:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again after 2026-03-22T12:00:00.000Z"
  }
}
```

## Common Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes (POST/PUT) | Must be `application/json` |
| `x-actor-id` | No | Identifies who performed the action. Recorded in audit logs. Defaults to `"anonymous"` |

> **Note:** Authentication is not currently implemented. See [VULNERABILITIES.md](VULNERABILITIES.md#critical-001) for details.

---

## Endpoints

### GET /api/health

Returns server health status.

**Headers:** None required.

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-03-22T14:00:00.000Z",
    "uptime": 3600.123
  }
}
```

**curl:**

```bash
curl http://localhost:3000/api/health
```

---

### POST /api/keys

Create a new API key. The plaintext key is returned **only in this response** -- it cannot be retrieved again.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-actor-id` | No | Actor identifier for audit trail |

**Request Body:**

```typescript
interface CreateKeyRequest {
  userId: string;          // Required. Owner of the key.
  keyName: string;         // Required. Human-readable name.
  scopes: string[];        // Required. Non-empty array of permission scopes.
  expiresInHours?: number; // Optional. Hours until expiration. Must be positive.
  rateLimit?: {            // Optional. Per-key rate limit.
    windowMs: number;      //   Window in milliseconds (default: 60000).
    maxRequests: number;   //   Max requests per window (default: 100).
  };
}
```

**Example request body:**

```json
{
  "userId": "alice",
  "keyName": "production-api",
  "scopes": ["read", "write"],
  "expiresInHours": 720,
  "rateLimit": {
    "windowMs": 60000,
    "maxRequests": 1000
  }
}
```

**Success Response (`201 Created`):**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "userId": "alice",
    "keyName": "production-api",
    "keyPrefix": "hg_kL9x",
    "scopes": ["read", "write"],
    "status": "active",
    "rateLimit": {
      "windowMs": 60000,
      "maxRequests": 1000
    },
    "expiresAt": "2026-04-22T14:00:00.000Z",
    "createdAt": "2026-03-22T14:00:00.000Z",
    "lastUsedAt": null,
    "revokedAt": null,
    "revokedReason": null,
    "plaintext": "hg_kL9xm2pQ5r8tVwYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890ABC"
  }
}
```

> **Important:** Store the `plaintext` value securely. It will never be returned again.

**Error Responses:**

*Missing required fields (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "userId, keyName, and scopes are required"
  }
}
```

*Invalid scopes (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "scopes must be a non-empty array"
  }
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -H "x-actor-id: alice" \
  -d '{
    "userId": "alice",
    "keyName": "production-api",
    "scopes": ["read", "write"],
    "expiresInHours": 720,
    "rateLimit": { "windowMs": 60000, "maxRequests": 1000 }
  }'
```

---

### GET /api/keys

List keys belonging to a user, with optional filtering and pagination.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `x-actor-id` | No | Actor identifier for audit trail |

**Query Parameters:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `userId` | Yes | string | Filter keys by owner |
| `status` | No | string | Filter: `active`, `expired`, `revoked`, `rotating` |
| `limit` | No | integer | Max results (positive integer) |
| `offset` | No | integer | Pagination offset (non-negative integer) |

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "userId": "alice",
      "keyName": "production-api",
      "keyPrefix": "hg_kL9x",
      "scopes": ["read", "write"],
      "status": "active",
      "rateLimit": { "windowMs": 60000, "maxRequests": 1000 },
      "expiresAt": "2026-04-22T14:00:00.000Z",
      "createdAt": "2026-03-22T14:00:00.000Z",
      "lastUsedAt": "2026-03-22T15:30:00.000Z",
      "revokedAt": null,
      "revokedReason": null
    }
  ]
}
```

**Error Responses:**

*Missing userId (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "userId query parameter is required"
  }
}
```

**curl:**

```bash
curl "http://localhost:3000/api/keys?userId=alice&status=active&limit=10&offset=0"
```

---

### GET /api/keys/:id

Retrieve metadata for a single key. Does not return the plaintext key.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `x-actor-id` | No | Actor identifier for audit trail |

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The key ID |

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "userId": "alice",
    "keyName": "production-api",
    "keyPrefix": "hg_kL9x",
    "scopes": ["read", "write"],
    "status": "active",
    "rateLimit": { "windowMs": 60000, "maxRequests": 1000 },
    "expiresAt": "2026-04-22T14:00:00.000Z",
    "createdAt": "2026-03-22T14:00:00.000Z",
    "lastUsedAt": "2026-03-22T15:30:00.000Z",
    "revokedAt": null,
    "revokedReason": null
  }
}
```

**Error Responses:**

*Key not found (`404`):*

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Key not found: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**curl:**

```bash
curl http://localhost:3000/api/keys/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### PUT /api/keys/:id/rotate

Rotate an existing key. Creates a new replacement key and optionally keeps the old key valid during a grace period. Returns the new plaintext key.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-actor-id` | No | Actor identifier for audit trail |

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The key ID to rotate |

**Request Body:**

```typescript
interface RotateKeyRequest {
  reason: string;          // Required. Why the key is being rotated.
  gracePeriodMs?: number;  // Optional. Milliseconds to keep old key valid. Must be positive.
}
```

**Example request body:**

```json
{
  "reason": "Scheduled quarterly rotation",
  "gracePeriodMs": 86400000
}
```

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "oldKey": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "userId": "alice",
      "keyName": "production-api",
      "status": "rotating",
      "scopes": ["read", "write"],
      "rateLimit": { "windowMs": 60000, "maxRequests": 1000 },
      "expiresAt": "2026-04-22T14:00:00.000Z",
      "createdAt": "2026-03-22T14:00:00.000Z",
      "lastUsedAt": "2026-03-22T15:30:00.000Z",
      "revokedAt": null,
      "revokedReason": null
    },
    "newKey": {
      "id": "f1e2d3c4-b5a6-7890-1234-567890abcdef",
      "userId": "alice",
      "keyName": "production-api",
      "status": "active",
      "scopes": ["read", "write"],
      "rateLimit": { "windowMs": 60000, "maxRequests": 1000 },
      "expiresAt": "2026-04-22T14:00:00.000Z",
      "createdAt": "2026-03-22T16:00:00.000Z",
      "lastUsedAt": null,
      "revokedAt": null,
      "revokedReason": null
    },
    "plaintext": "hg_newKeyBase64UrlEncodedString..."
  }
}
```

> **Important:** The `plaintext` field contains the new key. Store it securely -- it cannot be retrieved again.

**Error Responses:**

*Missing reason (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "reason is required"
  }
}
```

*Key not found (`404`):*

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Key not found: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

*Key not active (`409`):*

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS",
    "message": "Key must be active to rotate"
  }
}
```

**curl:**

```bash
# Immediate rotation
curl -X PUT http://localhost:3000/api/keys/a1b2c3d4-e5f6-7890-abcd-ef1234567890/rotate \
  -H "Content-Type: application/json" \
  -H "x-actor-id: alice" \
  -d '{"reason": "scheduled quarterly rotation"}'

# With 24-hour grace period
curl -X PUT http://localhost:3000/api/keys/a1b2c3d4-e5f6-7890-abcd-ef1234567890/rotate \
  -H "Content-Type: application/json" \
  -H "x-actor-id: alice" \
  -d '{"reason": "security review", "gracePeriodMs": 86400000}'
```

---

### PUT /api/keys/:id/revoke

Permanently revoke an API key. The key becomes immediately unusable and cannot be reactivated.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-actor-id` | No | Actor identifier for audit trail |

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The key ID to revoke |

**Request Body:**

```typescript
interface RevokeKeyRequest {
  reason: string; // Required. Why the key is being revoked.
}
```

**Example request body:**

```json
{
  "reason": "Employee terminated"
}
```

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "userId": "alice",
    "keyName": "production-api",
    "keyPrefix": "hg_kL9x",
    "scopes": ["read", "write"],
    "status": "revoked",
    "rateLimit": { "windowMs": 60000, "maxRequests": 1000 },
    "expiresAt": "2026-04-22T14:00:00.000Z",
    "createdAt": "2026-03-22T14:00:00.000Z",
    "lastUsedAt": "2026-03-22T15:30:00.000Z",
    "revokedAt": "2026-03-22T16:00:00.000Z",
    "revokedReason": "Employee terminated"
  }
}
```

**Error Responses:**

*Missing reason (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "reason is required"
  }
}
```

*Key not found (`404`):*

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Key not found: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

*Already revoked (`409`):*

```json
{
  "success": false,
  "error": {
    "code": "ALREADY_REVOKED",
    "message": "Key is already revoked"
  }
}
```

**curl:**

```bash
curl -X PUT http://localhost:3000/api/keys/a1b2c3d4-e5f6-7890-abcd-ef1234567890/revoke \
  -H "Content-Type: application/json" \
  -H "x-actor-id: admin" \
  -d '{"reason": "Employee terminated"}'
```

---

### POST /api/keys/:id/validate

Check whether a plaintext API key is valid (correct hash, active status, not expired).

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The key ID to validate against |

**Request Body:**

```typescript
interface ValidateKeyRequest {
  key: string; // Required. The plaintext API key to validate.
}
```

**Example request body:**

```json
{
  "key": "hg_kL9xm2pQ5r8tVwYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890ABC"
}
```

**Success Response (`200 OK`) -- valid key:**

```json
{
  "success": true,
  "data": {
    "valid": true,
    "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Success Response (`200 OK`) -- invalid key:**

```json
{
  "success": true,
  "data": {
    "valid": false,
    "keyId": null
  }
}
```

**Error Responses:**

*Missing key (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "key (plaintext) is required in body"
  }
}
```

**Side Effects:**
- On valid: updates `lastUsedAt` and logs a `key.accessed` audit event.
- On invalid: no side effects, no audit trail.

> **Security Note:** This endpoint does not audit failed validation attempts. See [VULNERABILITIES.md](VULNERABILITIES.md#medium-005).

**curl:**

```bash
curl -X POST http://localhost:3000/api/keys/a1b2c3d4-e5f6-7890-abcd-ef1234567890/validate \
  -H "Content-Type: application/json" \
  -d '{"key": "hg_kL9xm2pQ5r8tVwYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890ABC"}'
```

---

### GET /api/keys/:id/audit

Get audit log history for a specific key.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `x-actor-id` | No | Actor identifier for audit trail |

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | The key ID |

**Query Parameters:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `limit` | No | integer | Max number of log entries to return |

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "action": "key.created",
      "actorId": "alice",
      "metadata": { "keyName": "production-api", "scopes": ["read", "write"] },
      "ipAddress": "192.168.1.100",
      "createdAt": "2026-03-22T14:00:00.000Z"
    },
    {
      "id": 2,
      "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "action": "key.accessed",
      "actorId": "system",
      "metadata": null,
      "ipAddress": "10.0.0.50",
      "createdAt": "2026-03-22T15:30:00.000Z"
    }
  ]
}
```

**curl:**

```bash
curl "http://localhost:3000/api/keys/a1b2c3d4-e5f6-7890-abcd-ef1234567890/audit?limit=100"
```

---

### GET /api/audit

Query audit logs across all keys with filtering and pagination.

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `x-actor-id` | No | Actor identifier for audit trail |

**Query Parameters:**

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `keyId` | No | string | Filter by key ID |
| `action` | No | string | Filter by audit action (see table below) |
| `actorId` | No | string | Filter by actor identifier |
| `startDate` | No | string | ISO 8601 date. Return logs on or after this date. `startDate` must be before `endDate`. |
| `endDate` | No | string | ISO 8601 date. Return logs on or before this date. |
| `limit` | No | integer | Max results (positive integer) |
| `offset` | No | integer | Pagination offset (non-negative integer) |

**Valid `action` values:**

| Value | Description |
|-------|-------------|
| `key.created` | Key was generated |
| `key.validated` | Key was validated (legacy) |
| `key.revoked` | Key was revoked |
| `key.rotated` | Key was rotated |
| `key.expired` | Key expired automatically |
| `key.deleted` | Key was deleted |
| `key.updated` | Key was updated |
| `key.accessed` | Key was used for validation |

**Success Response (`200 OK`):**

```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "action": "key.rotated",
      "actorId": "alice",
      "metadata": { "newKeyId": "f1e2d3c4-...", "reason": "security review" },
      "ipAddress": "192.168.1.100",
      "createdAt": "2026-03-22T16:00:00.000Z"
    }
  ]
}
```

**Error Responses:**

*Invalid action value (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "action must be one of: key.created, key.validated, key.revoked, key.rotated, key.expired, key.deleted, key.updated, key.accessed"
  }
}
```

*Invalid date format (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "startDate must be a valid ISO date string"
  }
}
```

*Date range invalid (`400`):*

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "startDate must be before endDate"
  }
}
```

**curl:**

```bash
# All rotation events in the last week
curl "http://localhost:3000/api/audit?action=key.rotated&startDate=2026-03-15T00:00:00Z&limit=100"

# All events by a specific actor
curl "http://localhost:3000/api/audit?actorId=alice&limit=25"

# Paginated query
curl "http://localhost:3000/api/audit?limit=20&offset=40"

# All events for a specific key in a date range
curl "http://localhost:3000/api/audit?keyId=a1b2c3d4-e5f6-7890-abcd-ef1234567890&startDate=2026-03-01T00:00:00Z&endDate=2026-03-31T23:59:59Z"
```

---

## Key Statuses

| Status | Description |
|--------|-------------|
| `active` | Key is valid and can be used for authentication |
| `expired` | Key has passed its expiration time |
| `revoked` | Key was explicitly revoked and cannot be used |
| `rotating` | Key is being rotated; may still be valid during grace period |

---

## Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) -- System design and component details
- [CLI.md](CLI.md) -- CLI command reference (same operations, different interface)
- [VULNERABILITIES.md](VULNERABILITIES.md) -- Known security issues affecting API endpoints
