import { databaseOptions } from './database-options';
import { DATABASE_MODELS } from './models';

describe('database configuration', () => {
  it('uses PostgreSQL, registered models, bounded pooling, and migrations instead of sync', () => {
    expect(databaseOptions('postgresql://localhost/test')).toMatchObject({
      uri: 'postgresql://localhost/test', dialect: 'postgres',
      synchronize: false, logging: false, retryAttempts: 1,
      models: DATABASE_MODELS,
      pool: { max: 10, min: 0, acquire: 10000 },
    });
  });
});
