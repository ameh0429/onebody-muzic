import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async transaction => {
    await database.query(`
ALTER TABLE "NotificationPreference"
  ADD COLUMN "emailRehearsals" boolean NOT NULL DEFAULT false,
  ADD COLUMN "emailReminders" boolean NOT NULL DEFAULT false;

CREATE TABLE "EmailNotification" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "eventKey" text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  href text NOT NULL,
  "rehearsalId" uuid,
  "scheduledAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "sendAfter" timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'skipped', 'failed')),
  UNIQUE ("userId", "eventKey")
);
CREATE INDEX "EmailNotification_pending_idx" ON "EmailNotification" ("sendAfter") WHERE state='pending';

-- Account notifications already carry the recipient and event identity.
CREATE FUNCTION ob_queue_account_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('registration', 'account') THEN
    INSERT INTO "EmailNotification" ("userId", "eventKey", kind, title, body, href)
    VALUES (NEW."userId", NEW."eventKey", NEW.kind, NEW.title, NEW.body, NEW.href)
    ON CONFLICT ("userId", "eventKey") DO UPDATE SET title=excluded.title, body=excluded.body;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ob_queue_account_email AFTER INSERT OR UPDATE OF title, body ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION ob_queue_account_email();

-- Keep email opt-in independent of inbox preferences, and reuse the existing event triggers.
ALTER FUNCTION ob_notify_rehearsal(uuid, text, text, text) RENAME TO ob_notify_rehearsal_inbox;
CREATE FUNCTION ob_queue_rehearsal_email(rid uuid, category text, label text, link text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "EmailNotification" ("userId", "eventKey", kind, title, body, href, "rehearsalId", "scheduledAt", "sendAfter")
  SELECT u.id, category || ':' || rid, category, label, r.title, coalesce(link, '/rehearsals/' || rid), rid,
    r."scheduledAt", CASE WHEN category='rehearsal-updated' THEN now()+interval '5 minutes' ELSE now() END
  FROM "Rehearsal" r JOIN "Playlist" pl ON pl.id=r."playlistId"
  CROSS JOIN "NotificationPreference" p JOIN "User" u ON u.id=p."userId"
  WHERE r.id=rid AND pl."publicationStatus"='PUBLISHED' AND u.status='ACTIVE' AND p."emailRehearsals"
  ON CONFLICT ("userId", "eventKey") DO UPDATE SET title=excluded.title, body=excluded.body,
    "scheduledAt"=excluded."scheduledAt", "sendAfter"=excluded."sendAfter", "createdAt"=now(), attempts=0, state='pending'
    WHERE category='rehearsal-updated' OR "EmailNotification".state<>'sent';
END $$;
CREATE FUNCTION ob_notify_rehearsal(rid uuid, category text, label text, link text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ob_notify_rehearsal_inbox(rid, category, label, link);
  PERFORM ob_queue_rehearsal_email(rid, category, label, link);
END $$;

-- Publishing a draft setlist is a new rehearsal announcement by email.
CREATE FUNCTION ob_notify_playlist_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
  IF (NEW.title,NEW.description,NEW."publicationStatus") IS NOT DISTINCT FROM
     (OLD.title,OLD.description,OLD."publicationStatus") THEN RETURN NEW; END IF;
  FOR rid IN SELECT id FROM "Rehearsal" WHERE "playlistId"=NEW.id AND "scheduledAt">now() LOOP
    IF NEW."publicationStatus"='PUBLISHED' AND OLD."publicationStatus"<>'PUBLISHED' THEN
      PERFORM ob_notify_rehearsal_inbox(rid,'rehearsal-updated','Rehearsal or setlist updated');
      PERFORM ob_queue_rehearsal_email(rid,'rehearsal-published','New rehearsal');
    ELSE
      PERFORM ob_notify_rehearsal(rid,'rehearsal-updated','Rehearsal or setlist updated');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER ob_notification_playlist ON "Playlist";
CREATE TRIGGER ob_notification_playlist AFTER UPDATE ON "Playlist"
  FOR EACH ROW EXECUTE FUNCTION ob_notify_playlist_publication();
`, { transaction });
  });
}

export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async transaction => {
    await database.query(`
DROP TRIGGER ob_notification_playlist ON "Playlist";
CREATE TRIGGER ob_notification_playlist AFTER UPDATE ON "Playlist"
  FOR EACH ROW EXECUTE FUNCTION ob_notification_playlist();
DROP FUNCTION ob_notify_playlist_publication();
DROP FUNCTION ob_notify_rehearsal(uuid, text, text, text);
DROP FUNCTION ob_queue_rehearsal_email(uuid, text, text, text);
ALTER FUNCTION ob_notify_rehearsal_inbox(uuid, text, text, text) RENAME TO ob_notify_rehearsal;
DROP TRIGGER ob_queue_account_email ON "Notification";
DROP FUNCTION ob_queue_account_email();
DROP TABLE "EmailNotification";
ALTER TABLE "NotificationPreference" DROP COLUMN "emailRehearsals", DROP COLUMN "emailReminders";
`, { transaction });
  });
}
