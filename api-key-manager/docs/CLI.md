# API Key Manager — CLI Reference

## Overview

The CLI provides direct command-line access to all key management operations. It initializes its own database connection, executes the command, and exits.

Run it with:

```bash
npx tsx src/cli/index.ts <command> [args...]
```

To see available commands:

```bash
npx tsx src/cli/index.ts --help
```

## Prerequisites

- **Node.js** and **tsx** must be installed.
- The SQLite database must already exist. Run migrations before using the CLI.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | Yes | Encryption key used to encrypt/decrypt stored API key material. |
| `DATABASE_PATH` | Yes | Path to the SQLite database file. |

Example:

```bash
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export DATABASE_PATH=./data/keys.db
```

---

## Commands

### `create`

Creates a new API key for a user. The plaintext key is displayed **once** on creation and cannot be retrieved again.

**Syntax:**

```
create <user-id> <name> [scopes...]
```

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `user-id` | Yes | The user ID to associate with the key. |
| `name` | Yes | A human-readable name for the key. |
| `scopes` | No | Space-separated list of scopes (e.g. `read write admin`). Defaults to `["read"]` if omitted. |

**Examples:**

```bash
# Key with default scopes (read)
npx tsx src/cli/index.ts create user_823 "My API Key"

# Key with multiple scopes
npx tsx src/cli/index.ts create user_823 "Production API" read write admin
```

**Sample output:**

```
API key created successfully.

 WARNING: Save this key now. You will not be able to see it again!

  Plaintext Key:  hg_k7f2a9c1e4b83d560f1e9a7b2c4d6e8f

Key details:
{
  "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "userId": "user_823",
  "keyName": "Production API",
  "status": "active",
  "scopes": ["read", "write", "admin"],
  "createdAt": "2026-03-22T10:15:30.000Z",
  "expiresAt": null,
  "lastUsedAt": null
}
```

**Errors:**

- `Missing required arguments.` — `user-id` or `name` was not provided. Prints usage and exits with code `1`.

---

### `validate`

Checks whether a plaintext API key is valid (correct hash, active status, not expired).

**Syntax:**

```
validate <key>
```

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `key` | Yes | The plaintext API key to validate (e.g. `hg_k7f2a9...`). |

**Example:**

```bash
npx tsx src/cli/index.ts validate hg_k7f2a9c1e4b83d560f1e9a7b2c4d6e8f
```

**Sample output (valid key):**

```
Key is VALID.

  Key ID:      a1b2c3d4-e5f6-7890-abcd-ef1234567890
  User ID:     user_823
  Name:        Production API
  Status:      active
  Scopes:      read, write, admin
  Created:     2026-03-22T10:15:30.000Z
  Last Used:   2026-03-22T14:02:11.000Z
  Expires:     never
```

**Sample output (invalid key):**

```
Key is INVALID or inactive.
```

Exit code is `1` when the key is invalid or inactive.

**Errors:**

- `Missing required argument: key` — no key argument was provided. Prints usage and exits with code `1`.

---

### `rotate`

Rotates an existing key by generating a new key and optionally keeping the old key valid for a grace period.

**Syntax:**

```
rotate <key-id> <reason> [grace-period-ms]
```

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `key-id` | Yes | The UUID of the key to rotate. |
| `reason` | Yes | Reason for rotation (e.g. `"quarterly rotation"`). |
| `grace-period-ms` | No | Milliseconds the old key remains valid after rotation. If omitted, the old key is invalidated immediately. |

**Examples:**

```bash
# Immediate rotation (old key invalidated right away)
npx tsx src/cli/index.ts rotate a1b2c3d4-e5f6-7890-abcd-ef1234567890 "quarterly rotation"

# With 1-hour grace period (3600000 ms)
npx tsx src/cli/index.ts rotate a1b2c3d4-e5f6-7890-abcd-ef1234567890 "security review" 3600000
```

**Sample output:**

```
Key rotated successfully.

 WARNING: Save the new key now. You will not be able to see it again!

  New Plaintext Key:  hg_n8e3b0d2f5a94c671g2h0b8c3d5f7a9e

Old key:
{
  "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "userId": "user_823",
  "keyName": "Production API",
  "status": "rotating",
  "scopes": ["read", "write"],
  "createdAt": "2026-03-22T10:15:30.000Z",
  "expiresAt": "2026-03-22T11:15:30.000Z"
}

New key:
{
  "keyId": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  "userId": "user_823",
  "keyName": "Production API",
  "status": "active",
  "scopes": ["read", "write"],
  "createdAt": "2026-03-22T10:15:30.000Z",
  "expiresAt": null
}
```

**Errors:**

- `Missing required arguments.` — `key-id` or `reason` was not provided.
- `Invalid grace period. Must be a non-negative number.` — the grace period value is not a valid non-negative integer.

---

### `revoke`

Permanently revokes an API key. This cannot be undone.

**Syntax:**

```
revoke <key-id> <reason>
```

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `key-id` | Yes | The UUID of the key to revoke. |
| `reason` | Yes | Reason for revocation (e.g. `"compromised"`, `"employee terminated"`). |

**Example:**

```bash
npx tsx src/cli/index.ts revoke a1b2c3d4-e5f6-7890-abcd-ef1234567890 "key leaked in logs"
```

**Sample output:**

```
Key revoked successfully.

{
  "keyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "userId": "user_823",
  "keyName": "Production API",
  "status": "revoked",
  "scopes": ["read", "write"],
  "createdAt": "2026-03-22T10:15:30.000Z",
  "expiresAt": null
}
```

**Errors:**

- `Missing required arguments.` — `key-id` or `reason` was not provided.

---

### `list`

Lists API keys belonging to a user, with optional status filtering and result limiting.

**Syntax:**

