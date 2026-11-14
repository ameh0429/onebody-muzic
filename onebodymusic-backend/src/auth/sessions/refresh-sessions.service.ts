import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthService } from '../auth.service';
import { LoginResponseDto } from '../dto/login-response.dto';
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const SESSION_LIFETIME_MS = 14 * 86400000;
@Injectable()
export class RefreshSessionsService {
  constructor(private readonly modules: ModuleRef, private readonly auth: AuthService) {}
  // Resolve the shared connection only when a session operation needs it.
  private get database(): Sequelize { return this.modules.get(Sequelize, { strict: false }); }
  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(48).toString('base64url'); const id = randomUUID(); const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.database.transaction(async (transaction) => {
      const [user] = await this.database.query<{ status: string }>('SELECT status FROM \"User\" WHERE id=:id FOR SHARE', { transaction, replacements: { id: userId }, type: QueryTypes.SELECT });
      if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('An active account is required');
      await this.database.query('DELETE FROM "AuthSession" WHERE id IN (SELECT id FROM "AuthSession" WHERE "expiresAt" < CURRENT_TIMESTAMP LIMIT 100)', { transaction });
      await this.database.query('INSERT INTO "AuthSession" (id,"userId","expiresAt") VALUES (:id,:userId,:expiresAt)', { transaction, replacements: { id, userId, expiresAt } });
      await this.database.query('INSERT INTO "RefreshToken" (hash,"sessionId") VALUES (:hash,:id)', { transaction, replacements: { hash: tokenHash(token), id } });
    });
    return { token, expiresAt };
  }
  async rotate(token: string): Promise<{ token: string; expiresAt: Date; login: LoginResponseDto }> {
    const result = await this.database.transaction(async (transaction) => {
      const [stored] = await this.database.query<{ sessionId: string; consumedAt: Date | null }>('SELECT "sessionId","consumedAt" FROM "RefreshToken" WHERE hash=:hash FOR UPDATE', { transaction, replacements: { hash: tokenHash(token) }, type: QueryTypes.SELECT });
      if (!stored) return null;
      const [session] = await this.database.query<{ userId: string; expiresAt: Date; revokedAt: Date | null }>('SELECT "userId","expiresAt","revokedAt" FROM "AuthSession" WHERE id=:id FOR UPDATE', { transaction, replacements: { id: stored.sessionId }, type: QueryTypes.SELECT });
      if (!session || session.revokedAt) return null;
      if (stored.consumedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
        await this.database.query('UPDATE "AuthSession" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=:id', { transaction, replacements: { id: stored.sessionId } });
        return null;
      }
      let login: LoginResponseDto;
      try { login = await this.auth.issueSessionResponse(session.userId); }
      catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        await this.database.query('UPDATE "AuthSession" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=:id', { transaction, replacements: { id: stored.sessionId } });
        return null;
      }
      const next = randomBytes(48).toString('base64url');
      await this.database.query('UPDATE "RefreshToken" SET "consumedAt"=CURRENT_TIMESTAMP WHERE hash=:hash', { transaction, replacements: { hash: tokenHash(token) } });
      await this.database.query('INSERT INTO "RefreshToken" (hash,"sessionId") VALUES (:hash,:id)', { transaction, replacements: { hash: tokenHash(next), id: stored.sessionId } });
      return { token: next, expiresAt: new Date(session.expiresAt), login };
    });
    // Throw outside the transaction so replay/expiry revocation is committed.
    if (!result) throw new UnauthorizedException('Session expired or revoked. Please sign in again.');
    return result;
  }
  async revoke(token: string): Promise<void> {
    await this.database.query('UPDATE "AuthSession" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=(SELECT "sessionId" FROM "RefreshToken" WHERE hash=:hash)', { replacements: { hash: tokenHash(token) } });
  }
}
