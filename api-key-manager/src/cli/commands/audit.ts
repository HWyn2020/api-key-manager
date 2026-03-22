import { CliDeps } from '../types';
import { AuditAction, AuditLogEntry } from '../../models/AuditLog';

const USAGE = `Usage: api-key-manager audit [options]

Options:
  --key-id=<id>        Filter by key ID
  --action=<action>    Filter by action (e.g. key.created, key.revoked)
  --actor-id=<id>      Filter by actor ID
  --limit=<n>          Maximum number of results (default: 50)
`;

function parseFlags(args: string[]): {
  keyId?: string;
  action?: AuditAction;
  actorId?: string;
  limit?: number;
} {
  const flags: {
    keyId?: string;
    action?: AuditAction;
    actorId?: string;
    limit?: number;
  } = {};

  for (const arg of args) {
    if (arg.startsWith('--key-id=')) {
      flags.keyId = arg.split('=')[1];
    } else if (arg.startsWith('--action=')) {
      flags.action = arg.split('=')[1] as AuditAction;
    } else if (arg.startsWith('--actor-id=')) {
      flags.actorId = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      flags.limit = parseInt(arg.split('=')[1], 10);
    }
  }

  return flags;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function printTable(entries: AuditLogEntry[]): void {
  if (entries.length === 0) {
    console.log('No audit log entries found.');
    return;
  }

  const headers = ['ID', 'KEY ID', 'ACTION', 'ACTOR', 'IP', 'CREATED AT'];
  const widths = [6, 38, 18, 14, 16, 22];

  const headerLine = headers.map((h, i) => padRight(h, widths[i])).join('  ');
  const separator = widths.map(w => '-'.repeat(w)).join('  ');

  console.log(headerLine);
  console.log(separator);

  for (const entry of entries) {
    const row = [
      String(entry.id),
      entry.keyId ?? '-',
      entry.action,
      entry.actorId,
      entry.ipAddress ?? '-',
      entry.createdAt,
    ];
    console.log(row.map((val, i) => padRight(val, widths[i])).join('  '));
  }

  console.log('');
  console.log(`Total: ${entries.length} entry(ies)`);

  // Print metadata for each entry if present
  const withMeta = entries.filter(e => e.metadata !== null);
  if (withMeta.length > 0) {
    console.log('');
    console.log('Metadata:');
    for (const entry of withMeta) {
      console.log(`  [${entry.id}] ${JSON.stringify(entry.metadata)}`);
    }
  }
}

export async function audit(args: string[], deps: CliDeps): Promise<void> {
  const flags = parseFlags(args);

  const entries = deps.auditService.query({
    keyId: flags.keyId,
    action: flags.action,
    actorId: flags.actorId,
    limit: flags.limit ?? 50,
  });

  printTable(entries);
}
