import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryTypes } from 'sequelize';
import nodemailer, { Transporter } from 'nodemailer';
import { NotificationsService } from './notifications.service';

interface PendingEmail {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  scheduledAt: Date | null;
  attempts: number;
  email: string;
  eligible: boolean;
}

@Injectable()
export class EmailNotificationsWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EmailNotificationsWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private transport?: Transporter;

  constructor(private readonly notifications: NotificationsService, private readonly config: ConfigService) {}

  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('EMAIL_ENABLED') !== 'true') return;
    this.transport = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.getOrThrow<number>('SMTP_PORT'),
      secure: this.config.get('SMTP_SECURE') === 'true',
      requireTLS: this.config.get('SMTP_SECURE') !== 'true',
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_APP_PASSWORD').replace(/\s/g, ''),
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
    const run = () => {
      if (this.running) return;
      this.running = this.tick().catch(() => {
        this.logger.warn('Email notification worker failed. Check database connectivity and migration 013-email-notifications.');
      }).finally(() => { this.running = undefined; });
    };
    run();
    this.timer = setInterval(run, 60000);
    this.timer.unref();
  }

  async beforeApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
    this.transport?.close();
  }

  async tick() {
    const transport = this.transport;
    if (!transport) return;
    const db = this.notifications.db;
    const startAt = this.config.getOrThrow<string>('EMAIL_START_AT');

    await db.query(`INSERT INTO "EmailNotification" ("userId","eventKey",kind,title,body,href,"rehearsalId","scheduledAt")
      SELECT u.id,'reminder:' || r.id || ':' || extract(epoch from r."scheduledAt"),'reminder',
        'Rehearsal coming up',r.title,'/rehearsals/' || r.id,r.id,r."scheduledAt"
      FROM "Rehearsal" r JOIN "Playlist" pl ON pl.id=r."playlistId"
      CROSS JOIN "NotificationPreference" p JOIN "User" u ON u.id=p."userId"
      WHERE r."scheduledAt">now() AND r."scheduledAt"<=now()+interval '24 hours'
        AND now()>=:startAt AND pl."publicationStatus"='PUBLISHED'
        AND u.status='ACTIVE' AND p."emailReminders"
      ON CONFLICT ("userId","eventKey") DO NOTHING`, { replacements: { startAt } });

    for (let i = 0; i < this.config.getOrThrow<number>('EMAIL_BATCH_SIZE'); i++) {
      const processed = await db.transaction(async transaction => {
        const [row] = await db.query<PendingEmail>(`SELECT e.*, u.email,
          (
            e.kind='account' OR (u.status='ACTIVE' AND (
              (e.kind='registration' AND u.role='ADMIN') OR
              (e.kind='rehearsal-cancelled' AND coalesce(p."emailRehearsals",false)) OR
              (e.kind='reminder' AND coalesce(p."emailReminders",false)
                AND pl."publicationStatus"='PUBLISHED' AND r."scheduledAt"=e."scheduledAt" AND r."scheduledAt">now()) OR
              (e.kind IN ('rehearsal-published','rehearsal-updated') AND coalesce(p."emailRehearsals",false)
                AND pl."publicationStatus"='PUBLISHED')
            ))
          ) AS eligible
          FROM "EmailNotification" e JOIN "User" u ON u.id=e."userId"
          LEFT JOIN "NotificationPreference" p ON p."userId"=u.id
          LEFT JOIN "Rehearsal" r ON r.id=e."rehearsalId" LEFT JOIN "Playlist" pl ON pl.id=r."playlistId"
          WHERE e.state='pending' AND e."sendAfter"<=now()
            AND e."createdAt">=:startAt AND e."createdAt">now()-interval '1 day'
          ORDER BY e."sendAfter", e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED`,
        { type: QueryTypes.SELECT, transaction, replacements: { startAt } });
        if (!row) return false;

        let state = 'skipped';
        if (row.eligible) {
          try {
            const origin = this.config.getOrThrow<string>('APP_PUBLIC_URL');
            const href = row.title === 'Your account is approved' ? '/login' : row.href;
            const date = row.scheduledAt ? new Intl.DateTimeFormat('en', {
              dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC',
            }).format(row.scheduledAt) + ' UTC' : '';
            await transport.sendMail({
              from: this.config.getOrThrow<string>('EMAIL_FROM'),
              to: { name: '', address: row.email },
              subject: `OnebodyMusic | ${row.title}`,
              text: [row.body, date, new URL(href, origin).href].filter(Boolean).join('\n\n'),
              messageId: `<${row.id}@${new URL(origin).hostname}>`,
            });
            state = 'sent';
          } catch (error) {
            const { responseCode, code } = error as { responseCode?: number; code?: string };
            const permanent = (responseCode ?? 0) >= 500 || code === 'EAUTH';
            state = permanent || row.attempts >= 2 ? 'failed' : 'pending';
            if (state === 'failed') this.logger.warn('Email delivery failed. Check Gmail credentials, sender limits and outbound SMTP access.');
          }
        }
        await db.query(`UPDATE "EmailNotification" SET state=:state, attempts=attempts+1,
          "sendAfter"=now()+interval '5 minutes' WHERE id=:id`,
        { transaction, replacements: { state, id: row.id } });
        return true;
      });
      if (!processed) break;
    }
  }
}
