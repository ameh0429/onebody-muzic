import { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';
import { up, down } from './migrations/001-initial-schema';

export function createMigrator(database: Sequelize): Umzug<Sequelize> {
  return new Umzug({
    context: database,
    migrations: [{
      name: '001-initial-schema',
      up: ({ context }) => up(context),
      down: ({ context }) => down(context),
    }],
    storage: new SequelizeStorage({ sequelize: database, tableName: 'SequelizeMeta' }),
    logger: undefined,
  });
}
