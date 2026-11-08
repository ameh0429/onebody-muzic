import { Sequelize } from 'sequelize-typescript';

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`
ALTER TABLE "Song" ADD COLUMN "audioAssetId" UUID REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Song" ADD COLUMN "coverAssetId" UUID REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Song_audioAssetId_key" ON "Song" ("audioAssetId") WHERE "audioAssetId" IS NOT NULL;
CREATE INDEX "Song_coverAssetId_idx" ON "Song" ("coverAssetId");
CREATE FUNCTION enforce_song_media_ids() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset "MediaAsset"%ROWTYPE;
BEGIN
 IF NEW."audioAssetId" IS NOT NULL THEN
  SELECT * INTO asset FROM "MediaAsset" WHERE id=NEW."audioAssetId" FOR KEY SHARE;
  IF NOT FOUND OR asset."status" <> 'READY' OR asset."kind" <> 'AUDIO' OR asset."folder" <> 'onebodymusic/audio' OR
     NEW."audioPublicId" IS DISTINCT FROM asset."publicId" OR NEW."audioResourceType" IS DISTINCT FROM asset."resourceType" THEN
   RAISE EXCEPTION 'Song audio reference is not ready or compatible' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
  END IF;
 END IF;
 IF NEW."coverAssetId" IS NOT NULL THEN
  SELECT * INTO asset FROM "MediaAsset" WHERE id=NEW."coverAssetId" FOR KEY SHARE;
  IF NOT FOUND OR asset."status" <> 'READY' OR asset."kind" <> 'IMAGE' OR asset."folder" <> 'onebodymusic/songs' OR NEW."coverImagePublicId" IS DISTINCT FROM asset."publicId" THEN
   RAISE EXCEPTION 'Song cover reference is not ready or compatible' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Song_managed_asset_ids" BEFORE INSERT OR UPDATE OF "audioAssetId", "coverAssetId", "audioPublicId", "audioResourceType", "coverImagePublicId" ON "Song" FOR EACH ROW EXECUTE FUNCTION enforce_song_media_ids();
`, { transaction });
  });
}
export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`DROP TRIGGER "Song_managed_asset_ids" ON "Song"; DROP FUNCTION enforce_song_media_ids(); DROP INDEX "Song_audioAssetId_key"; DROP INDEX "Song_coverAssetId_idx"; ALTER TABLE "Song" DROP COLUMN "audioAssetId", DROP COLUMN "coverAssetId";`, { transaction });
  });
}