```
list <user-id> [--status=<status>] [--limit=<n>]
```

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `user-id` | Yes | The user ID to list keys for. |

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--status=<status>` | *(none — returns all statuses)* | Filter by status: `active`, `expired`, `revoked`, `rotating`. |
| `--limit=<n>` | `50` | Maximum number of results to return. |

**Examples:**

```bash
# All keys for a user
npx tsx src/cli/index.ts list user_823

# Only active keys, limit to 10
npx tsx src/cli/index.ts list user_823 --status=active --limit=10
```

**Sample output:**

```
KEY ID                                  NAME                  STATUS      SCOPES                    CREATED                 EXPIRES
--------------------------------------  --------------------  ----------  ------------------------  ----------------------  ----------------------
a1b2c3d4-e5f6-7890-abcd-ef1234567890  Production API        active      read, write               2026-03-22T10:15:30.00  never
b2c3d4e5-f6a7-8901-bcde-f12345678901  Staging Key           active      read                      2026-03-20T08:00:00.00  2026-06-20T08:00:00.00

Total: 2 key(s)
```

When no keys match:

```
No keys found.
```

**Errors:**

- `Missing required argument: user-id` — no user ID was provided, or the first argument starts with `--` (looks like a flag instead of a user ID).

---

### `history`

Shows the rotation history for a specific key, including which key replaced it and any grace periods.

**Syntax:**

```
history <key-id>
```

**Arguments:**

| Argument | Required | Description |
|---|---|---|
| `key-id` | Yes | The UUID of the key to show rotation history for. |

**Example:**

```bash
npx tsx src/cli/index.ts history a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Sample output:**

```
ID      OLD KEY ID                              NEW KEY ID                              REASON                    ROTATED BY      VALID UNTIL             ROTATED AT
------  --------------------------------------  --------------------------------------  ------------------------  --------------  ----------------------  ----------------------
1       c3d4e5f6-a7b8-9012-cdef-123456789012  a1b2c3d4-e5f6-7890-abcd-ef1234567890  scheduled rotation        cli             2026-01-15T09:00:00.00  2026-01-15T08:00:00.00
2       a1b2c3d4-e5f6-7890-abcd-ef1234567890  f9e8d7c6-b5a4-3210-fedc-ba0987654321  quarterly rotation        cli             2026-03-22T11:15:30.00  2026-03-22T10:15:30.00

Total: 2 record(s)
```

When no history exists:

```
No rotation history found.
```

**Errors:**

- `Missing required argument: key-id` — no key ID was provided.

---

### `audit`

Queries the audit log. All options are filters; if none are provided, the most recent entries (up to the limit) are returned.

**Syntax:**

```
audit [--key-id=<id>] [--action=<action>] [--actor-id=<id>] [--limit=<n>]
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--key-id=<id>` | *(none)* | Filter entries for a specific key UUID. |
| `--action=<action>` | *(none)* | Filter by action type (see valid values below). |
| `--actor-id=<id>` | *(none)* | Filter by the actor who performed the action. |
| `--limit=<n>` | `50` | Maximum number of results to return. |

**Valid action values:**

| Action | Description |
|---|---|
| `key.created` | A new key was created. |
| `key.validated` | A key was validated (looked up by plaintext). |
| `key.revoked` | A key was permanently revoked. |
| `key.rotated` | A key was rotated (replaced by a new key). |
| `key.expired` | A key expired naturally. |
| `key.deleted` | A key was deleted. |
| `key.updated` | A key's metadata was updated. |
| `key.accessed` | A key was accessed/used. |

**Examples:**

```bash
# All events for a specific key
npx tsx src/cli/index.ts audit --key-id=a1b2c3d4-e5f6-7890-abcd-ef1234567890

# All rotation events
npx tsx src/cli/index.ts audit --action=key.rotated

# Events by a specific actor, higher limit
npx tsx src/cli/index.ts audit --actor-id=cli --limit=100

# Combined filters
npx tsx src/cli/index.ts audit --key-id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 --action=key.created --limit=5
```

**Sample output:**

```
ID      KEY ID                                  ACTION              ACTOR           IP                CREATED AT
------  --------------------------------------  ------------------  --------------  ----------------  ----------------------
3       a1b2c3d4-e5f6-7890-abcd-ef1234567890  key.revoked         cli             -                 2026-03-22T16:00:00.00
2       a1b2c3d4-e5f6-7890-abcd-ef1234567890  key.validated       cli             -                 2026-03-22T14:02:11.00
1       a1b2c3d4-e5f6-7890-abcd-ef1234567890  key.created         cli             -                 2026-03-22T10:15:30.00

Total: 3 entry(ies)

Metadata:
  [3] {"reason":"key leaked in logs"}
  [1] {"scopes":["read","write"]}
```

When no entries match:

```
No audit log entries found.
```

Entries that carry metadata are printed in a separate section at the bottom, keyed by their audit log ID.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Command completed successfully. |
| `1` | Error — missing arguments, invalid input, unknown command, invalid/inactive key, or a service-level failure. |

## Error Format

All errors are printed to stderr in red text with the format:

```
Error: <message>
```

Unknown commands also print the full help text.

## Common Errors

| Error | Cause |
|---|---|
| `Missing required arguments.` | Required positional arguments not provided. |
| `ENCRYPTION_KEY is required` | The `ENCRYPTION_KEY` environment variable is not set. |
| `Key not found` | The provided UUID does not match any key in the database. |
| `Invalid grace period. Must be a non-negative number.` | The `grace-period-ms` argument is not a valid non-negative integer. |
| `Key is INVALID or inactive.` | The plaintext key does not match any active key (wrong key, expired, or revoked). |
| `Unknown command: <name>` | The command name is not recognized. |
