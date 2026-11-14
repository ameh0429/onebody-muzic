import { Sequelize } from 'sequelize-typescript';

function deliveryConstraint(profiles: boolean): string {
  return `ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_delivery_check";
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_delivery_check" CHECK (
      ("kind"='AUDIO' AND "folder"='onebodymusic/audio' AND "resourceType"='video' AND "deliveryType"='authenticated' AND "format" IN ('mp3','m4a')) OR
      ("kind"='IMAGE' AND "folder" IN ('onebodymusic/artists','onebodymusic/albums','onebodymusic/songs'${profiles ? ",'onebodymusic/profiles'" : ''}) AND "resourceType"='image' AND "deliveryType"='upload' AND "format" IN ('jpg','png','webp'))
    );`;
}

export async function up(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    await database.query(`ALTER TABLE "User"
      ADD COLUMN "profileImageUrl" TEXT,
      ADD COLUMN "profileImageAssetId" UUID REFERENCES "MediaAsset"("id") ON DELETE RESTRICT;
      CREATE INDEX "User_profileImageAssetId_idx" ON "User" ("profileImageAssetId");
      ${deliveryConstraint(true)}
      CREATE FUNCTION enforce_profile_picture() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE asset "MediaAsset"%ROWTYPE;
      BEGIN
        IF NEW."profileImageAssetId" IS NULL THEN
          IF NEW."profileImageUrl" IS NOT NULL THEN
            RAISE EXCEPTION 'Profile picture requires a tracked asset' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
          END IF;
          RETURN NEW;
        END IF;
        SELECT * INTO asset FROM "MediaAsset" WHERE id=NEW."profileImageAssetId" FOR KEY SHARE;
        IF NOT FOUND OR asset."status" <> 'READY' OR asset."kind" <> 'IMAGE' OR asset."folder" <> 'onebodymusic/profiles'
          OR asset."uploadedById" <> NEW.id OR NEW."profileImageUrl" IS NULL THEN
          RAISE EXCEPTION 'Profile picture is not ready or compatible' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "User_managed_picture" BEFORE INSERT OR UPDATE OF "profileImageAssetId", "profileImageUrl" ON "User"
        FOR EACH ROW EXECUTE FUNCTION enforce_profile_picture();
      CREATE FUNCTION protect_profile_picture_state() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."status"='READY' AND NEW."status" IS DISTINCT FROM OLD."status"
          AND EXISTS (SELECT 1 FROM "User" WHERE "profileImageAssetId"=OLD.id) THEN
          RAISE EXCEPTION 'Profile picture is referenced' USING ERRCODE='23514', CONSTRAINT='media_reference_ready';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER "MediaAsset_protect_profile" BEFORE UPDATE OF "status" ON "MediaAsset"
        FOR EACH ROW EXECUTE FUNCTION protect_profile_picture_state();`, { transaction });
  });
}
export async function down(database: Sequelize): Promise<void> {
  await database.transaction(async (transaction) => {
    // The original delivery constraint cannot represent profile assets, including tombstones.
    await database.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM "MediaAsset" WHERE folder='onebodymusic/profiles') THEN
      RAISE EXCEPTION 'Remove profile pictures and confirm provider cleanup before reverting profile tracking'; END IF; END $$;
      DROP TRIGGER "User_managed_picture" ON "User"; DROP FUNCTION enforce_profile_picture();
      DROP TRIGGER "MediaAsset_protect_profile" ON "MediaAsset"; DROP FUNCTION protect_profile_picture_state();
      ALTER TABLE "User" DROP COLUMN "profileImageAssetId", DROP COLUMN "profileImageUrl";
      ${deliveryConstraint(false)}`, { transaction });
  });
}
