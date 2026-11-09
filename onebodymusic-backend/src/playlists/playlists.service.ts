import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ForeignKeyConstraintError, literal, Op, Transaction, UniqueConstraintError, WhereOptions } from 'sequelize';
import { Artist, Playlist, PlaylistPublicationStatus, PlaylistSong, PlaylistType, Role, Song, User, UserStatus } from '../database/models';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { ListPlaylistsDto } from './dto/list-playlists.dto';
import { PlaylistDetailResponseDto, PlaylistResponseDto, PlaylistsPageDto } from './dto/playlist-response.dto';

type Actor = Pick<UserResponseDto, 'id' | 'role' | 'status'>;
const COUNTS = { include: [[literal('(SELECT COUNT(*)::integer FROM "PlaylistSong" AS ps WHERE ps."playlistId" = "Playlist"."id")'), 'songCount'] as [ReturnType<typeof literal>, string]] };
const MAX_SONGS = 1000;

@Injectable()
export class PlaylistsService {
  constructor(@InjectModel(Playlist) private readonly playlists: typeof Playlist, @InjectModel(PlaylistSong) private readonly entries: typeof PlaylistSong, @InjectModel(Song) private readonly songs: typeof Song, @InjectModel(User) private readonly users: typeof User, @InjectConnection() private readonly database: Sequelize) {}

