import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { ForeignKeyConstraintError, Op, Transaction, UniqueConstraintError } from 'sequelize';
import { Album, Artist, Song } from '../database/models';
import { AlbumsService } from './albums.service';
import { ListAlbumsDto } from './dto/list-albums.dto';

function fixture(): Album {
  const album = { id: 'album-id', title: 'Praise', artistId: 'artist-id', artist: { id: 'artist-id', name: 'Artist' }, releaseYear: 2024, coverImageUrl: null, coverImagePublicId: null, createdAt: new Date(), updatedAt: new Date(), songs: [], get: jest.fn(() => 0), update: jest.fn(), destroy: jest.fn() };
  album.update.mockImplementation(async (change: object) => Object.assign(album, change));
  return album as unknown as Album;
}

describe('AlbumsService', () => {
  const albums = { findByPk: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn() };
  const artists = { findByPk: jest.fn() }; const songs = { count: jest.fn() };
  const transaction = { LOCK: { UPDATE: 'UPDATE', KEY_SHARE: 'KEY SHARE' } } as unknown as Transaction;
  const database = { transaction: jest.fn(async (work: (t: Transaction) => Promise<unknown>) => work(transaction)) };
  let service: AlbumsService;
  beforeEach(() => {
    jest.resetAllMocks(); database.transaction.mockImplementation(async (work) => work(transaction));
    service = new AlbumsService(albums as unknown as typeof Album, artists as unknown as typeof Artist, songs as unknown as typeof Song, database as unknown as Sequelize);
    artists.findByPk.mockResolvedValue({ id: 'artist-id' }); songs.count.mockResolvedValue(0); albums.findByPk.mockResolvedValue(fixture());
  });
  it('validates and locks the artist before inserting a normalized album', async () => {
    albums.create.mockResolvedValue(fixture());
    expect(await service.create({ title: ' Songs   of Praise ', artistId: 'artist-id', releaseYear: 2024 })).toMatchObject({ songs: [], artist: { name: 'Artist' } });
    expect(artists.findByPk).toHaveBeenCalledWith('artist-id', { attributes: ['id'], transaction, lock: 'KEY SHARE' });
    expect(albums.create).toHaveBeenCalledWith({ title: 'Songs of Praise', artistId: 'artist-id', releaseYear: 2024, coverImageUrl: null, coverImagePublicId: null }, { transaction });
  });
  it('returns 404 for a missing artist without writing', async () => {
    artists.findByPk.mockResolvedValue(null);
    await expect(service.create({ title: 'Praise', artistId: 'missing', releaseYear: 2024 })).rejects.toBeInstanceOf(NotFoundException);
    expect(albums.create).not.toHaveBeenCalled();
  });
  it('maps duplicate titles to 409', async () => {
    albums.create.mockRejectedValue(new UniqueConstraintError({ message: 'duplicate', errors: [] }));
    await expect(service.create({ title: 'Praise', artistId: 'artist-id', releaseYear: 2024 })).rejects.toBeInstanceOf(ConflictException);
  });
  it('combines filters and literal title search with pagination', async () => {
    albums.findAndCountAll.mockResolvedValue({ rows: [fixture()], count: 3 });
    const result = await service.list({ ...new ListAlbumsDto(), page: 2, limit: 2, artistId: 'artist-id', releaseYear: 2024, search: '100%' });
    expect(result).toMatchObject({ total: 3, totalPages: 2 });
    expect(albums.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: { artistId: 'artist-id', releaseYear: 2024, title: { [Op.iLike]: '%100\\%%' } }, limit: 2, offset: 2 }));
  });
  it('returns safe song details and 404 for unknown albums', async () => {
    const album = fixture(); album.songs = [{ id: 'song', title: 'Song', artistId: 'artist-id', category: null, durationSeconds: 240, audioPublicId: 'internal-reference' } as Song];
    albums.findByPk.mockResolvedValueOnce(album).mockResolvedValueOnce(null);
    const result = await service.findOne('album-id'); expect(result.songs).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('audioPublicId');
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('locks an album to update optional artwork without erasing omitted data', async () => {
    const album = fixture(); albums.findByPk.mockResolvedValue(album);
    await service.update('album-id', { coverImageUrl: null });
    expect(album.update).toHaveBeenCalledWith({ coverImageUrl: null }, { transaction });
    expect(albums.findByPk).toHaveBeenCalledWith('album-id', { transaction, lock: 'UPDATE' });
  });
  it('rejects an empty patch', async () => { await expect(service.update('album-id', {})).rejects.toBeInstanceOf(BadRequestException); });
  it('validates replacement artists and blocks artist changes when songs exist', async () => {
    songs.count.mockResolvedValue(1);
    await expect(service.update('album-id', { artistId: 'different' })).rejects.toBeInstanceOf(ConflictException);
    artists.findByPk.mockResolvedValue(null);
    await expect(service.update('album-id', { artistId: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('allows artist reassignment for empty albums and same-artist edits for populated ones', async () => {
    const album = fixture(); albums.findByPk.mockResolvedValue(album);
    await service.update('album-id', { artistId: 'different' }); expect(album.update).toHaveBeenCalledWith({ artistId: 'different' }, { transaction });
    songs.count.mockResolvedValue(1);
    await service.update('album-id', { artistId: 'DIFFERENT' });
  });
  it('blocks populated album deletion and deletes empty albums', async () => {
    const album = fixture(); albums.findByPk.mockResolvedValue(album); songs.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(service.remove('album-id')).rejects.toBeInstanceOf(ConflictException); expect(album.destroy).not.toHaveBeenCalled();
    await service.remove('album-id'); expect(album.destroy).toHaveBeenCalledWith({ transaction });
  });
  it('maps concurrent reference failures to 409', async () => {
    const album = fixture(); albums.findByPk.mockResolvedValue(album); jest.mocked(album.destroy).mockRejectedValue(new ForeignKeyConstraintError({ message: 'referenced' }));
    await expect(service.remove('album-id')).rejects.toBeInstanceOf(ConflictException);
  });
});
