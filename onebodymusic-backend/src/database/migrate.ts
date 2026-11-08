import 'reflect-metadata';
import 'dotenv/config';
import { createDatabase } from './connection';
import { createMigrator } from './migrator';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const command = process.argv[2];
  if (!['up', 'down', 'status'].includes(command ?? '')) throw new Error('Expected up, down, or status.');
  const database = createDatabase(url);
  try {
    await database.authenticate();
    // Serialize migration runners on this database, including separate CLI processes.
    await database.transaction(async (transaction) => {
      await database.query('SELECT pg_advisory_xact_lock(172932, 1)', { transaction });
      const migrator = createMigrator(database);
      if (command === 'up') console.log(`Applied ${(await migrator.up()).length} migration(s).`);
      else if (command === 'down') console.log(`Reverted ${(await migrator.down()).length} migration(s).`);
      else console.log({ applied: (await migrator.executed()).map((m) => m.name), pending: (await migrator.pending()).map((m) => m.name) });
    });
  } finally {
    await database.close();
  }
}

void main().catch(() => {
  console.error('Database migration command failed. Check DATABASE_URL, database permissions, and migration state. Never reset a production database to resolve a migration conflict.');
  process.exitCode = 1;
});
