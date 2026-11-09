import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { ForeignKeyConstraintError, Op, Transaction, WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Playlist, PlaylistPublicationStatus, PlaylistType, Rehearsal, Role, User, UserStatus } from '../database/models';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { PlaylistsService } from '../playlists/playlists.service';
import { CreateRehearsalDto } from './dto/create-rehearsal.dto';
import { UpdateRehearsalDto } from './dto/update-rehearsal.dto';
import { ListRehearsalsDto, RehearsalPeriod } from './dto/list-rehearsals.dto';
import { RehearsalDetailResponseDto, RehearsalResponseDto, RehearsalsPageDto } from './dto/rehearsal-response.dto';
type Actor = Pick<UserResponseDto, 'id' | 'role' | 'status'>;

@Injectable()
export class RehearsalsService {
  constructor(@InjectModel(Rehearsal) private readonly rehearsals: typeof Rehearsal, @InjectModel(Playlist) private readonly playlists: typeof Playlist, @InjectModel(User) private readonly users: typeof User, @InjectConnection() private readonly database: Sequelize, private readonly playlistDetails: PlaylistsService) {}

  create(dto: CreateRehearsalDto, actor: Actor): Promise<RehearsalDetailResponseDto> {
    return this.write(actor, async (fresh, transaction) => {
      await this.validatePlaylist(dto.playlistId, transaction);
      const rehearsal = await this.rehearsals.create({ title: dto.title, description: dto.description ?? null, scheduledAt: this.date(dto.scheduledAt), playlistId: dto.playlistId, createdById: fresh.id }, { transaction });
      return this.detail(rehearsal.id, fresh, transaction);
    });
  }
  async list(query: ListRehearsalsDto, actor: Actor): Promise<RehearsalsPageDto> {
    this.active(actor); const where: WhereOptions<Rehearsal> = {}; const now = new Date();
    if (query.period) where.scheduledAt = query.period === RehearsalPeriod.UPCOMING ? { [Op.gte]: now } : { [Op.lt]: now };
    const { rows, count } = await this.rehearsals.findAndCountAll({ where, include: [this.visiblePlaylist(actor)], limit: query.limit, offset: (query.page - 1) * query.limit, order: [['scheduledAt', query.period === RehearsalPeriod.PAST ? 'DESC' : 'ASC'], ['id', 'ASC']] });
    return { data: rows.map((row) => this.response(row)), page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) };
  }
  findOne(id: string, actor: Actor): Promise<RehearsalDetailResponseDto> {
    this.active(actor);
    return this.database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, (transaction) => this.detail(id, actor, transaction));
  }
  update(id: string, dto: UpdateRehearsalDto, actor: Actor): Promise<RehearsalDetailResponseDto> {
    if (!Object.keys(dto).length) throw new BadRequestException('Provide at least one rehearsal field');
    return this.write(actor, async (fresh, transaction) => {
      const rehearsal = await this.locked(id, transaction);
      await this.validatePlaylist(dto.playlistId ?? rehearsal.playlistId, transaction);
      const changes: { title?: string; description?: string | null; scheduledAt?: Date; playlistId?: string } = {};
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.description !== undefined) changes.description = dto.description;
      if (dto.scheduledAt !== undefined) changes.scheduledAt = this.date(dto.scheduledAt);
      if (dto.playlistId !== undefined) changes.playlistId = dto.playlistId;
      await rehearsal.update(changes, { transaction }); return this.detail(id, fresh, transaction);
    });
  }
  remove(id: string, actor: Actor): Promise<void> {
    return this.write(actor, async (_fresh, transaction) => { const rehearsal = await this.locked(id, transaction); await rehearsal.destroy({ transaction }); });
  }
  private active(actor: Actor): void { if (actor.status !== UserStatus.ACTIVE) throw new ForbiddenException('Active account required'); }
  private admin(actor: Actor): void { this.active(actor); if (actor.role !== Role.ADMIN) throw new ForbiddenException('Administrator required'); }
  private date(value: string): Date { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new BadRequestException('Invalid scheduledAt timestamp'); return date; }
  private visiblePlaylist(actor: Actor) {
    return { model: Playlist, as: 'playlist', required: true, attributes: ['id', 'title', 'publicationStatus'], where: { type: PlaylistType.REHEARSAL, ...(actor.role === Role.ADMIN ? {} : { publicationStatus: PlaylistPublicationStatus.PUBLISHED }) } };
  }
  private async detail(id: string, actor: Actor, transaction: Transaction): Promise<RehearsalDetailResponseDto> {
    this.active(actor);
    const row = await this.rehearsals.findByPk(id, { include: [this.visiblePlaylist(actor)], transaction });
    if (!row) throw new NotFoundException('Rehearsal not found or unavailable');
    return { ...this.response(row), playlist: await this.playlistDetails.findOne(row.playlistId, actor, transaction) };
  }
  private async validatePlaylist(id: string, transaction: Transaction): Promise<void> {
    const playlist = await this.playlists.findByPk(id, { transaction, lock: transaction.LOCK.SHARE });
    if (!playlist) throw new NotFoundException('Playlist not found');
    if (playlist.type !== PlaylistType.REHEARSAL) throw new BadRequestException('Rehearsals require a REHEARSAL playlist');
  }
  private async locked(id: string, transaction: Transaction): Promise<Rehearsal> {
    const row = await this.rehearsals.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }); if (!row) throw new NotFoundException('Rehearsal not found'); return row;
  }
  private async write<T>(actor: Actor, work: (fresh: Actor, transaction: Transaction) => Promise<T>): Promise<T> {
    this.admin(actor);
    try {
      return await this.database.transaction(async (transaction) => {
        const fresh = await this.users.findByPk(actor.id, { attributes: ['id', 'role', 'status'], transaction, lock: transaction.LOCK.SHARE });
        if (!fresh) throw new ForbiddenException('Account unavailable'); this.admin(fresh); return work(fresh, transaction);
      });
    } catch (error: unknown) { if (error instanceof ForeignKeyConstraintError) throw new ConflictException('Rehearsal reference changed; refresh and retry'); throw error; }
  }
  private response(row: Rehearsal): RehearsalResponseDto {
    return { id: row.id, title: row.title, description: row.description, scheduledAt: row.scheduledAt.toISOString(), playlistId: row.playlistId, createdById: row.createdById, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), playlist: { id: row.playlist.id, title: row.playlist.title, publicationStatus: row.playlist.publicationStatus } };
  }
}
