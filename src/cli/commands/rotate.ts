import { CliDeps } from '../types';

const USAGE = `Usage: api-key-manager rotate <key-id> <reason> [grace-period-ms]

Arguments:
  key-id           The ID of the key to rotate
  reason           Reason for rotation
  grace-period-ms  Optional grace period in milliseconds for the old key
`;

export async function rotate(args: string[], deps: CliDeps): Promise<void> {
  const keyId = args[0];
  const reason = args[1];
  const gracePeriodMs = args[2] ? parseInt(args[2], 10) : undefined;

  if (!keyId || !reason) {
    console.error('\x1b[31mMissing required arguments.\x1b[0m');
    console.log(USAGE);
    process.exit(1);
  }

  if (args[2] !== undefined && (isNaN(gracePeriodMs!) || gracePeriodMs! < 0)) {
    console.error('\x1b[31mInvalid grace period. Must be a non-negative number.\x1b[0m');
    process.exit(1);
  }

  const result = await deps.keyService.rotateKey(keyId, reason, 'cli', gracePeriodMs);

  console.log('\x1b[32mKey rotated successfully.\x1b[0m');
  console.log('');
  console.log('\x1b[33m WARNING: Save the new key now. You will not be able to see it again!\x1b[0m');
  console.log('');
  console.log(`  New Plaintext Key:  ${result.plaintext}`);
  console.log('');
  console.log('\x1b[33m This key will NOT be shown again. Store it securely.\x1b[0m');
  console.log('');
  console.log('Old key:');
  console.log(JSON.stringify(result.oldKey, null, 2));
  console.log('');
  console.log('New key:');
  console.log(JSON.stringify(result.newKey, null, 2));
}
