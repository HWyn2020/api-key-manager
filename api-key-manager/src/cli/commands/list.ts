import { CliDeps } from '../types';
import { KeyResponse } from '../../models/Key';

const USAGE = `Usage: api-key-manager list <user-id> [--status=active] [--limit=50]

Arguments:
  user-id              The user ID to list keys for

Options:
  --status=<status>    Filter by status (active, expired, revoked, rotating)
  --limit=<n>          Maximum number of results (default: 50)
`;

function parseFlags(args: string[]): { status?: string; limit?: number } {
  const flags: { status?: string; limit?: number } = {};
  for (const arg of args) {
    if (arg.startsWith('--status=')) {
      flags.status = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      flags.limit = parseInt(arg.split('=')[1], 10);
    }
  }
  return flags;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function printTable(keys: KeyResponse[]): void {
  if (keys.length === 0) {
    console.log('No keys found.');
    return;
  }

  const headers = ['KEY ID', 'NAME', 'STATUS', 'SCOPES', 'CREATED', 'EXPIRES'];
  const widths = [38, 20, 10, 24, 22, 22];

  const headerLine = headers.map((h, i) => padRight(h, widths[i])).join('  ');
  const separator = widths.map(w => '-'.repeat(w)).join('  ');

  console.log(headerLine);
  console.log(separator);

  for (const key of keys) {
    const row = [
      key.keyId,
      key.keyName,
      key.status,
      key.scopes.join(', '),
      key.createdAt,
      key.expiresAt ?? 'never',
    ];
    console.log(row.map((val, i) => padRight(val, widths[i])).join('  '));
  }

  console.log('');
  console.log(`Total: ${keys.length} key(s)`);
}

export async function list(args: string[], deps: CliDeps): Promise<void> {
  const userId = args[0];

  if (!userId || userId.startsWith('--')) {
    console.error('\x1b[31mMissing required argument: user-id\x1b[0m');
    console.log(USAGE);
    process.exit(1);
  }

  const flags = parseFlags(args.slice(1));
  const keys = await deps.keyService.listKeys(userId, {
    status: flags.status,
    limit: flags.limit ?? 50,
  });

  printTable(keys);
}
