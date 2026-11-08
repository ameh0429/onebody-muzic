import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ForeignKeyConstraintError, literal, Op, Transaction, UniqueConstraintError, WhereOptions } from 'sequelize';
import { Album, Artist, Song } from '../database/models';
import { CreateAlbumDto, normalizeAlbumTitle } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { ListAlbumsDto } from './dto/list-albums.dto';
import { AlbumDetailResponseDto, AlbumResponseDto, AlbumsPageDto } from './dto/album-response.dto';

const SONG_COUNT = { include: [[literal('(SELECT COUNT(*)::integer FROM "Song" AS s WHERE s."albumId" = "Album"."id")'), 'songCount'] as [ReturnType<typeof literal>, string]] };
const ARTIST = { model: Artist, as: 'artist', attributes: ['id', 'name'], required: true };

@Injectable()
export class AlbumsService {
  constructor(@InjectModel(Album) private readonly albums: typeof Album, @InjectModel(Artist) private readonly artists: typeof Artist, @InjectModel(Song) private readonly songs: typeof Song, @InjectConnection() private readonly database: Sequelize) {}

  async create(dto: CreateAlbumDto): Promise<AlbumDetailResponseDto> {
    try {
      return await this.database.transaction(async (transaction) => {
        await this.requireArtist(dto.artistId, transaction);
        const album = await this.albums.create({ title: normalizeAlbumTitle(dto.title), artistId: dto.artistId, releaseYear: dto.releaseYear, coverImageUrl: dto.coverImageUrl ?? null, coverImagePublicId: dto.coverImagePublicId ?? null }, { transaction });
        return this.detail(album.id, transaction);
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  async list(query: ListAlbumsDto): Promise<AlbumsPageDto> {
    const where: WhereOptions<Album> = {};
    if (query.artistId) where.artistId = query.artistId;
    if (query.releaseYear !== undefined) where.releaseYear = query.releaseYear;
    if (query.search) where.title = { [Op.iLike]: `%${query.search.replace(/[\\%_]/g, '\\$&')}%` };
    const { rows, count } = await this.albums.findAndCountAll({ where, attributes: SONG_COUNT, include: [ARTIST], limit: query.limit, offset: (query.page - 1) * query.limit, order: [['title', 'ASC'], ['id', 'ASC']] });
    return { data: rows.map((album) => this.response(album)), page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) };
  }

  async findOne(id: string): Promise<AlbumDetailResponseDto> { return this.detail(id); }

  async update(id: string, dto: UpdateAlbumDto): Promise<AlbumDetailResponseDto> {
    const changes: { title?: string; artistId?: string; releaseYear?: number; coverImageUrl?: string | null; coverImagePublicId?: string | null } = {};
    if (dto.title !== undefined) changes.title = normalizeAlbumTitle(dto.title);
    if (dto.artistId !== undefined) changes.artistId = dto.artistId;
    if (dto.releaseYear !== undefined) changes.releaseYear = dto.releaseYear;
    if (dto.coverImageUrl !== undefined) changes.coverImageUrl = dto.coverImageUrl;
    if (dto.coverImagePublicId !== undefined) changes.coverImagePublicId = dto.coverImagePublicId;
    if (Object.keys(changes).length === 0) throw new BadRequestException('Provide at least one album field');
    try {
      return await this.database.transaction(async (transaction) => {
        const album = await this.requireAlbum(id, transaction);
        if (dto.artistId !== undefined) {
          await this.requireArtist(dto.artistId, transaction);
          if (dto.artistId.toLowerCase() !== album.artistId.toLowerCase() && await this.songs.count({ where: { albumId: id }, transaction }) > 0) {
            throw new ConflictException('Cannot change the artist of an album containing songs');
          }
        }
        await album.update(changes, { transaction });
        return this.detail(id, transaction);
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        const album = await this.requireAlbum(id, transaction);
        if (await this.songs.count({ where: { albumId: id }, transaction }) > 0) throw new ConflictException('Album contains songs and cannot be deleted');
        await album.destroy({ transaction });
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  private async requireArtist(id: string, transaction: Transaction): Promise<void> {
    const artist = await this.artists.findByPk(id, { attributes: ['id'], transaction, lock: transaction.LOCK.KEY_SHARE });
    if (!artist) throw new NotFoundException('Artist not found');
  }

  private async requireAlbum(id: string, transaction: Transaction): Promise<Album> {
    const album = await this.albums.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!album) throw new NotFoundException('Album not found');
    return album;
  }

  private async detail(id: string, transaction?: Transaction): Promise<AlbumDetailResponseDto> {
    const album = await this.albums.findByPk(id, { attributes: SONG_COUNT, include: [ARTIST, { model: Song, as: 'songs', separate: true, attributes: ['id', 'title', 'artistId', 'category', 'durationSeconds'], order: [['title', 'ASC'], ['id', 'ASC']] }], transaction });
    if (!album) throw new NotFoundException('Album not found');
    return { ...this.response(album), songs: album.songs.map((song) => ({ id: song.id, title: song.title, artistId: song.artistId, category: song.category, durationSeconds: song.durationSeconds })) };
  }

  private response(album: Album): AlbumResponseDto {
    return { id: album.id, title: album.title, artistId: album.artistId, artist: { id: album.artist.id, name: album.artist.name }, releaseYear: album.releaseYear, coverImageUrl: album.coverImageUrl, coverImagePublicId: album.coverImagePublicId, songCount: Number(album.get('songCount')), createdAt: album.createdAt.toISOString(), updatedAt: album.updatedAt.toISOString() };
  }

  private rethrow(error: unknown): never {
    if (error instanceof UniqueConstraintError) throw new ConflictException('Album title is already in use for this artist');
    if (error instanceof ForeignKeyConstraintError) throw new ConflictException('Album or artist is referenced; resolve related records first');
    throw error;
  }
}
