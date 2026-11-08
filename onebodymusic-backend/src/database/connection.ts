import { Sequelize } from 'sequelize-typescript';
import { databaseOptions } from './database-options';

export function createDatabase(url: string): Sequelize {
  const { uri, ...options } = databaseOptions(url);
  if (!uri) throw new Error('DATABASE_URL is required.');
  return new Sequelize(uri, options);
}
