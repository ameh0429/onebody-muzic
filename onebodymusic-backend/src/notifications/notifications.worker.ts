import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryTypes } from 'sequelize';
import webpush from 'web-push';
import { NotificationsService } from './notifications.service';
@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(NotificationsWorker.name);
  constructor(private readonly notifications: NotificationsService, private readonly config: ConfigService) {}
  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV') === 'test') return;
    const run = () => {
      if (this.running) return;
      this.running = this.tick().catch(() => this.logger.warn('Notification delivery failed; will retry')).finally(() => { this.running = undefined; });
    };
    run(); this.timer = setInterval(run, 60000); this.timer.unref();
  }
  async beforeApplicationShutdown() { if (this.timer) clearInterval(this.timer); await this.running; }
  async tick() {
    const db = this.notifications.db;
    // Each schedule gets one reminder per recipient, even with multiple API instances or restarts.
    await db.query(`INSERT INTO "Notification" ("userId","eventKey",kind,title,body,href,"rehearsalId")
      SELECT u.id,'reminder:' || r.id || ':' || extract(epoch from r."scheduledAt"),'reminder','Rehearsal coming up',r.title,'/rehearsals/' || r.id,r.id
      FROM "Rehearsal" r JOIN "Playlist" pl ON pl.id=r."playlistId" CROSS JOIN "User" u
      LEFT JOIN "NotificationPreference" p ON p."userId"=u.id
      WHERE r."scheduledAt">now() AND r."scheduledAt"<=now()+interval '24 hours' AND pl."publicationStatus"='PUBLISHED'
        AND u.status='ACTIVE' AND coalesce(p.reminders,true) ON CONFLICT ("userId","eventKey") DO NOTHING`);
    // Bound retention and do not send alerts that were queued before this device opted in.
    await db.query(`DELETE FROM "Notification" WHERE "createdAt"<now()-interval '90 days'`);
    if (!this.notifications.options().enabled) return;
    // Each worker holds one row lock while sending; separate connections keep API reads responsive.
    for (let batch = 0; batch < 20; batch++) {
      const processed = await Promise.all(Array.from({ length: 5 }, () => db.transaction(async transaction => {
        const rows = await db.query<{ id: string; userId: string; kind: string; adminOnly: boolean; rehearsalId: string | null; pushAttempts: number; createdAt: Date }>(`SELECT n.* FROM "Notification" n
          WHERE NOT n."pushDone" AND n."pushAfter"<=now() ORDER BY n."createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`, { type: QueryTypes.SELECT, transaction });
        const row = rows[0];
        if (!row) return 0;
        const recipients = await db.query<{ endpoint: string; p256dh: string; auth: string }>(`SELECT s.endpoint,s.p256dh,s.auth FROM "PushSubscription" s JOIN "User" u ON u.id=s."userId"
          JOIN "NotificationPreference" p ON p."userId"=u.id WHERE u.id=:userId AND u.status='ACTIVE' AND p.push
          AND s."createdAt" <= :createdAt AND (NOT :adminOnly OR u.role='ADMIN')
          AND (:kind NOT LIKE 'rehearsal-%' OR p.rehearsals) AND (:kind <> 'reminder' OR p.reminders)
          AND (:rehearsalId IS NULL OR EXISTS (SELECT 1 FROM "Rehearsal" r JOIN "Playlist" pl ON pl.id=r."playlistId" WHERE r.id=:rehearsalId AND pl."publicationStatus"='PUBLISHED' AND (:kind <> 'reminder' OR r."scheduledAt">now())))`,
          { type: QueryTypes.SELECT, transaction, replacements: { ...row } });
        const outcomes = await Promise.all(recipients.map(async s => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: 'OnebodyMusic', body: 'You have a new notification. Open the app to view it.', url: '/notifications', tag: row.id }),
              { TTL: 3600, timeout: 5000, vapidDetails: { subject: this.config.getOrThrow<string>('WEB_PUSH_SUBJECT'), publicKey: this.config.getOrThrow<string>('WEB_PUSH_PUBLIC_KEY'), privateKey: this.config.getOrThrow<string>('WEB_PUSH_PRIVATE_KEY') } });
            return { endpoint: s.endpoint, expired: false, retry: false };
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            const expired = status === 404 || status === 410;
            return { endpoint: s.endpoint, expired, retry: !expired };
          }
        }));
        // Serialize SQL on each transaction connection, including expired-device cleanup.
        for (const outcome of outcomes) if (outcome.expired) {
          await db.query('DELETE FROM "PushSubscription" WHERE endpoint=:endpoint', { replacements: { endpoint: outcome.endpoint }, transaction });
        }
        await db.query(`UPDATE "Notification" SET "pushAttempts"="pushAttempts"+1,"pushAfter"=now()+interval '5 minutes',"pushDone"=:done WHERE id=:id`,
          { transaction, replacements: { id: row.id, done: !outcomes.some(o => o.retry) || row.pushAttempts >= 2 } });
        return 1;
      })));
      if (processed.filter(Boolean).length < 5) break;
    }
  }
}
