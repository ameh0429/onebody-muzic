import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { Readable } from 'node:stream';
import { Transaction, Op, ForeignKeyConstraintError } from 'sequelize';
import { Song, Artist, Album, MediaAsset, MediaKind, MediaStatus } from '../database/models';
import { MediaService } from '../media/media.service';
import { CloudinaryClient } from '../media/cloudinary.client';
import { CloudinaryAudioGateway } from '../media/cloudinary-audio.gateway';
import { SongsService } from './songs.service';
import { PlaybackTicketsService } from './playback-tickets.service';
import { ListSongsDto, SongSortBy, SongSortOrder } from './dto/list-songs.dto';

function songFixture(): Song {
  const value = { id: 'song-id', title: 'Amazing Grace', artistId: 'artist-id', artist: { id: 'artist-id', name: 'Choir' }, albumId: 'album-id', album: { id: 'album-id', title: 'Praise', releaseYear: 2024 }, category: 'Worship', durationSeconds: 241, audioAssetId: 'audio-id', coverAssetId: null, audioPublicId: 'onebodymusic/audio/audio-id', audioResourceType: 'video', coverImageUrl: null, uploadedById: 'admin-id', createdAt: new Date(), updatedAt: new Date(), update: jest.fn(), destroy: jest.fn() };
  value.update.mockImplementation(async (change: object) => Object.assign(value, change)); return value as unknown as Song;
}
function audioFixture(): MediaAsset { return { id: 'audio-id', publicId: 'onebodymusic/audio/audio-id', kind: MediaKind.AUDIO, status: MediaStatus.READY, folder: 'onebodymusic/audio', resourceType: 'video', deliveryType: 'authenticated', format: 'mp3', mimeType: 'audio/mpeg', bytes: 100, duration: 240.5, uploadedById: 'admin-id' } as MediaAsset; }

