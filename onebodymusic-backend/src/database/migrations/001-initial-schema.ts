import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`-- UUIDs default in PostgreSQL; Sequelize maintains updatedAt on ORM writes.
CREATE TYPE "enum_User_role" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "enum_User_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "enum_Playlist_type" AS ENUM ('PERSONAL', 'REHEARSAL');

CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "enum_User_role" NOT NULL DEFAULT 'MEMBER',
    "status" "enum_User_status" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Artist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "biography" TEXT,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Album" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "artistId" UUID NOT NULL,
    "coverImageUrl" TEXT,
    "coverImagePublicId" TEXT,
    "releaseYear" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Song" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "artistId" UUID NOT NULL,
    "albumId" UUID,
    "category" TEXT,
    "durationSeconds" INTEGER,
    "audioPublicId" TEXT NOT NULL,
    "audioResourceType" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "coverImagePublicId" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Playlist" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "enum_Playlist_type" NOT NULL DEFAULT 'PERSONAL',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistSong" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "playlistId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistSong_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rehearsal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "playlistId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Rehearsal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");
CREATE INDEX "Artist_name_idx" ON "Artist"("name");
CREATE INDEX "Album_artistId_releaseYear_idx" ON "Album"("artistId", "releaseYear");
CREATE INDEX "Album_title_idx" ON "Album"("title");
CREATE INDEX "Song_artistId_idx" ON "Song"("artistId");
CREATE INDEX "Song_albumId_idx" ON "Song"("albumId");
CREATE INDEX "Song_uploadedById_idx" ON "Song"("uploadedById");
CREATE INDEX "Song_category_createdAt_idx" ON "Song"("category", "createdAt");
CREATE INDEX "Song_title_idx" ON "Song"("title");
CREATE INDEX "Song_createdAt_idx" ON "Song"("createdAt");
CREATE INDEX "Playlist_createdById_type_idx" ON "Playlist"("createdById", "type");
CREATE INDEX "Playlist_type_createdAt_idx" ON "Playlist"("type", "createdAt");
CREATE UNIQUE INDEX "PlaylistSong_playlistId_songId_key" ON "PlaylistSong"("playlistId", "songId");
CREATE UNIQUE INDEX "PlaylistSong_playlistId_position_key" ON "PlaylistSong"("playlistId", "position");
CREATE INDEX "PlaylistSong_songId_idx" ON "PlaylistSong"("songId");
CREATE INDEX "Rehearsal_playlistId_idx" ON "Rehearsal"("playlistId");
CREATE INDEX "Rehearsal_createdById_scheduledAt_idx" ON "Rehearsal"("createdById", "scheduledAt");
CREATE INDEX "Rehearsal_scheduledAt_idx" ON "Rehearsal"("scheduledAt");

ALTER TABLE "Album" ADD CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Song" ADD CONSTRAINT "Song_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Song" ADD CONSTRAINT "Song_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Song" ADD CONSTRAINT "Song_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlaylistSong" ADD CONSTRAINT "PlaylistSong_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlaylistSong" ADD CONSTRAINT "PlaylistSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Rehearsal" ADD CONSTRAINT "Rehearsal_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Rehearsal" ADD CONSTRAINT "Rehearsal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks are intentionally maintained in SQL; keep these checks in explicit migrations.
ALTER TABLE "PlaylistSong" ADD CONSTRAINT "PlaylistSong_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "Song" ADD CONSTRAINT "Song_durationSeconds_nonnegative" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);
`, { transaction });
  });
}

export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`
DROP TABLE "Rehearsal", "PlaylistSong", "Playlist", "Song", "Album", "Artist", "User";
DROP TYPE "enum_User_role", "enum_User_status", "enum_Playlist_type";
`, { transaction });
  });
}
