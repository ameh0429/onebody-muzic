import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async transaction => {
    await database.query(`
CREATE TABLE "NotificationPreference" (
  "userId" uuid PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
  rehearsals boolean NOT NULL DEFAULT true,
  reminders boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT false
);
CREATE TABLE "Notification" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "eventKey" text NOT NULL, kind text NOT NULL, title text NOT NULL, body text NOT NULL, href text NOT NULL,
  "adminOnly" boolean NOT NULL DEFAULT false,
  "rehearsalId" uuid REFERENCES "Rehearsal"(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "readAt" timestamptz,
  "pushAttempts" integer NOT NULL DEFAULT 0, "pushAfter" timestamptz NOT NULL DEFAULT now(), "pushDone" boolean NOT NULL DEFAULT false,
  UNIQUE ("userId", "eventKey")
);
CREATE INDEX "Notification_inbox_idx" ON "Notification" ("userId", "createdAt" DESC, id);
CREATE INDEX "Notification_push_idx" ON "Notification" ("pushAfter") WHERE NOT "pushDone";
CREATE TABLE "PushSubscription" (
  endpoint text PRIMARY KEY, "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  p256dh text NOT NULL, auth text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "PushSubscription_user_idx" ON "PushSubscription" ("userId");
-- Write notifications in the same transaction as the event. Rollbacks cannot leak alerts.
CREATE FUNCTION ob_notify_rehearsal(rid uuid, category text, label text, link text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r "Rehearsal"; published boolean;
BEGIN
  SELECT * INTO r FROM "Rehearsal" WHERE id=rid;
  SELECT "publicationStatus"='PUBLISHED' INTO published FROM "Playlist" WHERE id=r."playlistId";
  IF NOT coalesce(published,false) THEN RETURN; END IF;
  INSERT INTO "Notification" ("userId","eventKey",kind,title,body,href,"rehearsalId")
  SELECT u.id, category || ':' || rid, category, label, r.title,
    coalesce(link,'/rehearsals/' || rid), rid FROM "User" u
  LEFT JOIN "NotificationPreference" p ON p."userId"=u.id
  WHERE u.status='ACTIVE' AND coalesce(p.rehearsals,true)
  ON CONFLICT ("userId","eventKey") DO UPDATE SET title=excluded.title,body=excluded.body,href=excluded.href,
    "createdAt"=now(),"readAt"=NULL,"pushDone"=false,"pushAttempts"=0,"pushAfter"=now();
END $$;
CREATE FUNCTION ob_notification_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status='PENDING' THEN
      INSERT INTO "Notification" ("userId","eventKey",kind,title,body,href,"adminOnly")
      SELECT id,'registration:' || NEW.id,'registration','Member awaiting approval',NEW.name,'/admin',true
      FROM "User" WHERE role='ADMIN' AND status='ACTIVE';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO "Notification" ("userId","eventKey",kind,title,body,href)
    VALUES (NEW.id,'account:' || txid_current(),'account',
      CASE WHEN NEW.status='ACTIVE' AND OLD.status='PENDING' THEN 'Your account is approved' ELSE 'Account access updated' END,
      'Your account status is ' || lower(NEW.status::text) || ' and your role is ' || lower(NEW.role::text) || '.', '/profile')
    ON CONFLICT ("userId","eventKey") DO UPDATE SET title=excluded.title,body=excluded.body,"createdAt"=now(),"readAt"=NULL,"pushDone"=false,"pushAttempts"=0,"pushAfter"=now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ob_notification_user AFTER INSERT OR UPDATE OF status,role ON "User" FOR EACH ROW EXECUTE FUNCTION ob_notification_user();
CREATE FUNCTION ob_notification_rehearsal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM ob_notify_rehearsal(OLD.id,'rehearsal-cancelled','Rehearsal cancelled','/rehearsals');
    -- Existing links must remain useful after deletion.
    UPDATE "Notification" SET href='/rehearsals',"pushDone"=true WHERE "rehearsalId"=OLD.id AND kind<>'rehearsal-cancelled';
    RETURN OLD;
  ELSIF TG_OP='INSERT' THEN
    PERFORM ob_notify_rehearsal(NEW.id,'rehearsal-published','New rehearsal');
  ELSIF (NEW.title,NEW.description,NEW."scheduledAt",NEW."playlistId") IS DISTINCT FROM (OLD.title,OLD.description,OLD."scheduledAt",OLD."playlistId") THEN
    IF NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt" THEN
      UPDATE "Notification" SET "pushDone"=true,"readAt"=coalesce("readAt",now()) WHERE "rehearsalId"=NEW.id AND kind='reminder';
    END IF;
    PERFORM ob_notify_rehearsal(NEW.id,'rehearsal-updated','Rehearsal updated');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ob_notification_rehearsal AFTER INSERT OR UPDATE ON "Rehearsal" FOR EACH ROW EXECUTE FUNCTION ob_notification_rehearsal();
CREATE TRIGGER ob_notification_rehearsal_delete BEFORE DELETE ON "Rehearsal" FOR EACH ROW EXECUTE FUNCTION ob_notification_rehearsal();
CREATE FUNCTION ob_notification_playlist() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; rid uuid;
BEGIN
  IF TG_TABLE_NAME='Playlist' THEN
    IF (NEW.title,NEW.description,NEW."publicationStatus") IS NOT DISTINCT FROM (OLD.title,OLD.description,OLD."publicationStatus") THEN RETURN NEW; END IF;
    pid=NEW.id;
  ELSE
    IF TG_OP='DELETE' THEN pid=OLD."playlistId"; ELSE pid=NEW."playlistId"; END IF;
  END IF;
  FOR rid IN SELECT id FROM "Rehearsal" WHERE "playlistId"=pid AND "scheduledAt">now() LOOP
    PERFORM ob_notify_rehearsal(rid,'rehearsal-updated','Rehearsal or setlist updated');
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER ob_notification_playlist AFTER UPDATE ON "Playlist" FOR EACH ROW EXECUTE FUNCTION ob_notification_playlist();
CREATE TRIGGER ob_notification_setlist AFTER INSERT OR UPDATE OR DELETE ON "PlaylistSong" FOR EACH ROW EXECUTE FUNCTION ob_notification_playlist();
`, { transaction });
  });
}
export async function down(database: Sequelize): Promise<void> {
  await database.query(`DROP TRIGGER ob_notification_setlist ON "PlaylistSong"; DROP TRIGGER ob_notification_playlist ON "Playlist";
DROP TRIGGER ob_notification_rehearsal ON "Rehearsal"; DROP TRIGGER ob_notification_rehearsal_delete ON "Rehearsal";
DROP TRIGGER ob_notification_user ON "User"; DROP FUNCTION ob_notification_playlist(); DROP FUNCTION ob_notification_rehearsal();
DROP FUNCTION ob_notification_user(); DROP FUNCTION ob_notify_rehearsal(uuid,text,text,text);
DROP TABLE "PushSubscription", "Notification", "NotificationPreference";`);
}
