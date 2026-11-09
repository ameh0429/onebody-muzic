import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Readable } from 'node:stream';
import { Sequelize } from 'sequelize-typescript';
import { ForeignKeyConstraintError, Op, Transaction, UniqueConstraintError, WhereOptions } from 'sequelize';
import { Album, Artist, MediaAsset, MediaKind, MediaStatus, Song } from '../database/models';
import { MediaService } from '../media/media.service';
import { CloudinaryClient } from '../media/cloudinary.client';
import { AudioUpstream, CloudinaryAudioGateway } from '../media/cloudinary-audio.gateway';
import { CreateSongDto } from './dto/create-song.dto';
import { UpdateSongDto } from './dto/update-song.dto';
import { ListSongsDto } from './dto/list-songs.dto';
import { SongDetailResponseDto, SongResponseDto, SongsPageDto } from './dto/song-response.dto';
import { PlaybackTicketsService } from './playback-tickets.service';
import { PlaybackResponseDto } from './dto/playback.dto';

const INCLUDES = [{ model: Artist, as: 'artist', attributes: ['id', 'name'], required: true }, { model: Album, as: 'album', attributes: ['id', 'title', 'releaseYear'], required: false }];

@Injectable()
export class SongsService {
  constructor(@InjectModel(Song) private readonly songs: typeof Song, @InjectModel(Artist) private readonly artists: typeof Artist, @InjectModel(Album) private readonly albums: typeof Album, @InjectModel(MediaAsset) private readonly assets: typeof MediaAsset, @InjectConnection() private readonly database: Sequelize, private readonly media: MediaService, private readonly cloudinary: CloudinaryClient, private readonly gateway: CloudinaryAudioGateway, private readonly tickets: PlaybackTicketsService) {}

  async create(dto: CreateSongDto, actorId: string): Promise<SongDetailResponseDto> {
    return this.write(async (transaction) => {
      await this.validateArtistAlbum(dto.artistId, dto.albumId ?? null, transaction);
      const audio = await this.asset(dto.audioAssetId, MediaKind.AUDIO, actorId, transaction);
      await this.assertUnusedAudio(audio, transaction);
      const cover = dto.coverAssetId ? await this.asset(dto.coverAssetId, MediaKind.IMAGE, actorId, transaction) : null;
      const song = await this.songs.create({ title: dto.title, artistId: dto.artistId, albumId: dto.albumId ?? null, category: dto.category ?? null, lyrics: dto.lyrics ?? null, audioAssetId: audio.id, audioPublicId: audio.publicId, audioResourceType: audio.resourceType, durationSeconds: this.duration(audio), uploadedById: actorId, coverAssetId: cover?.id ?? null, coverImagePublicId: cover?.publicId ?? null, coverImageUrl: cover ? this.cloudinary.imageUrl(cover) : null }, { transaction });
      return this.detailResponse(await this.required(song.id, transaction, false, true));
    });
  }

