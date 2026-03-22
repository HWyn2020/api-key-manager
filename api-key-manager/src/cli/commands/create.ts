import { CliDeps } from '../types';

const USAGE = `Usage: api-key-manager create <user-id> <name> [scopes...]

Arguments:
  user-id    The user ID to associate with the key
  name       A human-readable name for the key
  scopes     Optional space-separated list of scopes (e.g. read write admin)
`;

export async function create(args: string[], deps: CliDeps): Promise<void> {
  const userId = args[0];
  const keyName = args[1];
  const scopes = args.slice(2);

  if (!userId || !keyName) {
    console.error('\x1b[31mMissing required arguments.\x1b[0m');
    console.log(USAGE);
    process.exit(1);
  }

  const result = await deps.keyService.createKey(
    { userId, keyName, scopes: scopes.length > 0 ? scopes : ['read'] },
    'cli'
  );

  console.log('\x1b[32mAPI key created successfully.\x1b[0m');
  console.log('');
  console.log('\x1b[33m WARNING: Save this key now. You will not be able to see it again!\x1b[0m');
  console.log('');
  console.log(`  Plaintext Key:  ${result.plaintext}`);
  console.log('');
  console.log('\x1b[33m This key will NOT be shown again. Store it securely.\x1b[0m');
  console.log('');
  console.log('Key details:');
  console.log(JSON.stringify(result.key, null, 2));
}