describe('SongsService', () => {
  const songs = { findByPk: jest.fn(), findAndCountAll: jest.fn(), findOne: jest.fn(), create: jest.fn() }; const artists = { findByPk: jest.fn() }; const albums = { findByPk: jest.fn() }; const assets = { findByPk: jest.fn() };
  const transaction = { LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE', KEY_SHARE: 'KEY SHARE' } } as unknown as Transaction;
  const database = { transaction: jest.fn(), query: jest.fn() }; const media = { scheduleUnreferenced: jest.fn() }; const cloud = { configured: jest.fn(), imageUrl: jest.fn() }; const gateway = { open: jest.fn() }; const tickets = { issue: jest.fn() };
  let service: SongsService; let song: Song; let asset: MediaAsset;
  beforeEach(() => {
    jest.resetAllMocks(); song = songFixture(); asset = audioFixture(); database.transaction.mockImplementation(async (_options: object, work: (t: Transaction) => Promise<unknown>) => work(transaction));
    songs.findByPk.mockResolvedValue(song); songs.create.mockResolvedValue(song); songs.findOne.mockResolvedValue(null); artists.findByPk.mockResolvedValue({ id: 'artist-id' }); albums.findByPk.mockResolvedValue({ id: 'album-id', artistId: 'artist-id' }); assets.findByPk.mockResolvedValue(asset); cloud.configured.mockReturnValue(true);
    service = new SongsService(songs as unknown as typeof Song, artists as unknown as typeof Artist, albums as unknown as typeof Album, assets as unknown as typeof MediaAsset, database as unknown as Sequelize, media as unknown as MediaService, cloud as unknown as CloudinaryClient, gateway as unknown as CloudinaryAudioGateway, tickets as unknown as PlaybackTicketsService);
  });
  const dto = { title: 'Amazing Grace', artistId: 'artist-id', albumId: 'album-id', category: 'Worship', audioAssetId: 'audio-id' };
  it('creates from owned READY media, saves duration and identifiers, and returns only safe metadata', async () => {
    const result = await service.create(dto, 'admin-id'); expect(result.durationSeconds).toBe(241); expect(result.artist.name).toBe('Choir'); expect(result).not.toHaveProperty('audioPublicId');
    expect(songs.create).toHaveBeenCalledWith(expect.objectContaining({ audioAssetId: asset.id, audioPublicId: asset.publicId, audioResourceType: 'video', durationSeconds: 241, uploadedById: 'admin-id' }), { transaction });
  });
  it('stores plain lyrics on create and returns them in details', async () => {
    const lyrics = '  Amazing grace\r\n\r\nÌyìn Olúwa <chorus>  ';
    song.lyrics = lyrics;
    expect((await service.create({ ...dto, lyrics }, 'admin-id')).lyrics).toBe(lyrics);
    expect(songs.create).toHaveBeenCalledWith(expect.objectContaining({ lyrics }), { transaction });
    expect((await service.findOne('song-id')).lyrics).toBe(lyrics);
  });
  it('updates and clears lyrics while omitted lyrics remain untouched', async () => {
    song.lyrics = 'Existing lyrics';
    await service.update('song-id', { title: 'New title' }, 'admin-id');
    expect(song.update).toHaveBeenLastCalledWith({ title: 'New title' }, { transaction });
    expect(song.lyrics).toBe('Existing lyrics');
    expect((await service.update('song-id', { lyrics: 'Verse\nChorus' }, 'admin-id')).lyrics).toBe('Verse\nChorus');
    expect((await service.update('song-id', { lyrics: null }, 'admin-id')).lyrics).toBeNull();
  });
  it('omits lyrics from lists and excludes the column from summary/playback queries', async () => {
    song.lyrics = 'Long private text'; songs.findAndCountAll.mockResolvedValue({ rows: [song], count: 1 });
    const page = await service.list(new ListSongsDto());
    expect(page.data[0]).not.toHaveProperty('lyrics');
    expect(songs.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ attributes: { exclude: ['lyrics'] } }));
  });
  it('rejects missing artists/albums and mismatched album ownership', async () => {
    artists.findByPk.mockResolvedValueOnce(null); await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(NotFoundException);
    albums.findByPk.mockResolvedValueOnce(null); await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(NotFoundException);
    albums.findByPk.mockResolvedValueOnce({ artistId: 'other' }); await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects missing, non-ready, public, wrong-kind and another uploader audio assets', async () => {
    assets.findByPk.mockResolvedValueOnce(null); await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(NotFoundException);
    asset.status = MediaStatus.CLEANUP_PENDING; await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(ConflictException); asset.status = MediaStatus.READY;
    asset.deliveryType = 'upload'; await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(ConflictException); asset.deliveryType = 'authenticated';
    asset.kind = MediaKind.IMAGE; await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(ConflictException); asset.kind = MediaKind.AUDIO;
    asset.uploadedById = 'another-admin'; await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('prevents reuse of audio already attached to another song', async () => { songs.findOne.mockResolvedValue({ id: 'other' }); await expect(service.create(dto, 'admin-id')).rejects.toBeInstanceOf(ConflictException); });
  it('combines search/filters with whitelisted sorting and pagination', async () => {
    songs.findAndCountAll.mockResolvedValue({ rows: [song], count: 3 }); const result = await service.list({ ...new ListSongsDto(), page: 2, limit: 2, artistId: 'artist-id', albumId: 'album-id', category: 'Worship', search: '100%', sortBy: SongSortBy.TITLE, sortOrder: SongSortOrder.ASC });
    expect(result).toMatchObject({ total: 3, totalPages: 2 }); expect(songs.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: { artistId: 'artist-id', albumId: 'album-id', category: 'Worship', title: { [Op.iLike]: '%100\\%%' } }, offset: 2, limit: 2, order: [['title', 'ASC'], ['id', 'ASC']] }));
  });
  it('returns 404 for unknown songs', async () => { songs.findByPk.mockResolvedValue(null); await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException); });
  it('rejects empty updates and invalid artist/album combinations', async () => {
    await expect(service.update('song-id', {}, 'admin-id')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('song-id', { artistId: 'other' }, 'admin-id')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('replaces audio and atomically schedules the previous unreferenced asset for cleanup', async () => {
    asset.id = 'new-audio'; asset.publicId = 'onebodymusic/audio/new-audio'; await service.update('song-id', { audioAssetId: 'new-audio' }, 'admin-id');
    expect(song.update).toHaveBeenCalledWith(expect.objectContaining({ audioAssetId: 'new-audio' }), { transaction }); expect(media.scheduleUnreferenced).toHaveBeenCalledWith('audio-id', transaction);
  });
  it('deletes songs and schedules media without provider side effects inside the transaction', async () => {
    await service.remove('song-id'); expect(song.destroy).toHaveBeenCalledWith({ transaction }); expect(media.scheduleUnreferenced).toHaveBeenCalledWith('audio-id', transaction); expect(gateway.open).not.toHaveBeenCalled();
  });
  it('refuses playlist-referenced deletion', async () => { jest.mocked(song.destroy).mockRejectedValueOnce(new ForeignKeyConstraintError({ message: 'referenced' })); await expect(service.remove('song-id')).rejects.toBeInstanceOf(ConflictException); expect(media.scheduleUnreferenced).not.toHaveBeenCalled(); });
  it('issues only scoped playback metadata for READY authenticated audio', async () => {
    tickets.issue.mockResolvedValue({ url: '/signed-ticket', expiresIn: 60 }); expect(await service.playback('song-id', 'member-id')).toMatchObject({ expiresIn: 60 }); expect(tickets.issue).toHaveBeenCalledWith('member-id', 'song-id');
    song.audioAssetId = null; await expect(service.playback('song-id', 'member-id')).rejects.toBeInstanceOf(ConflictException);
  });
  it('forwards valid byte ranges without buffering upstream audio', async () => {
    const stream = Readable.from([Buffer.from('abc')]); gateway.open.mockResolvedValue({ stream, status: 206 }); const signal = new AbortController().signal;
    expect((await service.openStream('song-id', 'bytes=0-2', false, signal)).stream).toBe(stream); expect(gateway.open).toHaveBeenCalledWith(asset, 'bytes=0-2', false, signal);
    expect((await service.openStream('song-id', 'bytes=999-', false, signal)).status).toBe(416);
    await expect(service.openStream('song-id', 'bytes=0-1,3-4', false, signal)).rejects.toBeInstanceOf(BadRequestException);
  });
});
