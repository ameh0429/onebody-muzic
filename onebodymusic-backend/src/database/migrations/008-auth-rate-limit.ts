import { Sequelize } from 'sequelize-typescript';
export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`CREATE TABLE "AuthRateLimit" (
"key" VARCHAR(64) PRIMARY KEY,
"hits" INTEGER NOT NULL CHECK ("hits" > 0),
"expiresAt" TIMESTAMPTZ(3) NOT NULL
); CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit" ("expiresAt");`, { transaction });
  });
}
export async function down(database: Sequelize): Promise<void> { await database.query('DROP TABLE "AuthRateLimit"'); }
