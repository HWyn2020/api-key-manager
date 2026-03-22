import { CliDeps } from '../types';
import { RotationRecord } from '../../models/RotationHistory';

const USAGE = `Usage: api-key-manager history <key-id>

Arguments:
  key-id    The ID of the key to show rotation history for
`;

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function printTable(records: RotationRecord[]): void {
  if (records.length === 0) {
    console.log('No rotation history found.');
    return;
  }

  const headers = ['ID', 'OLD KEY ID', 'NEW KEY ID', 'REASON', 'ROTATED BY', 'VALID UNTIL', 'ROTATED AT'];
  const widths = [6, 38, 38, 24, 14, 22, 22];

  const headerLine = headers.map((h, i) => padRight(h, widths[i])).join('  ');
  const separator = widths.map(w => '-'.repeat(w)).join('  ');

  console.log(headerLine);
  console.log(separator);

  for (const rec of records) {
    const row = [
      String(rec.id),
      rec.oldKeyId,
      rec.newKeyId,
      rec.reason,
      rec.rotatedBy,
      rec.oldKeyValidUntil,
      rec.rotatedAt,
    ];
    console.log(row.map((val, i) => padRight(val, widths[i])).join('  '));
  }

  console.log('');
  console.log(`Total: ${records.length} record(s)`);
}

export async function history(args: string[], deps: CliDeps): Promise<void> {
  const keyId = args[0];

  if (!keyId) {
    console.error('\x1b[31mMissing required argument: key-id\x1b[0m');
    console.log(USAGE);
    process.exit(1);
  }

  const records = deps.rotationRepo.findByKeyId(keyId);
  printTable(records);
}
