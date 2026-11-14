import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.query(`CREATE TABLE "SongFeaturedArtist" (
    "songId" UUID NOT NULL REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "artistId" UUID NOT NULL REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    PRIMARY KEY ("songId", "artistId"),
    UNIQUE ("songId", "position")
  ); CREATE INDEX "SongFeaturedArtist_artistId_idx" ON "SongFeaturedArtist" ("artistId");`);
}
export async function down(database: Sequelize): Promise<void> {
  await database.query('DROP TABLE "SongFeaturedArtist"');
}
