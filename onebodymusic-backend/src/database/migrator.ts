import { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';
import { up as artistNamesUp, down as artistNamesDown } from './migrations/002-artist-name-uniqueness';
import { up as albumsUp, down as albumsDown } from './migrations/003-album-constraints';
import { up, down } from './migrations/001-initial-schema';

export function createMigrator(database: Sequelize): Umzug<Sequelize> {
  return new Umzug({
    context: database,
    migrations: [{
      name: '001-initial-schema',
      up: ({ context }) => up(context),
      down: ({ context }) => down(context),
    }, {
      name: '002-artist-name-uniqueness',
      up: ({ context }) => artistNamesUp(context),
      down: ({ context }) => artistNamesDown(context),
    }, {
      name: '003-album-constraints',
      up: ({ context }) => albumsUp(context),
      down: ({ context }) => albumsDown(context),
    }],
    storage: new SequelizeStorage({ sequelize: database, tableName: 'SequelizeMeta' }),
    logger: undefined,
  });
}
