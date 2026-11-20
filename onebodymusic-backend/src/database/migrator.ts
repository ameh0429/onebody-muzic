import { up as emailUp, down as emailDown } from './migrations/013-email-notifications';
import { up as notificationsUp, down as notificationsDown } from './migrations/012-notifications';
import { up as featuredUp, down as featuredDown } from './migrations/011-song-featured-artists';
import { up as sessionsUp, down as sessionsDown } from './migrations/010-refresh-sessions';
import { up as profilePictureUp, down as profilePictureDown } from './migrations/009-user-profile-picture';
import { up as rateLimitUp, down as rateLimitDown } from './migrations/008-auth-rate-limit';
import { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';
import { up as artistNamesUp, down as artistNamesDown } from './migrations/002-artist-name-uniqueness';
import { up as albumsUp, down as albumsDown } from './migrations/003-album-constraints';
import { up as mediaUp, down as mediaDown } from './migrations/004-media-assets';
import { up as songsUp, down as songsDown } from './migrations/005-song-media-assets';
import { up as lyricsUp, down as lyricsDown } from './migrations/006-song-lyrics';
import { up as playlistsUp, down as playlistsDown } from './migrations/007-playlist-publication';
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
    }, {
      name: '004-media-assets',
      up: ({ context }) => mediaUp(context),
      down: ({ context }) => mediaDown(context),
    }, {
      name: '005-song-media-assets',
      up: ({ context }) => songsUp(context),
      down: ({ context }) => songsDown(context),
    }, {
      name: '006-song-lyrics',
      up: ({ context }) => lyricsUp(context),
      down: ({ context }) => lyricsDown(context),
    }, {
      name: '007-playlist-publication',
      up: ({ context }) => playlistsUp(context),
      down: ({ context }) => playlistsDown(context),
    }, {
      name: '008-auth-rate-limit',
      up: ({ context }) => rateLimitUp(context),
      down: ({ context }) => rateLimitDown(context),
    }, {
      name: '009-user-profile-picture',
      up: ({ context }) => profilePictureUp(context),
      down: ({ context }) => profilePictureDown(context),
    }, {
      name: '010-refresh-sessions',
      up: ({ context }) => sessionsUp(context),
      down: ({ context }) => sessionsDown(context),
    }, {
      name: '011-song-featured-artists',
      up: ({ context }) => featuredUp(context),
      down: ({ context }) => featuredDown(context),
    }, { name: '012-notifications', up: ({ context }) => notificationsUp(context), down: ({ context }) => notificationsDown(context) },
      { name: '013-email-notifications', up: ({ context }) => emailUp(context), down: ({ context }) => emailDown(context) }],
    storage: new SequelizeStorage({ sequelize: database, tableName: 'SequelizeMeta' }),
    logger: undefined,
  });
}
