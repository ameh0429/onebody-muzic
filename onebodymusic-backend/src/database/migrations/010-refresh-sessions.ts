import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';

export async function installSessionRevocation(database: Sequelize, transaction?: Transaction): Promise<void> {
  await database.query(`CREATE FUNCTION revoke_inactive_user_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.status <> 'ACTIVE' THEN
      UPDATE \"AuthSession\" SET \"revokedAt\"=CURRENT_TIMESTAMP WHERE \"userId\"=NEW.id AND \"revokedAt\" IS NULL;
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER \"User_revoke_sessions\" AFTER UPDATE OF status ON \"User\" FOR EACH ROW EXECUTE FUNCTION revoke_inactive_user_sessions();`, { transaction });
}
export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`CREATE TABLE "AuthSession" (
      id UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      "expiresAt" TIMESTAMPTZ NOT NULL, "revokedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "AuthSession_userId_idx" ON "AuthSession" ("userId");
    CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession" ("expiresAt");
    CREATE TABLE "RefreshToken" (
      hash CHAR(64) PRIMARY KEY, "sessionId" UUID NOT NULL REFERENCES "AuthSession"(id) ON DELETE CASCADE,
      "consumedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken" ("sessionId");`, { transaction });
    await installSessionRevocation(database, transaction);
  });
}
export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => { await database.query('DROP TRIGGER "User_revoke_sessions" ON "User"; DROP FUNCTION revoke_inactive_user_sessions(); DROP TABLE "RefreshToken"; DROP TABLE "AuthSession";', { transaction }); });
}
