import 'reflect-metadata';
import 'dotenv/config';
import { createDatabase } from './connection';
import { seedAdministrator } from './seed-admin';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for seeding.');
  const database = createDatabase(url);
  try {
    await database.authenticate();
    const result = await seedAdministrator(database, process.env);
    console.log(`Administrator seed: ${result}.`);
  } finally {
    await database.close();
  }
}

void main().catch(() => {
  // Driver errors may include connection or query details. Keep CLI output credential-free.
  console.error('Administrator seed failed. Check database access and ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD (16–128 characters). Existing accounts are never promoted or reset.');
  process.exitCode = 1;
});
