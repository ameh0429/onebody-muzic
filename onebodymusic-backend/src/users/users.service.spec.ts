import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { Role, User, UserStatus } from '../database/models';
import { UsersService } from './users.service';
import { ListUsersDto } from './dto/list-users.dto';

function fixture(id: string, role = Role.MEMBER, status = UserStatus.ACTIVE): User {
  const value = { id, name: 'Grace', email: `${id}@example.org`, passwordHash: 'must-never-be-returned', role, status, createdAt: new Date(), updatedAt: new Date(), update: jest.fn() };
  value.update.mockImplementation(async (change: object) => Object.assign(value, change));
  return value as unknown as User;
}

describe('UsersService', () => {
  const models = { findByPk: jest.fn(), findAndCountAll: jest.fn(), count: jest.fn(), update: jest.fn() };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as unknown as Transaction;
  const database = { query: jest.fn(), transaction: jest.fn(async (_options: object, work: (t: Transaction) => Promise<unknown>) => work(transaction)) };
  let service: UsersService;
  beforeEach(() => { jest.clearAllMocks(); service = new UsersService(models as unknown as typeof User, database as unknown as Sequelize); });

  it('paginates, filters, orders deterministically and strips password hashes', async () => {
    models.findAndCountAll.mockResolvedValue({ rows: [fixture('member')], count: 5 });
    const result = await service.list({ ...new ListUsersDto(), page: 2, limit: 2, role: Role.MEMBER, status: UserStatus.ACTIVE });
    expect(models.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: { role: Role.MEMBER, status: UserStatus.ACTIVE }, offset: 2, limit: 2, order: [['createdAt', 'DESC'], ['id', 'ASC']] }));
    expect(result).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });
  it('returns empty pages without inventing results', async () => {
    models.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    expect(await service.list(new ListUsersDto())).toMatchObject({ data: [], totalPages: 0 });
  });
  it('finds a safe user or returns 404', async () => {
    models.findByPk.mockResolvedValueOnce(fixture('member')).mockResolvedValueOnce(null);
    expect(await service.findOne('member')).not.toHaveProperty('passwordHash');
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('updates only a name and returns no password hash', async () => {
    models.update.mockResolvedValue([1, [fixture('member')]]);
    expect(await service.updateName('member', 'Grace')).not.toHaveProperty('passwordHash');
    expect(models.update).toHaveBeenCalledWith({ name: 'Grace' }, { where: { id: 'member' }, returning: true });
  });
  it('returns 404 for a deleted profile', async () => {
    models.update.mockResolvedValue([0, []]);
    await expect(service.updateName('missing', 'Grace')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('forbids both self access mutations, including no-ops', async () => {
    await expect(service.updateRole('self', 'self', Role.ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateStatus('self', 'self', UserStatus.ACTIVE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateRole('abcdef', 'ABCDEF', Role.MEMBER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.transaction).not.toHaveBeenCalled();
  });
  it.each([null, fixture('actor', Role.MEMBER), fixture('actor', Role.ADMIN, UserStatus.SUSPENDED)])('rechecks actor authorization inside the transaction', async (actor) => {
    models.findByPk.mockResolvedValueOnce(actor);
    await expect(service.updateRole('actor', 'target', Role.ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('returns 404 for a missing target', async () => {
    models.findByPk.mockResolvedValueOnce(fixture('actor', Role.ADMIN)).mockResolvedValueOnce(null);
    await expect(service.updateRole('actor', 'missing', Role.ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each(['demote', 'suspend', 'pending'])('returns 409 instead of removing the last active admin: %s', async (kind) => {
    const target = fixture('target', Role.ADMIN);
    models.findByPk.mockResolvedValueOnce(fixture('actor', Role.ADMIN)).mockResolvedValueOnce(target);
    models.count.mockResolvedValue(1);
    const action = kind === 'demote' ? service.updateRole('actor', 'target', Role.MEMBER) : service.updateStatus('actor', 'target', kind === 'suspend' ? UserStatus.SUSPENDED : UserStatus.PENDING);
    await expect(action).rejects.toBeInstanceOf(ConflictException);
    expect(target.update).not.toHaveBeenCalled();
  });
  it('takes a transaction-level advisory lock before reading actors or targets', async () => {
    const target = fixture('target', Role.ADMIN);
    models.findByPk.mockResolvedValueOnce(fixture('actor', Role.ADMIN)).mockResolvedValueOnce(target);
    models.count.mockResolvedValue(2);
    const result = await service.updateRole('actor', 'target', Role.MEMBER);
    expect(result.role).toBe(Role.MEMBER);
    expect(database.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(172932, 2)', { transaction });
    expect(database.query.mock.invocationCallOrder[0]).toBeLessThan(models.findByPk.mock.invocationCallOrder[0] ?? Infinity);
    expect(target.update).toHaveBeenCalledWith({ role: Role.MEMBER }, { transaction, fields: ['role'] });
  });
  it('approves a pending account without modifying role', async () => {
    const target = fixture('target', Role.MEMBER, UserStatus.PENDING);
    models.findByPk.mockResolvedValueOnce(fixture('actor', Role.ADMIN)).mockResolvedValueOnce(target);
    expect(await service.updateStatus('actor', 'target', UserStatus.ACTIVE)).toMatchObject({ role: Role.MEMBER, status: UserStatus.ACTIVE });
    expect(models.count).not.toHaveBeenCalled();
  });
});
