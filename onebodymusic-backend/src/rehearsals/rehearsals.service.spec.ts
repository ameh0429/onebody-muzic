import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Playlist, PlaylistPublicationStatus, PlaylistType, Rehearsal, Role, User, UserStatus } from '../database/models';
import { PlaylistsService } from '../playlists/playlists.service';
import { RehearsalsService } from './rehearsals.service';
import { RehearsalPeriod } from './dto/list-rehearsals.dto';

describe('RehearsalsService', () => {
  const admin = { id: randomUUID(), role: Role.ADMIN, status: UserStatus.ACTIVE }; const member = { ...admin, role: Role.MEMBER };
  const playlistId = randomUUID(); const rehearsalId = randomUUID(); const now = new Date('2026-11-09T12:00:00Z');
  const row = { id: rehearsalId, title: 'Practice', description: null, scheduledAt: now, playlistId, createdById: admin.id, createdAt: now, updatedAt: now, playlist: { id: playlistId, title: 'Sunday', publicationStatus: PlaylistPublicationStatus.PUBLISHED }, update: jest.fn(), destroy: jest.fn() };
  const rehearsals = { findByPk: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn() }; const playlists = { findByPk: jest.fn() }; const users = { findByPk: jest.fn() }; const details = { findOne: jest.fn() }; const db = { transaction: jest.fn() }; const tx = { LOCK: Transaction.LOCK } as Transaction;
  let service: RehearsalsService;
  beforeEach(() => {
    jest.resetAllMocks(); jest.useFakeTimers().setSystemTime(now);
    rehearsals.findByPk.mockResolvedValue(row); rehearsals.create.mockResolvedValue(row); rehearsals.findAndCountAll.mockResolvedValue({ rows: [], count: 0 }); playlists.findByPk.mockResolvedValue({ type: PlaylistType.REHEARSAL }); users.findByPk.mockResolvedValue(admin); details.findOne.mockResolvedValue({ id: playlistId, songs: [] });
    db.transaction.mockImplementation(async (options: unknown, callback?: (transaction: Transaction) => Promise<unknown>) => typeof options === 'function' ? (options as (transaction: Transaction) => Promise<unknown>)(tx) : callback!(tx));
    service = new RehearsalsService(rehearsals as unknown as typeof Rehearsal, playlists as unknown as typeof Playlist, users as unknown as typeof User, db as unknown as Sequelize, details as unknown as PlaylistsService);
  });
  afterEach(() => jest.useRealTimers());
  it('enforces administrator permissions inside the service for all mutations', async () => {
    const dto = { title: 'Practice', scheduledAt: now.toISOString(), playlistId };
    await expect(service.create(dto, member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(rehearsalId, { title: 'X' }, member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(rehearsalId, member)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('rejects administrators whose database account is suspended or demoted', async () => {
    for (const fresh of [{ ...admin, status: UserStatus.SUSPENDED }, member]) { users.findByPk.mockResolvedValue(fresh); await expect(service.remove(rehearsalId, admin)).rejects.toBeInstanceOf(ForbiddenException); }
    expect(row.destroy).not.toHaveBeenCalled();
  });
  it('validates playlist existence and type before creating', async () => {
    const dto = { title: 'Practice', scheduledAt: now.toISOString(), playlistId };
    playlists.findByPk.mockResolvedValue(null); await expect(service.create(dto, admin)).rejects.toBeInstanceOf(NotFoundException);
    playlists.findByPk.mockResolvedValue({ type: PlaylistType.PERSONAL }); await expect(service.create(dto, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(rehearsals.create).not.toHaveBeenCalled();
  });
  it('normalizes time and loads ordered playlist details within the write transaction', async () => {
    await service.create({ title: 'Practice', scheduledAt: '2026-11-09T13:00:00+01:00', playlistId }, admin);
    expect(rehearsals.create).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: now, createdById: admin.id }), { transaction: tx });
    expect(details.findOne).toHaveBeenCalledWith(playlistId, admin, tx);
  });
  it('uses a single exact now boundary, visible playlist join and stable paginated sorting', async () => {
    await service.list({ page: 2, limit: 10, period: RehearsalPeriod.UPCOMING }, member);
    expect(rehearsals.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: { scheduledAt: { [Op.gte]: now } }, offset: 10, limit: 10, order: [['scheduledAt', 'ASC'], ['id', 'ASC']], include: [expect.objectContaining({ required: true, where: { type: PlaylistType.REHEARSAL, publicationStatus: PlaylistPublicationStatus.PUBLISHED } })] }));
    await service.list({ page: 1, limit: 20, period: RehearsalPeriod.PAST }, admin);
    expect(rehearsals.findAndCountAll).toHaveBeenLastCalledWith(expect.objectContaining({ where: { scheduledAt: { [Op.lt]: now } }, order: [['scheduledAt', 'DESC'], ['id', 'ASC']] }));
  });
  it('does not load songs for unavailable rehearsals and uses a consistent read snapshot', async () => {
    rehearsals.findByPk.mockResolvedValue(null);
    await expect(service.findOne(rehearsalId, member)).rejects.toBeInstanceOf(NotFoundException);
    expect(details.findOne).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledWith({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, expect.any(Function));
  });
  it('rejects empty updates and deletes only the rehearsal', async () => {
    expect(() => service.update(rehearsalId, {}, admin)).toThrow(BadRequestException);
    await service.remove(rehearsalId, admin); expect(row.destroy).toHaveBeenCalledWith({ transaction: tx });
    expect(playlists.findByPk).not.toHaveBeenCalled();
  });
});