  async list(query: ListSongsDto): Promise<SongsPageDto> {
    const where: WhereOptions<Song> = {};
    if (query.artistId) where.artistId = query.artistId;
    if (query.albumId) where.albumId = query.albumId;
    if (query.category) where.category = query.category;
    if (query.search) where.title = { [Op.iLike]: `%${query.search.replace(/[\\%_]/g, '\\$&')}%` };
    const { rows, count } = await this.songs.findAndCountAll({ where, attributes: { exclude: ['lyrics'] }, include: INCLUDES, limit: query.limit, offset: (query.page - 1) * query.limit, order: [[query.sortBy, query.sortOrder], ['id', 'ASC']] });
    return { data: rows.map((song) => this.response(song)), page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) };
  }
  async findOne(id: string): Promise<SongDetailResponseDto> { return this.detailResponse(await this.required(id, undefined, false, true)); }

  async update(id: string, dto: UpdateSongDto, actorId: string): Promise<SongDetailResponseDto> {
    if (Object.keys(dto).length === 0) throw new BadRequestException('Provide at least one song field');
    return this.write(async (transaction) => {
      const song = await this.required(id, transaction, true);
      const artistId = dto.artistId ?? song.artistId;
      const albumId = dto.albumId === undefined ? song.albumId : dto.albumId;
      await this.validateArtistAlbum(artistId, albumId, transaction);
      const changes: Partial<Pick<Song, 'title' | 'artistId' | 'albumId' | 'category' | 'lyrics' | 'audioAssetId' | 'audioPublicId' | 'audioResourceType' | 'durationSeconds' | 'coverAssetId' | 'coverImageUrl' | 'coverImagePublicId'>> = {};
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.artistId !== undefined) changes.artistId = dto.artistId;
      if (dto.albumId !== undefined) changes.albumId = dto.albumId;
      if (dto.category !== undefined) changes.category = dto.category;
      if (dto.lyrics !== undefined) changes.lyrics = dto.lyrics;
      const oldAudioId = song.audioAssetId; const oldCoverId = song.coverAssetId;
      if (dto.audioAssetId !== undefined) {
        const audio = await this.asset(dto.audioAssetId, MediaKind.AUDIO, actorId, transaction, oldAudioId);
        await this.assertUnusedAudio(audio, transaction, id);
        Object.assign(changes, { audioAssetId: audio.id, audioPublicId: audio.publicId, audioResourceType: audio.resourceType, durationSeconds: this.duration(audio) });
      }
      if (dto.coverAssetId !== undefined) {
        const cover = dto.coverAssetId ? await this.asset(dto.coverAssetId, MediaKind.IMAGE, actorId, transaction, oldCoverId) : null;
        Object.assign(changes, { coverAssetId: cover?.id ?? null, coverImagePublicId: cover?.publicId ?? null, coverImageUrl: cover ? this.cloudinary.imageUrl(cover) : null });
      }
      await song.update(changes, { transaction });
      if (oldAudioId && changes.audioAssetId && oldAudioId !== changes.audioAssetId) await this.media.scheduleUnreferenced(oldAudioId, transaction);
      if (oldCoverId && dto.coverAssetId !== undefined && oldCoverId !== changes.coverAssetId) await this.media.scheduleUnreferenced(oldCoverId, transaction);
      return this.detailResponse(await this.required(id, transaction, false, true));
    });
  }

  async remove(id: string): Promise<void> {
    await this.write(async (transaction) => {
      const song = await this.required(id, transaction, true); await song.destroy({ transaction });
      if (song.audioAssetId) await this.media.scheduleUnreferenced(song.audioAssetId, transaction);
      if (song.coverAssetId) await this.media.scheduleUnreferenced(song.coverAssetId, transaction);
    });
  }

  async playback(id: string, userId: string): Promise<PlaybackResponseDto> {
    await this.playbackAsset(id);
    if (!this.cloudinary.configured()) throw new ServiceUnavailableException('Audio delivery is not configured');
    return this.tickets.issue(userId, id.toLowerCase());
  }

  async openStream(id: string, range: string | undefined, head: boolean, signal: AbortSignal): Promise<AudioUpstream> {
    const asset = await this.playbackAsset(id);
    if (!this.cloudinary.configured()) throw new ServiceUnavailableException('Audio delivery is not configured');
    if (range && (!/^bytes=(\d{0,15})-(\d{0,15})$/.test(range) || range === 'bytes=-')) throw new BadRequestException('Only one valid byte range is supported');
    if (range) {
      const [start, end] = range.slice(6).split('-');
      if ((start && Number(start) >= asset.bytes) || (start && end && Number(start) > Number(end)) || (!start && Number(end) === 0)) {
        return { stream: Readable.from([]), status: 416, contentType: asset.mimeType, contentLength: '0', contentRange: `bytes */${asset.bytes}`, acceptRanges: 'bytes' } as AudioUpstream;
      }
    }
    return this.gateway.open(asset, range, head, signal);
  }

  private async playbackAsset(id: string): Promise<MediaAsset> {
    const song = await this.required(id);
    if (!song.audioAssetId) throw new ConflictException('Assign a tracked audio asset to this legacy song before playback');
    const asset = await this.assets.findByPk(song.audioAssetId);
    if (!asset || asset.status !== MediaStatus.READY || asset.kind !== MediaKind.AUDIO || asset.folder !== 'onebodymusic/audio' || asset.deliveryType !== 'authenticated' || asset.resourceType !== 'video' || asset.publicId !== song.audioPublicId || asset.resourceType !== song.audioResourceType) throw new ConflictException('Song audio is unavailable');
    return asset;
  }

  private async validateArtistAlbum(artistId: string, albumId: string | null, transaction: Transaction): Promise<void> {
    if (albumId) {
      const album = await this.albums.findByPk(albumId, { transaction, lock: transaction.LOCK.SHARE });
      if (!album) throw new NotFoundException('Album not found');
      if (album.artistId.toLowerCase() !== artistId.toLowerCase()) throw new BadRequestException('Album must belong to the selected artist');
    }
    if (!await this.artists.findByPk(artistId, { attributes: ['id'], transaction, lock: transaction.LOCK.KEY_SHARE })) throw new NotFoundException('Artist not found');
  }
  private async asset(id: string, kind: MediaKind, actorId: string, transaction: Transaction, currentId?: string | null): Promise<MediaAsset> {
    const asset = await this.assets.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!asset) throw new NotFoundException('Media asset not found');
    if (asset.status !== MediaStatus.READY || asset.kind !== kind || asset.folder !== `onebodymusic/${kind === MediaKind.AUDIO ? 'audio' : 'songs'}` || (kind === MediaKind.AUDIO && (asset.resourceType !== 'video' || asset.deliveryType !== 'authenticated'))) throw new ConflictException('A ready, compatible media asset is required');
    if (asset.uploadedById !== actorId && asset.id !== currentId) throw new ForbiddenException('Only the uploader can attach an unused asset');
    return asset;
  }
  private async assertUnusedAudio(asset: MediaAsset, transaction: Transaction, currentId?: string): Promise<void> {
    if (await this.songs.findOne({ where: { audioPublicId: asset.publicId, audioResourceType: asset.resourceType, ...(currentId ? { id: { [Op.ne]: currentId } } : {}) }, attributes: ['id'], transaction })) throw new ConflictException('Audio asset already belongs to another song');
  }
  private duration(asset: MediaAsset): number | null {
    if (asset.duration === null) return null;
    if (!Number.isFinite(asset.duration) || asset.duration < 0 || asset.duration > 2147483647) throw new ConflictException('Invalid audio duration metadata');
    return Math.ceil(asset.duration);
  }
  private async required(id: string, transaction?: Transaction, lock = false, details = false): Promise<Song> {
    const song = await this.songs.findByPk(id, { transaction, ...(details ? { include: INCLUDES } : { attributes: { exclude: ['lyrics'] } }), ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!song) throw new NotFoundException('Song not found'); return song;
  }
  private async write<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
        await this.database.query('SELECT pg_advisory_xact_lock(172932, 3)', { transaction });
        return work(transaction);
      });
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new ConflictException('Audio asset already belongs to a song');
      if (error instanceof ForeignKeyConstraintError) throw new ConflictException('Song is referenced by a playlist or another related record');
      throw error;
    }
  }
  private detailResponse(song: Song): SongDetailResponseDto { return { ...this.response(song), lyrics: song.lyrics ?? null }; }

  private response(song: Song): SongResponseDto {
    return { id: song.id, title: song.title, artistId: song.artistId, artist: { id: song.artist.id, name: song.artist.name }, albumId: song.albumId, album: song.album ? { id: song.album.id, title: song.album.title, releaseYear: song.album.releaseYear } : null, category: song.category, durationSeconds: song.durationSeconds, coverImageUrl: song.coverImageUrl, hasAudioAsset: Boolean(song.audioAssetId), createdAt: song.createdAt.toISOString(), updatedAt: song.updatedAt.toISOString() };
  }
}
