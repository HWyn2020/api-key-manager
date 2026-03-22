import { CliDeps } from '../types';

const USAGE = `Usage: api-key-manager validate <key>

Arguments:
  key    The plaintext API key to validate
`;

export async function validate(args: string[], deps: CliDeps): Promise<void> {
  const plaintextKey = args[0];

  if (!plaintextKey) {
    console.error('\x1b[31mMissing required argument: key\x1b[0m');
    console.log(USAGE);
    process.exit(1);
  }

  const entity = await deps.keyService.validateKey(plaintextKey);

  if (!entity) {
    console.log('\x1b[31mKey is INVALID or inactive.\x1b[0m');
    process.exit(1);
  }

  console.log('\x1b[32mKey is VALID.\x1b[0m');
  console.log('');
  console.log(`  Key ID:      ${entity.id}`);
  console.log(`  User ID:     ${entity.userId}`);
  console.log(`  Name:        ${entity.keyName}`);
  console.log(`  Status:      ${entity.status}`);
  console.log(`  Scopes:      ${entity.scopes.join(', ')}`);
  console.log(`  Created:     ${entity.createdAt}`);
  console.log(`  Last Used:   ${entity.lastUsedAt ?? 'never'}`);
  console.log(`  Expires:     ${entity.expiresAt ?? 'never'}`);
}
