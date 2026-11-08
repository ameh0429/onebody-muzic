import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CreationAttributes, literal, Op, Transaction } from 'sequelize';
import { Album, Artist, MediaAsset, MediaKind, MediaStatus, Song } from '../database/models';

@Injectable()
export class MediaRepository {
  constructor(@InjectModel(MediaAsset) private readonly assets: typeof MediaAsset, @InjectModel(Artist) private readonly artists: typeof Artist, @InjectModel(Album) private readonly albums: typeof Album, @InjectModel(Song) private readonly songs: typeof Song, @InjectConnection() private readonly database: Sequelize) {}
  reserve(values: CreationAttributes<MediaAsset>): Promise<MediaAsset> { return this.assets.create(values); }
  async locked<T>(id: string, work: (asset: MediaAsset, transaction: Transaction) => Promise<T>, skipLocked = false): Promise<T | null> {
    return this.database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
      const asset = await this.assets.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE, skipLocked });
      return asset ? work(asset, transaction) : null;
    });
  }
  async referenced(asset: MediaAsset, transaction: Transaction): Promise<boolean> {
    if (asset.kind === MediaKind.AUDIO) return await this.songs.count({ where: { audioPublicId: asset.publicId, audioResourceType: asset.resourceType }, transaction }) > 0;
    const options = { transaction };
    // A transaction owns one pg connection; keep these checks sequential.
    if (await this.artists.count({ ...options, where: { imagePublicId: asset.publicId } }) > 0) return true;
    if (await this.albums.count({ ...options, where: { coverImagePublicId: asset.publicId } }) > 0) return true;
    return await this.songs.count({ ...options, where: { coverImagePublicId: asset.publicId } }) > 0;
  }
  async scheduleUnreferenced(id: string, transaction: Transaction): Promise<void> {
    const asset = await this.assets.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (asset?.status === MediaStatus.READY && !await this.referenced(asset, transaction)) await asset.update({ status: MediaStatus.CLEANUP_PENDING }, { transaction });
  }
  async candidates(staleSeconds: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - staleSeconds * 1000);
    const retry = new Date(Date.now() - 60000);
    const rows = await this.assets.findAll({ attributes: ['id'], where: { [Op.or]: [{ status: MediaStatus.CLEANUP_PENDING, updatedAt: { [Op.lte]: retry }, createdAt: { [Op.lte]: cutoff } }, { status: MediaStatus.UPLOADING, updatedAt: { [Op.lte]: cutoff } }] }, order: [['updatedAt', 'ASC']], limit: 20 });
    // Unattached READY records are staged uploads; expire after 24h unless linked to library records.
    const staged = await this.assets.findAll({ attributes: ['id'], where: {
      status: MediaStatus.READY, createdAt: { [Op.lte]: new Date(Date.now() - 86400000) },
      [Op.and]: literal(`NOT EXISTS (SELECT 1 FROM "Artist" a WHERE a."imagePublicId" = "MediaAsset"."publicId") AND NOT EXISTS (SELECT 1 FROM "Album" a WHERE a."coverImagePublicId" = "MediaAsset"."publicId") AND NOT EXISTS (SELECT 1 FROM "Song" s WHERE s."coverImagePublicId" = "MediaAsset"."publicId" OR (s."audioPublicId" = "MediaAsset"."publicId" AND s."audioResourceType" = "MediaAsset"."resourceType"))`),
    }, order: [['createdAt', 'ASC']], limit: 20 });
    return [...rows, ...staged].map((row) => row.id);
  }
}