  async create(dto: CreatePlaylistDto, actor: Actor): Promise<PlaylistDetailResponseDto> {
    return this.write(actor, async (fresh, transaction) => {
      const type = dto.type ?? PlaylistType.PERSONAL;
      if (type === PlaylistType.REHEARSAL && fresh.role !== Role.ADMIN) throw new ForbiddenException('Only administrators can create rehearsal playlists');
      this.validatePublication(type, dto.publicationStatus);
      const playlist = await this.playlists.create({ title: dto.title, description: dto.description ?? null, type, publicationStatus: dto.publicationStatus ?? PlaylistPublicationStatus.DRAFT, createdById: fresh.id }, { transaction });
      return this.detail(playlist.id, fresh, transaction);
    });
  }
  async list(query: ListPlaylistsDto, actor: Actor): Promise<PlaylistsPageDto> {
    this.active(actor);
    const filters: WhereOptions<Playlist> = {};
    if (query.type) filters.type = query.type;
    if (query.publicationStatus) filters.publicationStatus = query.publicationStatus;
    const visibility: WhereOptions<Playlist> = { [Op.or]: [{ type: PlaylistType.PERSONAL, createdById: actor.id }, { type: PlaylistType.REHEARSAL, ...(actor.role === Role.ADMIN ? {} : { publicationStatus: PlaylistPublicationStatus.PUBLISHED }) }] };
    const { rows, count } = await this.playlists.findAndCountAll({ where: { [Op.and]: [visibility, filters] }, attributes: COUNTS, limit: query.limit, offset: (query.page - 1) * query.limit, order: [['createdAt', 'DESC'], ['id', 'ASC']] });
    return { data: rows.map((playlist) => this.response(playlist)), page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) };
  }
  findOne(id: string, actor: Actor): Promise<PlaylistDetailResponseDto> { return this.detail(id, actor); }

  async update(id: string, dto: UpdatePlaylistDto, actor: Actor): Promise<PlaylistDetailResponseDto> {
    if (Object.keys(dto).length === 0) throw new BadRequestException('Provide at least one playlist field');
    return this.write(actor, async (fresh, transaction) => {
      const playlist = await this.locked(id, fresh, transaction);
      this.validatePublication(playlist.type, dto.publicationStatus);
      const changes: { title?: string; description?: string | null; publicationStatus?: PlaylistPublicationStatus } = {};
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.description !== undefined) changes.description = dto.description;
      if (dto.publicationStatus !== undefined) changes.publicationStatus = dto.publicationStatus;
      await playlist.update(changes, { transaction }); return this.detail(id, fresh, transaction);
    });
  }
  async remove(id: string, actor: Actor): Promise<void> {
    await this.write(actor, async (fresh, transaction) => { const playlist = await this.locked(id, fresh, transaction); await playlist.destroy({ transaction }); });
  }
  async addSongs(id: string, songIds: string[], actor: Actor): Promise<PlaylistDetailResponseDto> {
    const ids = this.normalizeIds(songIds);
    if (ids.length === 0 || ids.length > 100) throw new BadRequestException('Add between 1 and 100 song IDs');
    return this.write(actor, async (fresh, transaction) => {
      const playlist = await this.locked(id, fresh, transaction); const current = await this.current(id, transaction);
      if (current.length + ids.length > MAX_SONGS) throw new ConflictException('Playlist limit is 1000 songs');
      const existing = new Set(current.map((entry) => entry.songId));
      if (ids.some((songId) => existing.has(songId))) throw new ConflictException('Playlist already contains one or more songs');
      const found = await this.songs.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id'], transaction, lock: transaction.LOCK.KEY_SHARE });
      if (found.length !== ids.length) throw new NotFoundException('One or more songs were not found');
      if (current.some((entry, index) => entry.position !== index)) await this.setOrder(id, current, current.map((entry) => entry.songId), transaction);
      await this.entries.bulkCreate(ids.map((songId, index) => ({ playlistId: id, songId, position: current.length + index })), { transaction });
      await this.touch(playlist, transaction); return this.detail(id, fresh, transaction);
    });
  }
  async reorder(id: string, songIds: string[], actor: Actor): Promise<PlaylistDetailResponseDto> {
    const ids = this.normalizeIds(songIds);
    if (ids.length > MAX_SONGS) throw new BadRequestException('Playlist limit is 1000 songs');
    return this.write(actor, async (fresh, transaction) => {
      const playlist = await this.locked(id, fresh, transaction); const current = await this.current(id, transaction);
      const existing = new Set(current.map((entry) => entry.songId));
      if (ids.length !== current.length || ids.some((songId) => !existing.has(songId))) throw new ConflictException('Reorder must contain exactly the current playlist song IDs; refresh and retry');
      await this.setOrder(id, current, ids, transaction); await this.touch(playlist, transaction); return this.detail(id, fresh, transaction);
    });
  }
  async removeSong(id: string, songId: string, actor: Actor): Promise<PlaylistDetailResponseDto> {
    return this.write(actor, async (fresh, transaction) => {
      const playlist = await this.locked(id, fresh, transaction); const current = await this.current(id, transaction);
      const target = current.find((entry) => entry.songId.toLowerCase() === songId.toLowerCase());
      if (!target) throw new NotFoundException('Song is not in this playlist');
      await target.destroy({ transaction }); const remaining = current.filter((entry) => entry.id !== target.id);
      await this.setOrder(id, remaining, remaining.map((entry) => entry.songId), transaction); await this.touch(playlist, transaction); return this.detail(id, fresh, transaction);
    });
  }

  private normalizeIds(ids: string[]): string[] {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new BadRequestException('Song IDs must be an array of UUIDs');
    const normalized = ids.map((id) => id.toLowerCase()); if (new Set(normalized).size !== normalized.length) throw new BadRequestException('Duplicate song IDs are not allowed'); return normalized;
  }
  private active(actor: Actor): void { if (actor.status !== UserStatus.ACTIVE) throw new ForbiddenException('An active account is required'); }
  private authorize(playlist: Playlist, actor: Actor, write: boolean): void {
    this.active(actor);
    if (playlist.type === PlaylistType.PERSONAL) {
      if (playlist.createdById.toLowerCase() !== actor.id.toLowerCase()) throw new ForbiddenException('Personal playlists are private to their owner');
    } else if (actor.role !== Role.ADMIN && (write || playlist.publicationStatus !== PlaylistPublicationStatus.PUBLISHED)) throw new ForbiddenException('Only published rehearsal playlists are visible to members; only administrators may modify them');
  }
  private validatePublication(type: PlaylistType, status: PlaylistPublicationStatus | undefined): void {
    if (type === PlaylistType.PERSONAL && status !== undefined) throw new BadRequestException('Publication status is only available for rehearsal playlists');
  }
  private async locked(id: string, actor: Actor, transaction: Transaction): Promise<Playlist> {
    const playlist = await this.playlists.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }); if (!playlist) throw new NotFoundException('Playlist not found'); this.authorize(playlist, actor, true); return playlist;
  }
  private current(id: string, transaction: Transaction): Promise<PlaylistSong[]> { return this.entries.findAll({ where: { playlistId: id }, order: [['position', 'ASC'], ['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE }); }
  private async setOrder(id: string, current: PlaylistSong[], ids: string[], transaction: Transaction): Promise<void> {
    if (current.length === 0) return;
    const occupied = new Set(current.map((entry) => entry.position)); let next = current.length;
    const temporary = current.map(() => { while (occupied.has(next)) next++; occupied.add(next); return next++; });
    const desired = new Map(ids.map((songId, index) => [songId, index]));
    await this.positions(id, current, temporary, transaction);
    await this.positions(id, current, current.map((entry) => desired.get(entry.songId)!), transaction);
  }
  private async positions(id: string, current: PlaylistSong[], positions: number[], transaction: Transaction): Promise<void> {
    const replacements: Record<string, string | number> = { playlistId: id };
    const tuples = current.map((entry, index) => { replacements[`id${index}`] = entry.id; replacements[`p${index}`] = positions[index]!; return `(CAST(:id${index} AS uuid), CAST(:p${index} AS integer))`; });
    // Two bound bulk updates preserve entry IDs/createdAt and avoid every immediate unique-position collision.
    await this.database.query(`UPDATE "PlaylistSong" AS ps SET "position" = v."position" FROM (VALUES ${tuples.join(',')}) AS v("id", "position") WHERE ps."id" = v."id" AND ps."playlistId" = :playlistId`, { replacements, transaction });
  }
  private async touch(playlist: Playlist, transaction: Transaction): Promise<void> { await playlist.update({ updatedAt: new Date() }, { transaction }); }
  private async detail(id: string, actor: Actor, transaction?: Transaction): Promise<PlaylistDetailResponseDto> {
    const playlist = await this.playlists.findByPk(id, { transaction, attributes: COUNTS }); if (!playlist) throw new NotFoundException('Playlist not found'); this.authorize(playlist, actor, false);
    // Check visibility before reading song contents; no lyrics or provider audio identifiers are selected.
    const entries = await this.entries.findAll({ where: { playlistId: id }, order: [['position', 'ASC'], ['id', 'ASC']], transaction, include: [{ model: Song, as: 'song', required: true, attributes: ['id', 'title', 'artistId', 'durationSeconds', 'category'], include: [{ model: Artist, as: 'artist', required: true, attributes: ['id', 'name'] }] }] });
    return { ...this.response(playlist), songs: entries.map((entry) => ({ songId: entry.songId, position: entry.position, song: { id: entry.song.id, title: entry.song.title, artistId: entry.song.artistId, artistName: entry.song.artist.name, durationSeconds: entry.song.durationSeconds, category: entry.song.category } })) };
  }
  private async write<T>(actor: Actor, work: (fresh: Actor, transaction: Transaction) => Promise<T>): Promise<T> {
    this.active(actor);
    try {
      return await this.database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
        const fresh = await this.users.findByPk(actor.id, { attributes: ['id', 'role', 'status'], transaction, lock: transaction.LOCK.KEY_SHARE });
        if (!fresh) throw new ForbiddenException('Account is unavailable'); this.active(fresh); return work(fresh, transaction);
      });
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new ConflictException('Playlist already contains a song or its order changed; refresh and retry');
      if (error instanceof ForeignKeyConstraintError) throw new ConflictException('Playlist is referenced by a rehearsal or a song reference changed');
      throw error;
    }
  }
  private response(playlist: Playlist): PlaylistResponseDto {
    return { id: playlist.id, title: playlist.title, description: playlist.description, type: playlist.type, publicationStatus: playlist.publicationStatus, createdById: playlist.createdById, songCount: Number(playlist.get('songCount')), createdAt: playlist.createdAt.toISOString(), updatedAt: playlist.updatedAt.toISOString() };
  }
}
