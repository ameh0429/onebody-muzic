import { IsEmail, IsString, Matches, MaxLength, MinLength, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { hash, argon2id } from 'argon2';
import { Sequelize } from 'sequelize-typescript';
import { Role, User, UserStatus } from './models';

class AdminSeedEnvironment {
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  ADMIN_NAME!: string;

  @IsEmail()
  @MaxLength(254)
  ADMIN_EMAIL!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  ADMIN_PASSWORD!: string;
}

export async function seedAdministrator(
  database: Sequelize,
  environment: Record<string, unknown>,
): Promise<'created' | 'unchanged'> {
  const settings = plainToInstance(AdminSeedEnvironment, {
    ADMIN_NAME: environment.ADMIN_NAME,
    ADMIN_EMAIL: typeof environment.ADMIN_EMAIL === 'string' ? environment.ADMIN_EMAIL.trim().toLowerCase() : environment.ADMIN_EMAIL,
    ADMIN_PASSWORD: environment.ADMIN_PASSWORD,
  });
  const errors = validateSync(settings);
  if (errors.length > 0) {
    throw new Error(`Invalid administrator seed configuration: ${errors.map((error) => error.property).join(', ')}`);
  }
  const existing = await User.findOne({ where: { email: settings.ADMIN_EMAIL } });
  if (existing) {
    if (existing.role !== Role.ADMIN || existing.status !== UserStatus.ACTIVE) {
      throw new Error('Seed email already belongs to an account that is not an active administrator; no changes made.');
    }
    return 'unchanged';
  }
  const passwordHash = await hash(settings.ADMIN_PASSWORD, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  // findOrCreate uses a transaction/savepoint and handles concurrent unique-email races.
  return database.transaction(async (transaction) => {
    const [administrator, created] = await User.findOrCreate({
      where: { email: settings.ADMIN_EMAIL },
      defaults: {
        name: settings.ADMIN_NAME.trim(), email: settings.ADMIN_EMAIL,
        passwordHash, role: Role.ADMIN, status: UserStatus.ACTIVE,
      },
      transaction,
    });
    if (administrator.role !== Role.ADMIN || administrator.status !== UserStatus.ACTIVE) {
      throw new Error('Seed email was claimed by another account; no existing account was modified.');
    }
    return created ? 'created' : 'unchanged';
  });
}
