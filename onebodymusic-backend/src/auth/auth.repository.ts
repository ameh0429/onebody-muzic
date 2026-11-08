import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Role, User, UserStatus } from '../database/models';

@Injectable()
export class AuthRepository {
  constructor(@InjectModel(User) private readonly users: typeof User) {}

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  findCredentials(email: string): Promise<User | null> {
    // Only credential verification deliberately bypasses the password-excluding default scope.
    return this.users.unscoped().findOne({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.users.findByPk(id);
  }

  createMember(name: string, email: string, passwordHash: string): Promise<User> {
    return this.users.create({ name, email, passwordHash, role: Role.MEMBER, status: UserStatus.PENDING });
  }
}
