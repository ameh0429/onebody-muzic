import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query('ALTER TABLE "Song" ADD COLUMN "lyrics" TEXT; ALTER TABLE "Song" ADD CONSTRAINT "Song_lyrics_length_check" CHECK ("lyrics" IS NULL OR char_length("lyrics") <= 50000);', { transaction });
  });
}
export async function down(database: Sequelize): Promise<void> {
  await database.query('ALTER TABLE "Song" DROP COLUMN "lyrics"');
}
