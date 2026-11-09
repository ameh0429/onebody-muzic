import { BadGatewayException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { MediaAsset, MediaKind, MediaStatus } from '../database/models';
import { CloudinaryClient } from './cloudinary.client';
import { FileInspector } from './file-inspector';
import { MediaRepository } from './media.repository';
import { ImageFolder } from './dto/upload-image.dto';
import { MediaResponseDto } from './dto/media-response.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  constructor(private readonly repository: MediaRepository, private readonly cloudinary: CloudinaryClient, private readonly inspector: FileInspector) {}

  async upload(file: Express.Multer.File | undefined, kind: MediaKind, ownerId: string, destination?: ImageFolder): Promise<MediaResponseDto> {
    if (!this.cloudinary.configured()) throw new ServiceUnavailableException('Cloudinary media is not configured');
    const inspection = await this.inspector.inspect(file, kind);
    const id = randomUUID(); const folder = `onebodymusic/${kind === MediaKind.AUDIO ? 'audio' : destination}`;
    // Commit the deterministic storage key before contacting the provider. If this write fails, no upload starts.
    try { await this.repository.reserve({ id, kind, folder, publicId: `${folder}/${id}`, resourceType: kind === MediaKind.AUDIO ? 'video' : 'image', deliveryType: kind === MediaKind.AUDIO ? 'authenticated' : 'upload', format: inspection.format, mimeType: inspection.mimeType, bytes: file!.size, uploadedById: ownerId, duration: null, width: null, height: null }); } catch { throw new ServiceUnavailableException('Media reservation could not be saved'); }
    let uploaded = false; let attempted = false;
    try {
      const result = await this.repository.locked(id, async (asset, transaction) => {
        if (asset.status !== MediaStatus.UPLOADING) throw new ConflictException('Upload is no longer pending');
        // A row lock protects the entire in-flight upload from the stale-upload reaper.
        attempted = true;
        const metadata = await this.cloudinary.upload(file!.buffer, asset);
        uploaded = true;
        await asset.update({ ...metadata, status: MediaStatus.READY }, { transaction });
        return this.response(asset);
      });
      if (!result) throw new ServiceUnavailableException('Media reservation is unavailable');
      return result;
    } catch {
      // A failed transaction leaves the committed reservation behind for durable reconciliation.
      try {
        const prepared = await this.repository.locked(id, async (asset, transaction) => {
          if (asset.status === MediaStatus.DELETED || await this.repository.referenced(asset, transaction)) return false;
          await asset.update({ status: MediaStatus.CLEANUP_PENDING }, { transaction });
          return true;
        });
        if (prepared) await this.repository.locked(id, async (asset, transaction) => {
          if (asset.status !== MediaStatus.CLEANUP_PENDING || await this.repository.referenced(asset, transaction)) return;
          try { await this.cloudinary.destroy(asset); } catch { this.logger.warn(`Media cleanup pending: ${id}`); }
        });
      } catch { this.logger.error(`Media cleanup requires reconciliation: ${id}`); }
      // Do not mark the tombstone deleted yet: a timed-out upload may complete remotely after compensation.
      if (uploaded || !attempted) throw new ServiceUnavailableException('Media metadata could not be saved; cleanup has been scheduled');
      throw new BadGatewayException('Media upload could not be completed; cleanup has been scheduled');
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.cloudinary.configured()) throw new ServiceUnavailableException('Cloudinary media is not configured');
    try {
      const prepared = await this.repository.locked(id, async (asset, transaction) => {
        if (asset.status === MediaStatus.DELETED) return false;
        if (await this.repository.referenced(asset, transaction)) throw new ConflictException('Media is referenced by library records');
        await asset.update({ status: MediaStatus.CLEANUP_PENDING }, { transaction });
        return true;
      });
      if (prepared === null) throw new NotFoundException('Media asset not found');
      if (!prepared) return;
      // Commit cleanup intent before the irreversible remote operation. A failed final write can never restore READY.
      const confirmed = await this.finishDeletion(id);
      if (!confirmed) throw new BadGatewayException('Media deletion is pending; cleanup will retry');
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Media deletion could not be finalized; cleanup remains tracked');
    }
  }

  async reconcile(staleSeconds: number): Promise<void> {
    if (!this.cloudinary.configured()) return;
    const ids = await this.repository.candidates(staleSeconds);
    for (const id of ids) {
      try {
        const prepared = await this.repository.locked(id, async (asset, transaction) => {
          if (asset.status === MediaStatus.DELETED || await this.repository.referenced(asset, transaction)) return false;
          if (asset.status === MediaStatus.UPLOADING && asset.updatedAt.getTime() > Date.now() - staleSeconds * 1000) return false;
          if (asset.status === MediaStatus.CLEANUP_PENDING && asset.createdAt.getTime() > Date.now() - staleSeconds * 1000) return false;
          if (asset.status === MediaStatus.READY && asset.createdAt.getTime() > Date.now() - 86400000) return false;
          await asset.update({ status: MediaStatus.CLEANUP_PENDING }, { transaction });
          return true;
        }, true);
        if (prepared) await this.finishDeletion(id, true);
      } catch { this.logger.warn(`Media reconciliation pending: ${id}`); }
    }
  }

  private async finishDeletion(id: string, skipLocked = false): Promise<boolean> {
    const confirmed = await this.repository.locked(id, async (asset, transaction) => {
      if (asset.status === MediaStatus.DELETED) return true;
      if (asset.status !== MediaStatus.CLEANUP_PENDING || await this.repository.referenced(asset, transaction)) return false;
      try { await this.cloudinary.destroy(asset); } catch { return false; }
      await asset.update({ status: MediaStatus.DELETED }, { transaction });
      return true;
    }, skipLocked);
    return confirmed === true;
  }

  scheduleUnreferenced(id: string, transaction: Transaction): Promise<void> { return this.repository.scheduleUnreferenced(id, transaction); }

  private response(asset: MediaAsset): MediaResponseDto {
    return { id: asset.id, kind: asset.kind, status: asset.status, folder: asset.folder, publicId: asset.publicId, resourceType: asset.resourceType, deliveryType: asset.deliveryType, format: asset.format, mimeType: asset.mimeType, bytes: asset.bytes, duration: asset.duration, width: asset.width, height: asset.height, url: this.cloudinary.imageUrl(asset), createdAt: asset.createdAt.toISOString() };
  }
}
