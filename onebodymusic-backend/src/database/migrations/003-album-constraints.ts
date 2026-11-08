import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    // Existing duplicates fail safely; no records or references are silently modified.
    await database.query(`
CREATE UNIQUE INDEX "Album_artist_normalized_title_key" ON "Album"
  ("artistId", lower(btrim(regexp_replace("title", '[[:space:]]+', ' ', 'g'))));
CREATE INDEX "Album_releaseYear_idx" ON "Album" ("releaseYear");
ALTER TABLE "Song" DROP CONSTRAINT "Song_albumId_fkey";
ALTER TABLE "Song" ADD CONSTRAINT "Song_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
`, { transaction });
  });
}

export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`
DROP INDEX "Album_artist_normalized_title_key";
DROP INDEX "Album_releaseYear_idx";
ALTER TABLE "Song" DROP CONSTRAINT "Song_albumId_fkey";
ALTER TABLE "Song" ADD CONSTRAINT "Song_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`, { transaction });
  });
}
