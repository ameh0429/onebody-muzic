import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async transaction => {
    // Retain the existing queue and preferences for rollback.
    await database.query(`
DROP TRIGGER ob_queue_account_email ON "Notification";
DROP TRIGGER ob_notification_playlist ON "Playlist";
CREATE TRIGGER ob_notification_playlist AFTER UPDATE ON "Playlist"
  FOR EACH ROW EXECUTE FUNCTION ob_notification_playlist();

CREATE OR REPLACE FUNCTION ob_notify_rehearsal(rid uuid, category text, label text, link text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ob_notify_rehearsal_inbox(rid, category, label, link);
END $$;
`, { transaction });
  });
}

export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async transaction => {
    await database.query(`
CREATE TRIGGER ob_queue_account_email AFTER INSERT OR UPDATE OF title, body ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION ob_queue_account_email();

DROP TRIGGER ob_notification_playlist ON "Playlist";
CREATE TRIGGER ob_notification_playlist AFTER UPDATE ON "Playlist"
  FOR EACH ROW EXECUTE FUNCTION ob_notify_playlist_publication();

CREATE OR REPLACE FUNCTION ob_notify_rehearsal(rid uuid, category text, label text, link text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ob_notify_rehearsal_inbox(rid, category, label, link);
  PERFORM ob_queue_rehearsal_email(rid, category, label, link);
END $$;
`, { transaction });
  });
}
