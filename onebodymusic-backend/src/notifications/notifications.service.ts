import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { NotificationPreferences, PushSubscriptionDto } from './notifications.dto';
import { UserResponseDto } from '../auth/dto/user-response.dto';

export interface InboxItem { id: string; kind: string; title: string; body: string; href: string; createdAt: Date; readAt: Date | null }
// Hide administrator alerts after demotion, and rehearsal alerts while their setlist is private.
export const VISIBLE_NOTIFICATION = `n."userId"=:userId AND (NOT n."adminOnly" OR :admin) AND
(n."rehearsalId" IS NULL OR EXISTS (SELECT 1 FROM "Rehearsal" r JOIN "Playlist" p ON p.id=r."playlistId" WHERE r.id=n."rehearsalId" AND p."publicationStatus"='PUBLISHED'))`;
@Injectable()
export class NotificationsService {
  constructor(@InjectConnection() readonly db: Sequelize, private readonly config: ConfigService) {}
  options() {
    const publicKey = this.config.get<string>('WEB_PUSH_PUBLIC_KEY');
    return { enabled: !!(publicKey && this.config.get('WEB_PUSH_PRIVATE_KEY') && this.config.get('WEB_PUSH_SUBJECT')), publicKey: publicKey || null };
  }
  async list(actor: UserResponseDto, page: number) {
    return this.db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async transaction => {
      const replacements = { userId: actor.id, admin: actor.role === 'ADMIN', offset: (page - 1) * 20 };
      const [counts] = await this.db.query<{ total: number; unreadCount: number }>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE n."readAt" IS NULL)::int AS "unreadCount" FROM "Notification" n WHERE ${VISIBLE_NOTIFICATION}`, { type: QueryTypes.SELECT, replacements, transaction });
      const data = await this.db.query<InboxItem>(`SELECT n.id,n.kind,n.title,n.body,n.href,n."createdAt",n."readAt" FROM "Notification" n WHERE ${VISIBLE_NOTIFICATION} ORDER BY n."createdAt" DESC,n.id DESC LIMIT 20 OFFSET :offset`, { type: QueryTypes.SELECT, replacements, transaction });
      return { data, ...counts!, page, totalPages: Math.ceil(counts!.total / 20) };
    });
  }
  async read(actor: UserResponseDto, id?: string) {
    const rows = await this.db.query<{ id: string }>(`UPDATE "Notification" n SET "readAt"=coalesce(n."readAt",now()),"pushDone"=true WHERE ${VISIBLE_NOTIFICATION} ${id ? 'AND n.id=:id' : ''} RETURNING n.id`, { type: QueryTypes.SELECT, replacements: { userId: actor.id, admin: actor.role === 'ADMIN', id } });
    if (id && !rows.length) throw new NotFoundException('Notification not found');
    return { updated: rows.length };
  }
  async preferences(userId: string): Promise<NotificationPreferences> {
    const rows = await this.db.query<NotificationPreferences>('SELECT rehearsals,reminders,push FROM "NotificationPreference" WHERE "userId"=:userId', { type: QueryTypes.SELECT, replacements: { userId } });
    return rows[0] ?? { rehearsals: true, reminders: true, push: false };
  }
  async savePreferences(userId: string, dto: NotificationPreferences) {
    if (dto.push && !this.options().enabled) throw new ServiceUnavailableException('Push notifications are not configured yet');
    await this.db.query(`INSERT INTO "NotificationPreference" ("userId",rehearsals,reminders,push) VALUES (:userId,:rehearsals,:reminders,:push)
      ON CONFLICT ("userId") DO UPDATE SET rehearsals=excluded.rehearsals,reminders=excluded.reminders,push=excluded.push`, { replacements: { userId, ...dto } });
    return dto;
  }
  async subscribe(userId: string, dto: PushSubscriptionDto) {
    if (!this.options().enabled) throw new ServiceUnavailableException('Push notifications are not configured yet');
    // Endpoint hosts are validated by DTO before any outgoing request. Never transfer another account's subscription.
    await this.db.transaction(async transaction => {
      await this.db.query('SELECT pg_advisory_xact_lock(hashtext(:userId))', { replacements: { userId }, transaction });
      const [count] = await this.db.query<{ count: number }>('SELECT count(*)::int AS count FROM "PushSubscription" WHERE "userId"=:userId AND endpoint<>:endpoint', { replacements: { userId, endpoint: dto.endpoint }, type: QueryTypes.SELECT, transaction });
      if (count!.count >= 10) throw new ConflictException('Disable notifications on an old device first');
      const rows = await this.db.query<{ endpoint: string }>(`INSERT INTO "PushSubscription" (endpoint,"userId",p256dh,auth) VALUES (:endpoint,:userId,:p256dh,:auth)
        ON CONFLICT (endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth WHERE "PushSubscription"."userId"=excluded."userId" RETURNING endpoint`, { replacements: { userId, ...dto }, transaction, type: QueryTypes.SELECT });
      if (!rows.length) throw new ConflictException('Subscription belongs to another account; disable and retry');
    });
    return { subscribed: true };
  }
  async unsubscribe(userId: string, endpoint: string) {
    await this.db.query('DELETE FROM "PushSubscription" WHERE "userId"=:userId AND endpoint=:endpoint', { replacements: { userId, endpoint } });
    return { subscribed: false };
  }
}
