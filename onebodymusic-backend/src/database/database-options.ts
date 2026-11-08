import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { DATABASE_MODELS } from './models';

export function databaseOptions(url: string): SequelizeModuleOptions {
  return {
    dialect: 'postgres',
    uri: url,
    models: DATABASE_MODELS,
    synchronize: false,
    logging: false,
    retryAttempts: 1,
    pool: { max: 10, min: 0, acquire: 10_000, idle: 10_000 },
    dialectOptions: { connectionTimeoutMillis: 10_000 },
  };
}
