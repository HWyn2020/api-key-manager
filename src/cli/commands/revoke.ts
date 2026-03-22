import { CliDeps } from '../types';

const USAGE = `Usage: api-key-manager revoke <key-id> <reason>

Arguments:
  key-id    The ID of the key to revoke
  reason    Reason for revocation
`;

export async function revoke(args: string[], deps: CliDeps): Promise<void> {
  const keyId = args[0];
  const reason = args[1];

  if (!keyId || !reason) {
    console.error('\x1b[31mMissing required arguments.\x1b[0m');
    console.log(USAGE);
    process.exit(1);
  }

  const result = await deps.keyService.revokeKey(keyId, reason, 'cli');

  console.log('\x1b[32mKey revoked successfully.\x1b[0m');
  console.log('');
  console.log(JSON.stringify(result, null, 2));
}
