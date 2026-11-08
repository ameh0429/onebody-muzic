import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`
CREATE TYPE "enum_MediaAsset_kind" AS ENUM ('AUDIO', 'IMAGE');
CREATE TYPE "enum_MediaAsset_status" AS ENUM ('UPLOADING', 'READY', 'CLEANUP_PENDING', 'DELETED');
CREATE TABLE "MediaAsset" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "kind" "enum_MediaAsset_kind" NOT NULL,
 "status" "enum_MediaAsset_status" NOT NULL DEFAULT 'UPLOADING',
 "folder" TEXT NOT NULL, "publicId" TEXT NOT NULL, "resourceType" TEXT NOT NULL, "deliveryType" TEXT NOT NULL,
 "format" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "bytes" INTEGER NOT NULL CHECK ("bytes" > 0),
 "duration" DOUBLE PRECISION, "width" INTEGER, "height" INTEGER,
 "uploadedById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "MediaAsset_storage_key_check" CHECK ("publicId" = "folder" || '/' || "id"::text),
 CONSTRAINT "MediaAsset_delivery_check" CHECK (
   ("kind"='AUDIO' AND "folder"='onebodymusic/audio' AND "resourceType"='video' AND "deliveryType"='authenticated' AND "format" IN ('mp3','m4a')) OR
   ("kind"='IMAGE' AND "folder" IN ('onebodymusic/artists','onebodymusic/albums','onebodymusic/songs') AND "resourceType"='image' AND "deliveryType"='upload' AND "format" IN ('jpg','png','webp'))
 )
);
CREATE UNIQUE INDEX "MediaAsset_publicId_key" ON "MediaAsset" ("publicId");
CREATE INDEX "MediaAsset_status_updatedAt_idx" ON "MediaAsset" ("status", "updatedAt");
CREATE INDEX "MediaAsset_uploadedById_idx" ON "MediaAsset" ("uploadedById");
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset" ("createdAt");

-- Serialize managed media attachment against deletion without requiring changes to legacy reference columns.
CREATE FUNCTION enforce_managed_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key TEXT; asset "MediaAsset"%ROWTYPE;
BEGIN
 key := to_jsonb(NEW)->>TG_ARGV[0];
 IF key IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO asset FROM "MediaAsset" WHERE "publicId"=key FOR KEY SHARE;
 IF FOUND AND (asset."status" <> 'READY' OR asset."kind"::text <> TG_ARGV[1] OR asset."folder" <> TG_ARGV[2]
     OR (TG_ARGV[1]='AUDIO' AND (to_jsonb(NEW)->>'audioResourceType') IS DISTINCT FROM asset."resourceType")) THEN
   RAISE EXCEPTION 'Managed media reference is not ready or is incompatible' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Artist_managed_image" BEFORE INSERT OR UPDATE OF "imagePublicId" ON "Artist" FOR EACH ROW EXECUTE FUNCTION enforce_managed_media_reference('imagePublicId','IMAGE','onebodymusic/artists');
CREATE TRIGGER "Album_managed_image" BEFORE INSERT OR UPDATE OF "coverImagePublicId" ON "Album" FOR EACH ROW EXECUTE FUNCTION enforce_managed_media_reference('coverImagePublicId','IMAGE','onebodymusic/albums');
CREATE TRIGGER "Song_managed_image" BEFORE INSERT OR UPDATE OF "coverImagePublicId" ON "Song" FOR EACH ROW EXECUTE FUNCTION enforce_managed_media_reference('coverImagePublicId','IMAGE','onebodymusic/songs');
CREATE TRIGGER "Song_managed_audio" BEFORE INSERT OR UPDATE OF "audioPublicId", "audioResourceType" ON "Song" FOR EACH ROW EXECUTE FUNCTION enforce_managed_media_reference('audioPublicId','AUDIO','onebodymusic/audio');

CREATE FUNCTION protect_managed_media_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."publicId",NEW."folder",NEW."resourceType",NEW."deliveryType",NEW."kind",NEW."uploadedById") IS DISTINCT FROM
    (OLD."publicId",OLD."folder",OLD."resourceType",OLD."deliveryType",OLD."kind",OLD."uploadedById") THEN
   RAISE EXCEPTION 'Media storage identity is immutable' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
 END IF;
 IF NEW."status" IS DISTINCT FROM OLD."status" THEN
   IF NOT ((OLD."status"='UPLOADING' AND NEW."status" IN ('READY','CLEANUP_PENDING')) OR
           (OLD."status"='READY' AND NEW."status"='CLEANUP_PENDING') OR
           (OLD."status"='CLEANUP_PENDING' AND NEW."status"='DELETED')) THEN
     RAISE EXCEPTION 'Invalid media state transition' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
   END IF;
   IF OLD."status"='READY' AND (
     EXISTS (SELECT 1 FROM "Artist" WHERE "imagePublicId"=OLD."publicId") OR
     EXISTS (SELECT 1 FROM "Album" WHERE "coverImagePublicId"=OLD."publicId") OR
     EXISTS (SELECT 1 FROM "Song" WHERE "coverImagePublicId"=OLD."publicId" OR ("audioPublicId"=OLD."publicId" AND "audioResourceType"=OLD."resourceType"))
   ) THEN
     RAISE EXCEPTION 'Managed media is referenced' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION protect_media_tracking_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD."status" <> 'DELETED' THEN
 RAISE EXCEPTION 'Confirm remote deletion before removing media tracking' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
END IF; RETURN OLD; END $$;
CREATE TRIGGER "MediaAsset_protect_delete" BEFORE DELETE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION protect_media_tracking_delete();
CREATE TRIGGER "MediaAsset_protect_state" BEFORE UPDATE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION protect_managed_media_state();
`, { transaction });
  });
}

export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "MediaAsset" WHERE "status" <> 'DELETED') THEN
  RAISE EXCEPTION 'Clean up all media assets before reverting their tracking schema'; END IF; END $$;
DROP TRIGGER "Artist_managed_image" ON "Artist";
DROP TRIGGER "Album_managed_image" ON "Album";
DROP TRIGGER "Song_managed_image" ON "Song";
DROP TRIGGER "Song_managed_audio" ON "Song";
DROP FUNCTION enforce_managed_media_reference();
DROP TABLE "MediaAsset";
DROP FUNCTION protect_managed_media_state();
DROP FUNCTION protect_media_tracking_delete();
DROP TYPE "enum_MediaAsset_kind", "enum_MediaAsset_status";
`, { transaction });
  });
}
