import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ForeignKeyConstraintError, UniqueConstraintError } from 'sequelize';
import { verify } from 'argon2';
import { createDatabase } from '../src/database/connection';
import { createMigrator } from '../src/database/migrator';
import { seedAdministrator } from '../src/database/seed-admin';
import { Album, Artist, Playlist, PlaylistSong, PlaylistType, Rehearsal, Role, Song, User, UserStatus } from '../src/database/models';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated PostgreSQL database.');

test('PostgreSQL schema, relations, safe serialization, and administrator seed', async (t) => {
  const db = createDatabase(url);
  const suffix = randomUUID();
  const adminEmail = `admin-${suffix}@example.org`;
  const memberEmail = `member-${suffix}@example.org`;
  const password = randomUUID() + randomUUID();
  let artist: Artist | undefined;
  let album: Album | undefined;
  let playlist: Playlist | undefined;
  let rehearsal: Rehearsal | undefined;
  let song: Song | undefined;
  let secondSong: Song | undefined;
  try {
    await db.authenticate();
    await t.test('connects and reports an applied, repeatable migration', async () => {
      const migrator = createMigrator(db);
      assert.deepEqual((await migrator.executed()).map((migration) => migration.name), ['001-initial-schema', '002-artist-name-uniqueness', '003-album-constraints', '004-media-assets', '005-song-media-assets', '006-song-lyrics', '007-playlist-publication', '008-auth-rate-limit']);
      assert.equal((await migrator.up()).length, 0);
    });
    const environment = { ADMIN_NAME: 'Integration Administrator', ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: password };
    await t.test('validates seed settings before writing', async () => {
      await assert.rejects(seedAdministrator(db, { ...environment, ADMIN_PASSWORD: 'short' }), /ADMIN_PASSWORD/);
      assert.equal(await User.count({ where: { email: adminEmail } }), 0);
    });
    await t.test('hashes credentials, normalizes email, and leaves reruns unchanged', async () => {
      assert.equal(await seedAdministrator(db, { ...environment, ADMIN_EMAIL: ` ${adminEmail.toUpperCase()} ` }), 'created');
      const administrator = await User.findOne({ where: { email: adminEmail }, rejectOnEmpty: true });
      assert.equal(administrator.passwordHash, undefined);
      const before = await User.unscoped().findOne({ where: { email: adminEmail }, rejectOnEmpty: true });
      assert.equal(await verify(before.passwordHash, password), true);
      assert.equal(JSON.stringify(before).includes('passwordHash'), false);
      assert.equal(await seedAdministrator(db, { ...environment, ADMIN_PASSWORD: randomUUID() }), 'unchanged');
      const after = await User.unscoped().findOne({ where: { email: adminEmail }, rejectOnEmpty: true });
      assert.equal(before.passwordHash, after.passwordHash);
      assert.equal(before.updatedAt.toISOString(), after.updatedAt.toISOString());
      assert.equal(await User.count({ where: { email: adminEmail } }), 1);
    });
    const member = await User.create({ name: 'Member', email: memberEmail, passwordHash: 'test-fixture-only' });
    await t.test('never promotes members, reactivates suspended admins, or duplicates email', async () => {
      await assert.rejects(seedAdministrator(db, { ...environment, ADMIN_EMAIL: memberEmail }), /not an active administrator/);
      await member.reload();
      assert.equal(member.role, Role.MEMBER);
      assert.equal(member.status, UserStatus.PENDING);
      assert.equal(JSON.stringify(member).includes('passwordHash'), false);
      await assert.rejects(User.create({ name: 'Duplicate', email: memberEmail, passwordHash: 'test-fixture-only' }), UniqueConstraintError);
      await User.update({ status: UserStatus.SUSPENDED }, { where: { email: adminEmail } });
      await assert.rejects(seedAdministrator(db, environment), /not an active administrator/);
      await User.update({ status: UserStatus.ACTIVE }, { where: { email: adminEmail } });
    });
    await t.test('handles concurrent seed attempts without resetting credentials', async () => {
      const email = `race-${suffix}@example.org`;
      try {
        const results = await Promise.all([seedAdministrator(db, { ...environment, ADMIN_EMAIL: email }), seedAdministrator(db, { ...environment, ADMIN_EMAIL: email })]);
        assert.equal(results.filter((result) => result === 'created').length, 1);
        assert.equal(await User.count({ where: { email } }), 1);
      } finally { await User.destroy({ where: { email } }); }
    });
    artist = await Artist.create({ name: `Artist ${suffix}` });
    album = await Album.create({ title: 'Album', artistId: artist.id });
    song = await Song.create({ title: 'Song', artistId: artist.id, albumId: album.id, uploadedById: member.id, audioPublicId: suffix, audioResourceType: 'video' });
    secondSong = await Song.create({ title: 'Second song', artistId: artist.id, uploadedById: member.id, audioPublicId: `${suffix}-2`, audioResourceType: 'video' });
    playlist = await Playlist.create({ title: 'Playlist', createdById: member.id, type: PlaylistType.REHEARSAL });
    await PlaylistSong.create({ playlistId: playlist.id, songId: song.id, position: 0 });
    await t.test('prevents duplicate songs, duplicate positions, negative positions, and invalid foreign keys', async () => {
      assert.ok(playlist && song && secondSong);
      await assert.rejects(PlaylistSong.create({ playlistId: playlist.id, songId: song.id, position: 1 }), UniqueConstraintError);
      await assert.rejects(PlaylistSong.create({ playlistId: playlist.id, songId: secondSong.id, position: 0 }), UniqueConstraintError);
      await assert.rejects(PlaylistSong.create({ playlistId: randomUUID(), songId: song.id, position: 0 }), ForeignKeyConstraintError);
      await assert.rejects(PlaylistSong.update({ position: -1 }, { where: { playlistId: playlist.id } }));
      await assert.rejects(Song.update({ durationSeconds: -1 }, { where: { id: song.id } }));
    });
    rehearsal = await Rehearsal.create({ title: 'Rehearsal', scheduledAt: new Date(), playlistId: playlist.id, createdById: member.id });
    await t.test('loads named associations without leaking nested user password hashes', async () => {
      assert.ok(playlist);
      const result = await Playlist.findByPk(playlist.id, { include: [{ model: User, as: 'createdBy' }, { model: PlaylistSong, as: 'songs', include: [{ model: Song, as: 'song' }] }], rejectOnEmpty: true });
      assert.equal(result.createdBy?.id, member.id);
      assert.equal(result.songs?.length, 1);
      assert.equal(JSON.stringify(result).includes('passwordHash'), false);
    });
    await t.test('restricts referenced owners, artists, source songs, and rehearsal playlists', async () => {
      assert.ok(artist && song && playlist);
      await assert.rejects(member.destroy(), ForeignKeyConstraintError);
      await assert.rejects(artist.destroy(), ForeignKeyConstraintError);
      await assert.rejects(song.destroy(), ForeignKeyConstraintError);
      await assert.rejects(playlist.destroy(), ForeignKeyConstraintError);
    });
    await t.test('restricts populated album deletion and cascades playlist entries', async () => {
      assert.ok(album && song && rehearsal && playlist);
      await assert.rejects(album.destroy(), ForeignKeyConstraintError);
      await song.update({ albumId: null });
      await album.destroy(); album = undefined;
      await song.reload();
      assert.equal(song.albumId, null);
      await rehearsal.destroy(); rehearsal = undefined;
      const playlistId = playlist.id;
      await playlist.destroy(); playlist = undefined;
      assert.equal(await PlaylistSong.count({ where: { playlistId } }), 0);
    });
  } finally {
    if (rehearsal) await rehearsal.destroy();
    if (playlist) await playlist.destroy();
    if (secondSong) await secondSong.destroy();
    if (song) await song.destroy();
    if (album) await album.destroy();
    if (artist) await artist.destroy();
    await User.destroy({ where: { email: [adminEmail, memberEmail] } });
    await db.close();
  }
  await t.test('closes its connection pool', async () => {
    await assert.rejects(db.authenticate(), /closed/);
  });
});
