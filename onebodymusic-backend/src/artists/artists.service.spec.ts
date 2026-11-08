import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { ForeignKeyConstraintError, Op, Transaction, UniqueConstraintError } from 'sequelize';
import { Artist } from '../database/models';
import { ArtistsService } from './artists.service';
import { ListArtistsDto } from './dto/list-artists.dto';

function fixture(albumCount = 0, songCount = 0): Artist {
  const value = { id: 'artist-id', name: 'Hillsong', biography: null, imageUrl: null, imagePublicId: null, createdAt: new Date(), updatedAt: new Date(), get: jest.fn((key: string) => key === 'albumCount' ? albumCount : songCount), update: jest.fn(), destroy: jest.fn() };
  value.update.mockImplementation(async (changes: object) => Object.assign(value, changes));
  return value as unknown as Artist;
}

describe('ArtistsService', () => {
  const artists = { create: jest.fn(), findByPk: jest.fn(), findAndCountAll: jest.fn() };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as unknown as Transaction;
  const database = { transaction: jest.fn(async (work: (t: Transaction) => Promise<unknown>) => work(transaction)) };
  let service: ArtistsService;
  beforeEach(() => { jest.resetAllMocks(); database.transaction.mockImplementation(async (work) => work(transaction)); service = new ArtistsService(artists as unknown as typeof Artist, database as unknown as Sequelize); });

  it('creates a normalized artist with image references in a transaction', async () => {
    const artist = fixture(); artists.create.mockResolvedValue(artist); artists.findByPk.mockResolvedValue(artist);
    expect(await service.create({ name: ' Hillsong   Worship ', imageUrl: 'https://example.org/image.jpg', imagePublicId: 'artists/image' })).toMatchObject({ albumCount: 0, songCount: 0 });
    expect(artists.create).toHaveBeenCalledWith({ name: 'Hillsong Worship', biography: null, imageUrl: 'https://example.org/image.jpg', imagePublicId: 'artists/image' }, { transaction });
  });
  it('maps duplicate create/update names to 409', async () => {
    artists.create.mockRejectedValue(new UniqueConstraintError({ message: 'duplicate', errors: [] }));
    await expect(service.create({ name: 'Hillsong' })).rejects.toBeInstanceOf(ConflictException);
    const artist = fixture(); artists.findByPk.mockResolvedValue(artist);
    jest.mocked(artist.update).mockRejectedValueOnce(new UniqueConstraintError({ message: 'duplicate', errors: [] }));
    await expect(service.update('artist-id', { name: 'Duplicate' })).rejects.toBeInstanceOf(ConflictException);
  });
  it('paginates and searches literally without SQL wildcard expansion', async () => {
    artists.findAndCountAll.mockResolvedValue({ rows: [fixture(2, 3)], count: 5 });
    const result = await service.list({ ...new ListArtistsDto(), page: 2, limit: 2, search: '100%_' });
    expect(artists.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { [Op.iLike]: '%100\\%\\_%' } }, limit: 2, offset: 2 }));
    expect(result).toMatchObject({ total: 5, totalPages: 3, data: [expect.objectContaining({ albumCount: 2, songCount: 3 })] });
  });
  it('returns safe details and 404 for missing artists', async () => {
    artists.findByPk.mockResolvedValueOnce(fixture(2, 5)).mockResolvedValueOnce(null);
    expect(await service.findOne('artist-id')).toMatchObject({ albumCount: 2, songCount: 5 });
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('locks before updating, supports clearing optional references, and keeps omitted fields unchanged', async () => {
    const artist = fixture(); artists.findByPk.mockResolvedValue(artist);
    await service.update('artist-id', { biography: null, imageUrl: null });
    expect(artists.findByPk).toHaveBeenCalledWith('artist-id', expect.objectContaining({ transaction, lock: 'UPDATE' }));
    expect(artist.update).toHaveBeenCalledWith({ biography: null, imageUrl: null }, { transaction });
  });
  it('rejects an empty patch', async () => {
    await expect(service.update('artist-id', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(database.transaction).not.toHaveBeenCalled();
  });
  it.each([[1, 0], [0, 1]])('rejects deletion with album/song references (%s/%s)', async (albums, songs) => {
    const artist = fixture(albums, songs); artists.findByPk.mockResolvedValue(artist);
    await expect(service.remove('artist-id')).rejects.toBeInstanceOf(ConflictException);
    expect(artist.destroy).not.toHaveBeenCalled();
  });
  it('deletes an unreferenced artist while holding its row lock', async () => {
    const artist = fixture(); artists.findByPk.mockResolvedValue(artist);
    await service.remove('artist-id'); expect(artist.destroy).toHaveBeenCalledWith({ transaction });
  });
  it('maps a concurrent foreign-key failure to 409', async () => {
    const artist = fixture(); artists.findByPk.mockResolvedValue(artist);
    jest.mocked(artist.destroy).mockRejectedValueOnce(new ForeignKeyConstraintError({ message: 'referenced' }));
    await expect(service.remove('artist-id')).rejects.toBeInstanceOf(ConflictException);
  });
});
