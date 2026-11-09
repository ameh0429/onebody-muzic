import { CloudinaryOperationError } from './errors/media-operation.error';
import { BadGatewayException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { MediaAsset, MediaKind, MediaStatus } from '../database/models';
import { MediaService } from './media.service';
import { MediaRepository } from './media.repository';
import { CloudinaryClient } from './cloudinary.client';
import { FileInspector } from './file-inspector';
import { ImageFolder } from './dto/upload-image.dto';
import { PNG, uploaded } from '../../test/fixtures/media';

function fixture(): MediaAsset {
  const value = { id: 'asset-id', kind: MediaKind.IMAGE, status: MediaStatus.UPLOADING, folder: 'onebodymusic/artists', publicId: 'onebodymusic/artists/asset-id', resourceType: 'image', deliveryType: 'upload', format: 'png', mimeType: 'image/png', bytes: PNG.length, duration: null, width: null, height: null, uploadedById: 'admin-id', createdAt: new Date(), updatedAt: new Date(), update: jest.fn() };
  value.update.mockImplementation(async (change: object) => Object.assign(value, change));
  return value as unknown as MediaAsset;
}

describe('durable media lifecycle and compensation', () => {
  const repository = { reserve: jest.fn(), locked: jest.fn(), referenced: jest.fn(), candidates: jest.fn() };
  const provider = { configured: jest.fn(), upload: jest.fn(), destroy: jest.fn(), imageUrl: jest.fn() };
  const inspector = { inspect: jest.fn() };
  let asset: MediaAsset; let service: MediaService; const transaction = {} as Transaction;
  beforeEach(() => {
    jest.resetAllMocks(); asset = fixture();
    repository.reserve.mockImplementation(async (values: object) => Object.assign(asset, values));
    repository.locked.mockImplementation(async (_id: string, work: (value: MediaAsset, t: Transaction) => Promise<unknown>) => work(asset, transaction));
    repository.referenced.mockResolvedValue(false); repository.candidates.mockResolvedValue([asset.id]);
    provider.configured.mockReturnValue(true); provider.destroy.mockResolvedValue(undefined); provider.imageUrl.mockReturnValue('https://res.cloudinary.com/test/image/upload/asset.png');
    provider.upload.mockResolvedValue({ bytes: PNG.length, format: 'png', duration: null, width: 1, height: 1 }); inspector.inspect.mockResolvedValue({ format: 'png', mimeType: 'image/png' });
    service = new MediaService(repository as unknown as MediaRepository, provider as unknown as CloudinaryClient, inspector as unknown as FileInspector);
  });
  it('reserves a generated UUID/key before upload and returns only safe metadata', async () => {
    const result = await service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS);
    expect(repository.reserve.mock.invocationCallOrder[0]).toBeLessThan(provider.upload.mock.invocationCallOrder[0] ?? Infinity);
    expect(repository.reserve).toHaveBeenCalledWith(expect.objectContaining({ folder: 'onebodymusic/artists', uploadedById: 'admin-id', publicId: expect.stringMatching(/^onebodymusic\/artists\/[a-f0-9-]{36}$/) }));
    expect(result).toMatchObject({ status: MediaStatus.READY, width: 1, height: 1 }); expect(JSON.stringify(result)).not.toContain('api_secret');
  });
  it('reserves authenticated audio as a video resource and omits any audio URL', async () => {
    inspector.inspect.mockResolvedValue({ format: 'mp3', mimeType: 'audio/mpeg' }); provider.imageUrl.mockReturnValue(null); provider.upload.mockResolvedValue({ bytes: PNG.length, format: 'mp3', duration: 5, width: null, height: null });
    const result = await service.upload(uploaded(PNG), MediaKind.AUDIO, 'admin-id');
    expect(result).toMatchObject({ resourceType: 'video', deliveryType: 'authenticated', url: null });
  });
  it('never contacts Cloudinary if validation or the initial database reservation fails', async () => {
    inspector.inspect.mockRejectedValueOnce(new Error('invalid'));
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toThrow('invalid'); expect(repository.reserve).not.toHaveBeenCalled();
    repository.reserve.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toBeInstanceOf(ServiceUnavailableException); expect(provider.upload).not.toHaveBeenCalled();
  });
  it('compensates upload failures and retains a durable pending record for uncertain outcomes', async () => {
    provider.upload.mockRejectedValue(new Error('private provider error'));
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toMatchObject({ status: 502 });
    expect(asset.status).toBe(MediaStatus.CLEANUP_PENDING); expect(provider.destroy).toHaveBeenCalledWith(asset);
  });
  it.each(['TIMEOUT', 'CONNECTION', 'TLS'] as const)('persists cleanup intent without a second blocking provider call after %s', async (failure) => {
    provider.upload.mockRejectedValue(new CloudinaryOperationError(failure));
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toMatchObject({ status: failure === 'TIMEOUT' ? 504 : 502, failure });
    expect(asset.status).toBe(MediaStatus.CLEANUP_PENDING); expect(provider.destroy).not.toHaveBeenCalled();
  });
  it('cleans up a successful remote upload if the final database write fails', async () => {
    jest.mocked(asset.update).mockRejectedValueOnce(new Error('database write failed'));
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toMatchObject({ status: 503, failure: 'SAVE' });
    expect(provider.upload).toHaveBeenCalled(); expect(provider.destroy).toHaveBeenCalled(); expect(asset.status).toBe(MediaStatus.CLEANUP_PENDING);
  });
  it('preserves cleanup intent when both upload and compensation fail', async () => {
    provider.upload.mockRejectedValue(new Error('upload failed')); provider.destroy.mockRejectedValue(new Error('destroy failed'));
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toMatchObject({ status: 502 }); expect(asset.status).toBe(MediaStatus.CLEANUP_PENDING);
  });
  it('fails closed without configuration', async () => {
    provider.configured.mockReturnValue(false);
    await expect(service.upload(uploaded(PNG), MediaKind.IMAGE, 'admin-id', ImageFolder.ARTISTS)).rejects.toBeInstanceOf(ServiceUnavailableException); expect(inspector.inspect).not.toHaveBeenCalled();
  });
  it('refuses deletion of referenced assets without a provider call', async () => {
    asset.status = MediaStatus.READY; repository.referenced.mockResolvedValue(true);
    await expect(service.remove(asset.id)).rejects.toBeInstanceOf(ConflictException); expect(provider.destroy).not.toHaveBeenCalled();
  });
  it('deletes by stored identity, marks a tombstone, and makes repeated deletion idempotent', async () => {
    asset.status = MediaStatus.READY; await service.remove(asset.id); expect(asset.status).toBe(MediaStatus.DELETED); expect(provider.destroy).toHaveBeenCalledWith(asset);
    await service.remove(asset.id); expect(provider.destroy).toHaveBeenCalledTimes(1);
  });
  it('returns 404 for unknown UUIDs', async () => { repository.locked.mockResolvedValue(null); await expect(service.remove('unknown')).rejects.toBeInstanceOf(NotFoundException); });
  it('commits pending deletion status on provider failure', async () => {
    asset.status = MediaStatus.READY; provider.destroy.mockRejectedValue(new Error('provider failed'));
    await expect(service.remove(asset.id)).rejects.toBeInstanceOf(BadGatewayException); expect(asset.status).toBe(MediaStatus.CLEANUP_PENDING);
  });
  it('retries stale pending assets using SKIP LOCKED and confirms deletion', async () => {
    asset.status = MediaStatus.CLEANUP_PENDING; asset.createdAt = new Date(Date.now() - 3600000);
    await service.reconcile(900); expect(provider.destroy).toHaveBeenCalled(); expect(asset.status).toBe(MediaStatus.DELETED); expect(repository.locked).toHaveBeenCalledWith(asset.id, expect.any(Function), true);
  });
  it('does not reap fresh uploads, young staged assets, or referenced assets', async () => {
    await service.reconcile(900); expect(provider.destroy).not.toHaveBeenCalled();
    asset.status = MediaStatus.READY; await service.reconcile(900); expect(provider.destroy).not.toHaveBeenCalled();
    asset.createdAt = new Date(Date.now() - 172800000); repository.referenced.mockResolvedValue(true); await service.reconcile(900); expect(provider.destroy).not.toHaveBeenCalled();
  });
  it('expires unreferenced READY uploads after 24 hours', async () => {
    asset.status = MediaStatus.READY; asset.createdAt = new Date(Date.now() - 172800000); await service.reconcile(900); expect(asset.status).toBe(MediaStatus.DELETED);
  });
});
