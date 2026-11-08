import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ForeignKeyConstraintError, literal, Op, Transaction, UniqueConstraintError, WhereOptions } from 'sequelize';
import { Artist } from '../database/models';
import { CreateArtistDto, normalizeArtistName } from './dto/create-artist.dto';
import { UpdateArtistDto } from './dto/update-artist.dto';
import { ListArtistsDto } from './dto/list-artists.dto';
import { ArtistResponseDto, ArtistsPageDto } from './dto/artist-response.dto';

const COUNTS = {
  include: [
    [literal('(SELECT COUNT(*)::integer FROM "Album" AS a WHERE a."artistId" = "Artist"."id")'), 'albumCount'] as [ReturnType<typeof literal>, string],
    [literal('(SELECT COUNT(*)::integer FROM "Song" AS s WHERE s."artistId" = "Artist"."id")'), 'songCount'] as [ReturnType<typeof literal>, string],
  ],
};

@Injectable()
export class ArtistsService {
  constructor(@InjectModel(Artist) private readonly artists: typeof Artist, @InjectConnection() private readonly database: Sequelize) {}

  async create(dto: CreateArtistDto): Promise<ArtistResponseDto> {
    try {
      return await this.database.transaction(async (transaction) => {
        const artist = await this.artists.create({ name: normalizeArtistName(dto.name), biography: dto.biography ?? null, imageUrl: dto.imageUrl ?? null, imagePublicId: dto.imagePublicId ?? null }, { transaction });
        return this.response(await this.required(artist.id, transaction));
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  async list(query: ListArtistsDto): Promise<ArtistsPageDto> {
    const where: WhereOptions<Artist> = {};
    if (query.search) where.name = { [Op.iLike]: `%${query.search.replace(/[\\%_]/g, '\\$&')}%` };
    const { rows, count } = await this.artists.findAndCountAll({ where, attributes: COUNTS, limit: query.limit, offset: (query.page - 1) * query.limit, order: [['name', 'ASC'], ['id', 'ASC']] });
    return { data: rows.map((artist) => this.response(artist)), page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) };
  }

  async findOne(id: string): Promise<ArtistResponseDto> { return this.response(await this.required(id)); }

  async update(id: string, dto: UpdateArtistDto): Promise<ArtistResponseDto> {
    const changes: { name?: string; biography?: string | null; imageUrl?: string | null; imagePublicId?: string | null } = {};
    if (dto.name !== undefined) changes.name = normalizeArtistName(dto.name);
    if (dto.biography !== undefined) changes.biography = dto.biography;
    if (dto.imageUrl !== undefined) changes.imageUrl = dto.imageUrl;
    if (dto.imagePublicId !== undefined) changes.imagePublicId = dto.imagePublicId;
    if (Object.keys(changes).length === 0) throw new BadRequestException('Provide at least one artist field');
    try {
      return await this.database.transaction(async (transaction) => {
        const artist = await this.required(id, transaction, true);
        await artist.update(changes, { transaction });
        return this.response(await this.required(id, transaction));
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        const artist = await this.required(id, transaction, true);
        const counts = this.response(artist);
        if (counts.albumCount > 0 || counts.songCount > 0) throw new ConflictException('Artist has albums or songs and cannot be deleted');
        // The row lock and RESTRICT foreign keys also protect against concurrent references.
        await artist.destroy({ transaction });
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  private async required(id: string, transaction?: Transaction, lock = false): Promise<Artist> {
    const artist = await this.artists.findByPk(id, { attributes: COUNTS, transaction, ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!artist) throw new NotFoundException('Artist not found');
    return artist;
  }

  private response(artist: Artist): ArtistResponseDto {
    return { id: artist.id, name: artist.name, biography: artist.biography, imageUrl: artist.imageUrl, imagePublicId: artist.imagePublicId, albumCount: Number(artist.get('albumCount')), songCount: Number(artist.get('songCount')), createdAt: artist.createdAt.toISOString(), updatedAt: artist.updatedAt.toISOString() };
  }

  private rethrow(error: unknown): never {
    if (error instanceof UniqueConstraintError) throw new ConflictException('Artist name is already in use');
    if (error instanceof ForeignKeyConstraintError) throw new ConflictException('Artist has albums or songs and cannot be deleted');
    throw error;
  }
}
