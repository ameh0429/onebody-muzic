import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
export interface RateLimitResult { hits: number; retryAfter: number }
@Injectable()
export class AuthRateLimitStore {
  private nextCleanupAt = 0;
  constructor(@InjectConnection() private readonly database: Sequelize) {}
  async consume(key: string, windowSeconds: number, limit: number): Promise<RateLimitResult> {
    // Atomic upsert shares counters across instances. Expiry uses the database clock.
    const rows = await this.database.query<RateLimitResult>(`
INSERT INTO "AuthRateLimit" ("key", "hits", "expiresAt")
VALUES (:key, 1, clock_timestamp() + :windowSeconds * INTERVAL '1 second')
ON CONFLICT ("key") DO UPDATE SET
  "hits" = CASE WHEN "AuthRateLimit"."expiresAt" <= clock_timestamp() THEN 1 ELSE LEAST("AuthRateLimit"."hits" + 1, :limit + 1) END,
  "expiresAt" = CASE WHEN "AuthRateLimit"."expiresAt" <= clock_timestamp() THEN clock_timestamp() + :windowSeconds * INTERVAL '1 second' ELSE "AuthRateLimit"."expiresAt" END
RETURNING "hits", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp()))))::integer AS "retryAfter"`, { replacements: { key, windowSeconds, limit }, type: QueryTypes.SELECT });
    if (!rows[0]) throw new Error('Rate limit counter unavailable');
    if (Date.now() >= this.nextCleanupAt) {
      this.nextCleanupAt = Date.now() + 60000;
      // Bounded cleanup skips busy counters and never holds an authentication request's row lock.
      await this.database.query(`DELETE FROM "AuthRateLimit" WHERE "key" IN (SELECT "key" FROM "AuthRateLimit" WHERE "expiresAt" < clock_timestamp() ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    }
    return rows[0];
  }
}
