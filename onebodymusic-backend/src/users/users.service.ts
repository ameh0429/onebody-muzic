import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction, WhereOptions } from 'sequelize';
import { Role, User, UserStatus } from '../database/models';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UsersPageDto } from './dto/users-page.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly users: typeof User,
    @InjectConnection() private readonly database: Sequelize,
  ) {}

  async list(query: ListUsersDto): Promise<UsersPageDto> {
    const where: WhereOptions<User> = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    const { rows, count } = await this.users.findAndCountAll({
      where, limit: query.limit, offset: (query.page - 1) * query.limit,
      order: [['createdAt', 'DESC'], ['id', 'ASC']],
    });
    return { data: rows.map((user) => this.sanitize(user)), page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.users.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async updateName(id: string, name: string): Promise<UserResponseDto> {
    // Update only the requested field; do not save a stale role/status from the JWT request.
    const [, rows] = await this.users.update({ name }, { where: { id }, returning: true });
    const user = rows[0];
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  updateStatus(actorId: string, targetId: string, status: UserStatus): Promise<UserResponseDto> {
    return this.changeAccess(actorId, targetId, { status });
  }

  updateRole(actorId: string, targetId: string, role: Role): Promise<UserResponseDto> {
    return this.changeAccess(actorId, targetId, { role });
  }

  private async changeAccess(actorId: string, targetId: string, change: { role?: Role; status?: UserStatus }): Promise<UserResponseDto> {
    if (actorId.toLowerCase() === targetId.toLowerCase()) throw new ForbiddenException('You cannot change your own role or status');
    return this.database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
      // Serialize every role/status change across all API instances. Acquire before reading state.
      await this.database.query('SELECT pg_advisory_xact_lock(172932, 2)', { transaction });
      const actor = await this.users.findByPk(actorId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!actor || actor.role !== Role.ADMIN || actor.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException('An active administrator is required');
      }
      const target = await this.users.findByPk(targetId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!target) throw new NotFoundException('User not found');
      const remainsActiveAdmin = (change.role ?? target.role) === Role.ADMIN && (change.status ?? target.status) === UserStatus.ACTIVE;
      if (target.role === Role.ADMIN && target.status === UserStatus.ACTIVE && !remainsActiveAdmin) {
        const count = await this.users.count({ where: { role: Role.ADMIN, status: UserStatus.ACTIVE }, transaction });
        if (count <= 1) throw new ConflictException('Cannot remove the last active administrator');
      }
      await target.update(change, { transaction, fields: change.role !== undefined ? ['role'] : ['status'] });
      return this.sanitize(target);
    });
  }

  private sanitize(user: User): UserResponseDto {
    return {
      id: user.id, name: user.name, email: user.email, role: user.role, status: user.status,
      profileImageUrl: user.profileImageUrl ?? null,
      createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(),
    };
  }
}
