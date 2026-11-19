import { Sequelize } from 'sequelize-typescript';

export async function up(db: Sequelize): Promise<void> {
  await db.transaction(async transaction => {
    await db.query(`
      CREATE TABLE "ApprovalEmail" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0,
        "finishedAt" timestamptz
      );
      CREATE INDEX approval_email_pending ON "ApprovalEmail" ("nextAttemptAt") WHERE "finishedAt" IS NULL;
      CREATE FUNCTION ob_queue_approval_email() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO "ApprovalEmail" ("userId") VALUES (NEW.id);
        RETURN NEW;
      END $$;
      CREATE TRIGGER ob_queue_approval_email AFTER UPDATE OF status ON "User"
        FOR EACH ROW WHEN (OLD.status = 'PENDING' AND NEW.status = 'ACTIVE')
        EXECUTE FUNCTION ob_queue_approval_email();
    `, { transaction });
  });
}

export async function down(db: Sequelize): Promise<void> {
  await db.transaction(async transaction => {
    await db.query(`
      DROP TRIGGER ob_queue_approval_email ON "User";
      DROP FUNCTION ob_queue_approval_email();
      DROP TABLE "ApprovalEmail";
    `, { transaction });
  });
}
