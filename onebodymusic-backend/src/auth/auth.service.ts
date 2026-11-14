import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UniqueConstraintError } from 'sequelize';
import { argon2id, hash, verify } from 'argon2';
import { EnvironmentVariables } from '../config/environment';
import { User, UserStatus } from '../database/models';
import { AuthRepository } from './auth.repository';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { LoginResponseDto } from './dto/login-response.dto';

const HASH_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repository.findByEmail(email)) throw new ConflictException('Email is already registered');
    const passwordHash = await hash(dto.password, HASH_OPTIONS);
    try {
      const user = await this.repository.createMember(dto.name.trim(), email, passwordHash);
      return this.sanitize(user);
    } catch (error: unknown) {
      // The database unique index is authoritative for concurrent registration attempts.
      if (error instanceof UniqueConstraintError) throw new ConflictException('Email is already registered');
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.repository.findCredentials(dto.email.trim().toLowerCase());
    let valid = false;
    if (user) {
      try { valid = await verify(user.passwordHash, dto.password); } catch { valid = false; }
    } else {
      // Perform the same costly operation for unknown emails to reduce timing differences.
      await hash(dto.password, HASH_OPTIONS);
    }
    if (!user || !valid || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
      user: this.sanitize(user),
    };
  }

  async authenticateTokenSubject(id: string): Promise<UserResponseDto> {
    const user = await this.repository.findById(id);
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Unauthorized');
    return this.sanitize(user);
  }

  async issueSessionResponse(id: string): Promise<LoginResponseDto> {
    const user = await this.authenticateTokenSubject(id);
    return { accessToken: await this.jwt.signAsync({ sub: id }), tokenType: 'Bearer', expiresIn: this.config.get('JWT_ACCESS_TOKEN_TTL_SECONDS', { infer: true }), user };
  }

  private sanitize(user: User): UserResponseDto {
    return {
      id: user.id, name: user.name, email: user.email, role: user.role, status: user.status,
      profileImageUrl: user.profileImageUrl ?? null,
      createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(),
    };
  }
}
