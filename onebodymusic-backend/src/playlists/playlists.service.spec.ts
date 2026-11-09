import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Playlist, PlaylistPublicationStatus, PlaylistSong, PlaylistType, Role, Song, User, UserStatus } from '../database/models';
import { PlaylistsService } from './playlists.service';

describe('PlaylistsService authorization and atomic ordering', () => {
  const owner = { id: randomUUID(), role: Role.MEMBER, status: UserStatus.ACTIVE };
  const admin = { id: randomUUID(), role: Role.ADMIN, status: UserStatus.ACTIVE };
  const playlistId = randomUUID(); const songIds = [randomUUID(), randomUUID()];
  let service: PlaylistsService;
  const playlist = { id: playlistId, createdById: owner.id, type: PlaylistType.PERSONAL, publicationStatus: PlaylistPublicationStatus.DRAFT, update: jest.fn(), destroy: jest.fn() };
  const playlists = { findByPk: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn() };
  const entries = { findAll: jest.fn(), bulkCreate: jest.fn() };
  const songs = { findAll: jest.fn() }; const users = { findByPk: jest.fn() };
  const transaction = { LOCK: Transaction.LOCK } as Transaction;
  const database = { transaction: jest.fn(), query: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks(); Object.assign(playlist, { createdById: owner.id, type: PlaylistType.PERSONAL, publicationStatus: PlaylistPublicationStatus.DRAFT });
    users.findByPk.mockResolvedValue(owner); playlists.findByPk.mockResolvedValue(playlist);
    database.transaction.mockImplementation(async (_options: unknown, work: (tx: Transaction) => Promise<unknown>) => work(transaction));
    entries.findAll.mockResolvedValue([]); songs.findAll.mockResolvedValue([]);
    service = new PlaylistsService(playlists as unknown as typeof Playlist, entries as unknown as typeof PlaylistSong, songs as unknown as typeof Song, users as unknown as typeof User, database as unknown as Sequelize);
  });
  it('denies another member and administrator access to private personal playlists', async () => {
    for (const actor of [{ ...owner, id: randomUUID() }, admin]) { await expect(service.findOne(playlistId, actor)).rejects.toBeInstanceOf(ForbiddenException); }
    expect(entries.findAll).not.toHaveBeenCalled();
  });
  it('allows only admins to create rehearsals and prevents personal publishing', async () => {
    await expect(service.create({ title: 'Sunday', type: PlaylistType.REHEARSAL }, owner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create({ title: 'Mine', type: PlaylistType.PERSONAL, publicationStatus: PlaylistPublicationStatus.PUBLISHED }, owner)).rejects.toBeInstanceOf(BadRequestException);
    expect(playlists.create).not.toHaveBeenCalled();
  });
  it('hides draft rehearsals and rejects member mutations of published rehearsals', async () => {
    Object.assign(playlist, { type: PlaylistType.REHEARSAL });
    await expect(service.findOne(playlistId, owner)).rejects.toBeInstanceOf(ForbiddenException);
    playlist.publicationStatus = PlaylistPublicationStatus.PUBLISHED;
    await expect(service.remove(playlistId, owner)).rejects.toBeInstanceOf(ForbiddenException);
    expect(playlist.destroy).not.toHaveBeenCalled();
  });
  it('rechecks current database status and role for mutations', async () => {
    users.findByPk.mockResolvedValue({ ...owner, status: UserStatus.SUSPENDED });
    await expect(service.remove(playlistId, owner)).rejects.toBeInstanceOf(ForbiddenException);
    users.findByPk.mockResolvedValue(owner);
    await expect(service.create({ title: 'Sunday', type: PlaylistType.REHEARSAL }, admin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(playlist.destroy).not.toHaveBeenCalled();
  });
  it('rejects duplicate IDs, existing songs and missing songs without writes', async () => {
    await expect(service.addSongs(playlistId, [songIds[0]!, songIds[0]!.toUpperCase()], owner)).rejects.toBeInstanceOf(BadRequestException);
    entries.findAll.mockResolvedValue([{ songId: songIds[0], position: 0 }]);
    await expect(service.addSongs(playlistId, [songIds[0]!], owner)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addSongs(playlistId, [songIds[1]!], owner)).rejects.toBeInstanceOf(NotFoundException);
    expect(entries.bulkCreate).not.toHaveBeenCalled();
  });
  it('rejects stale reorder sets before changing positions', async () => {
    entries.findAll.mockResolvedValue([{ id: randomUUID(), songId: songIds[0], position: 0 }]);
    await expect(service.reorder(playlistId, [], owner)).rejects.toBeInstanceOf(ConflictException);
    expect(database.query).not.toHaveBeenCalled();
  });
  it('uses two bound updates in the same transaction and propagates failure for rollback', async () => {
    entries.findAll.mockResolvedValue(songIds.map((songId, position) => ({ id: randomUUID(), songId, position })));
    database.query.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('database interrupted'));
    await expect(service.reorder(playlistId, [...songIds].reverse(), owner)).rejects.toThrow('database interrupted');
    expect(database.query).toHaveBeenCalledTimes(2);
    const first = database.query.mock.calls[0] as [string, { transaction: Transaction; replacements: Record<string, number | string> }];
    const second = database.query.mock.calls[1] as typeof first;
    expect(first[1].transaction).toBe(transaction); expect(second[1].transaction).toBe(transaction);
    expect([first[1].replacements.p0, first[1].replacements.p1]).toEqual([2, 3]);
    expect([second[1].replacements.p0, second[1].replacements.p1]).toEqual([1, 0]);
    expect(playlist.update).not.toHaveBeenCalled();
  });
});
