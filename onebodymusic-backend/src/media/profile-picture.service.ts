import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { MediaAsset, MediaKind, MediaStatus, User, UserStatus } from '../database/models';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { CloudinaryClient } from './cloudinary.client';
import { MediaService } from './media.service';

@Injectable()
export class ProfilePictureService {
  constructor(@InjectModel(User) private readonly users: typeof User,
    @InjectModel(MediaAsset) private readonly assets: typeof MediaAsset,
    @InjectConnection() private readonly database: Sequelize,
    private readonly media: MediaService, private readonly cloudinary: CloudinaryClient) {}

  async upload(userId: string, file: Express.Multer.File | undefined): Promise<UserResponseDto> {
    const uploaded = await this.media.upload(file, MediaKind.IMAGE, userId, 'profiles');
    try {
      return await this.change(userId, uploaded.id);
    } catch (error) {
      // Keep the previous picture on failure; the committed upload is tracked for cleanup.
      try { await this.database.transaction(async (transaction) => this.media.scheduleUnreferenced(uploaded.id, transaction)); } catch { /* Staged READY assets also expire through the worker. */ }
      throw error;
    }
  }

  remove(userId: string): Promise<UserResponseDto> { return this.change(userId, null); }

  private change(userId: string, assetId: string | null): Promise<UserResponseDto> {
    return this.database.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async (transaction) => {
      // Serialize replacements/removal for this user, including uploads finishing concurrently.
      const user = await this.users.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw new NotFoundException('User not found');
      if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('An active account is required');
      let imageUrl: string | null = null;
      if (assetId) {
        const asset = await this.assets.findByPk(assetId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!asset || asset.status !== MediaStatus.READY || asset.kind !== MediaKind.IMAGE || asset.folder !== 'onebodymusic/profiles' || asset.uploadedById !== userId || asset.deliveryType !== 'upload') {
          throw new ConflictException('Profile picture is no longer available');
        }
        imageUrl = this.cloudinary.imageUrl(asset);
      }
      const oldAssetId = user.profileImageAssetId;
      await user.update({ profileImageAssetId: assetId, profileImageUrl: imageUrl }, { transaction, fields: ['profileImageAssetId', 'profileImageUrl'] });
      if (oldAssetId && oldAssetId !== assetId) await this.media.scheduleUnreferenced(oldAssetId, transaction);
      return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status,
        profileImageUrl: user.profileImageUrl, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() };
    });
  }
}
