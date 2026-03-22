#!/usr/bin/env node

import { loadConfig } from '../config';
import { initializeDatabase } from '../database';
import { createKeyService } from '../services/keyService';
import { createAuditService } from '../services/auditService';
import { CliDeps } from './types';
import { create } from './commands/create';
import { validate } from './commands/validate';
import { rotate } from './commands/rotate';
import { revoke } from './commands/revoke';
import { list } from './commands/list';
import { history } from './commands/history';
import { audit } from './commands/audit';

export type { CliDeps } from './types';

const HELP = `
api-key-manager CLI

Usage: api-key-manager <command> [args...]

Commands:
  create <user-id> <name> [scopes...]       Create a new API key
  validate <key>                             Validate an API key
  rotate <key-id> <reason> [grace-ms]        Rotate an API key
  revoke <key-id> <reason>                   Revoke an API key
  list <user-id> [--status=active] [--limit=50]
                                             List keys for a user
  history <key-id>                           Show rotation history
  audit [--key-id=...] [--action=...] [--actor-id=...] [--limit=50]
                                             Query audit log
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  const config = loadConfig();
  const { db, repos } = initializeDatabase(config.database);

  const keyService = createKeyService({
    keyRepo: repos.keys,
    rotationRepo: repos.rotations,
    auditRepo: repos.audit,
    encryptionKey: config.encryptionKey,
    db,
  });

  const auditService = createAuditService(repos.audit);

  const deps: CliDeps = {
    keyService,
    auditService,
    rotationRepo: repos.rotations,
  };

  try {
    switch (command) {
      case 'create':
        await create(commandArgs, deps);
        break;
      case 'validate':
        await validate(commandArgs, deps);
        break;
      case 'rotate':
        await rotate(commandArgs, deps);
        break;
      case 'revoke':
        await revoke(commandArgs, deps);
        break;
      case 'list':
        await list(commandArgs, deps);
        break;
      case 'history':
        await history(commandArgs, deps);
        break;
      case 'audit':
        await audit(commandArgs, deps);
        break;
      default:
        console.error(`\x1b[31mUnknown command: ${command}\x1b[0m`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31mError: ${message}\x1b[0m`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
