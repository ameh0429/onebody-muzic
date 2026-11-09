import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { randomUUID } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { Role, User, UserStatus } from '../database/models';
import { EnvironmentVariables } from '../config/environment';
jest.mock('argon2', () => ({ hash: jest.fn(), verify: jest.fn(), argon2id: 2 }));
describe('AuthService credential handling', () => {
  const repository = { findByEmail: jest.fn(), findCredentials: jest.fn(), findById: jest.fn(), createMember: jest.fn() }; const jwt = { signAsync: jest.fn() }; let service: AuthService;
  const user = { id: randomUUID(), name: 'Grace', email: 'grace@example.org', passwordHash: 'private-hash', role: Role.MEMBER, status: UserStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date() } as User;
  beforeEach(() => { jest.resetAllMocks(); jest.mocked(hash).mockResolvedValue('hashed-password'); jest.mocked(verify).mockResolvedValue(true); repository.findCredentials.mockResolvedValue(user); repository.findById.mockResolvedValue(user); repository.createMember.mockResolvedValue({ ...user, status: UserStatus.PENDING }); jwt.signAsync.mockResolvedValue('signed-token'); service = new AuthService(repository as unknown as AuthRepository, jwt as unknown as JwtService, new ConfigService<EnvironmentVariables, true>({ JWT_ACCESS_TOKEN_TTL_SECONDS: 900 })); });
  it('normalizes registration, hashes credentials and returns only safe pending user fields', async () => {
    const result = await service.register({ name: ' Grace ', email: ' GRACE@EXAMPLE.ORG ', password: 'secret-password', confirmPassword: 'secret-password' });
    expect(repository.createMember).toHaveBeenCalledWith('Grace', 'grace@example.org', 'hashed-password'); expect(result.status).toBe(UserStatus.PENDING); expect(result).not.toHaveProperty('passwordHash'); expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(hash).toHaveBeenCalledWith('secret-password', expect.objectContaining({ type: 2, memoryCost: 19456 }));
  });
  it('handles existing and racing duplicate registrations', async () => {
    const dto = { name: 'Grace', email: user.email, password: 'password', confirmPassword: 'password' };
    repository.findByEmail.mockResolvedValue(user); await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException); expect(hash).not.toHaveBeenCalled();
    repository.findByEmail.mockResolvedValue(null); repository.createMember.mockRejectedValue(new UniqueConstraintError({ errors: [] })); await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException);
  });
  it('uses generic credential failures for unknown emails, bad passwords, corrupt hashes and inactive accounts', async () => {
    const dto = { email: user.email, password: 'wrong' };
    repository.findCredentials.mockResolvedValue(null); await expect(service.login(dto)).rejects.toThrow('Invalid email or password'); expect(hash).toHaveBeenCalled();
    repository.findCredentials.mockResolvedValue(user); jest.mocked(verify).mockResolvedValue(false); await expect(service.login(dto)).rejects.toThrow('Invalid email or password');
    jest.mocked(verify).mockRejectedValue(new Error('sensitive hash error')); await expect(service.login(dto)).rejects.toThrow('Invalid email or password');
    jest.mocked(verify).mockResolvedValue(true);
    for (const status of [UserStatus.PENDING, UserStatus.SUSPENDED]) { repository.findCredentials.mockResolvedValue({ ...user, status }); await expect(service.login(dto)).rejects.toThrow('Invalid email or password'); }
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it('issues a minimal token and never returns a password hash', async () => {
    const result = await service.login({ email: ' GRACE@EXAMPLE.ORG ', password: 'correct' }); expect(repository.findCredentials).toHaveBeenCalledWith(user.email); expect(jwt.signAsync).toHaveBeenCalledWith({ sub: user.id }); expect(result.expiresIn).toBe(900); expect(result.user).not.toHaveProperty('passwordHash');
  });
  it('rejects deleted and newly suspended users when verifying a token subject', async () => {
    for (const record of [null, { ...user, status: UserStatus.SUSPENDED }]) { repository.findById.mockResolvedValue(record); await expect(service.authenticateTokenSubject(user.id)).rejects.toBeInstanceOf(UnauthorizedException); }
  });
});
