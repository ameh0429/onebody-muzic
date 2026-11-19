import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import nodemailer from 'nodemailer';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EnvironmentVariables } from '../config/environment';

@Injectable()
export class ApprovalEmailWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(ApprovalEmailWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('APPROVAL_EMAIL_ENABLED') !== 'true') return;

    const run = () => {
      if (this.running) return;
      this.running = this.tick()
        .catch(() => this.logger.warn('Approval email queue check failed. Retrying in one minute.'))
        .finally(() => { this.running = undefined; });
    };
    run();
    this.timer = setInterval(run, 60_000);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async tick(): Promise<void> {
    const sender = this.config.getOrThrow('GMAIL_SMTP_USER', { infer: true });
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: sender, pass: this.config.getOrThrow('GMAIL_SMTP_APP_PASSWORD', { infer: true }).replace(/\s/g, '') },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
      dnsTimeout: 5_000,
    });
    const loginUrl = new URL('/login', this.config.getOrThrow('APP_FRONTEND_ORIGIN', { infer: true })).href;

    await this.db.query(`
      DELETE FROM "ApprovalEmail" WHERE "createdAt" < now() - interval '7 days'
    `);

    for (let count = 0; count < 5; count++) {
      const processed = await this.db.transaction(async transaction => {
        const [job] = await this.db.query<{ id: string; email: string; status: string; attempts: number }>(`
          SELECT q.id, q.attempts, u.email, u.status FROM "ApprovalEmail" q
          JOIN "User" u ON u.id = q."userId"
          WHERE q."finishedAt" IS NULL AND q."nextAttemptAt" <= now()
          ORDER BY q."nextAttemptAt", q.id LIMIT 1 FOR UPDATE OF q SKIP LOCKED
        `, { type: QueryTypes.SELECT, transaction });
        if (!job) return false;

        let finished = true;
        if (job.status === 'ACTIVE') {
          try {
            await transport.sendMail({
              from: { name: 'OnebodyMusic', address: sender },
              to: { name: '', address: job.email },
              subject: 'Your OnebodyMusic account is approved',
              text: `Your OnebodyMusic account has been approved. Sign in with your existing password:\n\n${loginUrl}`,
            });
          } catch {
            finished = job.attempts >= 2;
            this.logger.warn(finished ? 'Approval email delivery failed after three attempts.' : 'Approval email delivery failed. Retrying in five minutes.');
          }
        }

        await this.db.query(`
          UPDATE "ApprovalEmail"
          SET attempts = attempts + 1, "nextAttemptAt" = now() + interval '5 minutes',
              "finishedAt" = CASE WHEN :finished THEN now() ELSE NULL END
          WHERE id = :id
        `, { transaction, replacements: { id: job.id, finished } });
        return true;
      });
      if (!processed) break;
    }
  }
}
