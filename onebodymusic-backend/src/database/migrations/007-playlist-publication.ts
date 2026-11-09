import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`CREATE TYPE "enum_Playlist_publicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');
ALTER TABLE "Playlist" ADD COLUMN "publicationStatus" "enum_Playlist_publicationStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_personal_private_check" CHECK ("type"='REHEARSAL' OR "publicationStatus"='DRAFT');
CREATE INDEX "Playlist_publication_visibility_idx" ON "Playlist" ("type", "publicationStatus", "createdAt");`, { transaction });
  });
}
export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query('DROP INDEX "Playlist_publication_visibility_idx"; ALTER TABLE "Playlist" DROP COLUMN "publicationStatus"; DROP TYPE "enum_Playlist_publicationStatus";', { transaction });
  });
}
