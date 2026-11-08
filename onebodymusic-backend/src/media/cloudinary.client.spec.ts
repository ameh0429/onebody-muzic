import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary, UploadApiResponse, UploadApiOptions, UploadResponseCallback } from 'cloudinary';
import { CloudinaryClient } from './cloudinary.client';
import { EnvironmentVariables } from '../config/environment';
import { MediaAsset, MediaKind } from '../database/models';

jest.mock('cloudinary', () => ({ v2: { uploader: { upload_stream: jest.fn(), destroy: jest.fn() }, url: jest.fn() } }));

const streamUpload = cloudinary.uploader.upload_stream as unknown as jest.Mock<PassThrough, [UploadApiOptions, UploadResponseCallback]>;
const destroy = jest.mocked(cloudinary.uploader.destroy);
const config = new ConfigService<EnvironmentVariables, true>({ MEDIA_ENABLED: 'true', CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret' });
function audioAsset(): MediaAsset {
  const id = randomUUID(); return { id, publicId: `onebodymusic/audio/${id}`, folder: 'onebodymusic/audio', resourceType: 'video', deliveryType: 'authenticated', kind: MediaKind.AUDIO, format: 'mp3' } as MediaAsset;
}
describe('Cloudinary authenticated-delivery boundary', () => {
  beforeEach(() => { jest.resetAllMocks(); });
  it('uses signed server-side uploads with authenticated audio, fixed folders and no overwrites', async () => {
    const asset = audioAsset();
    streamUpload.mockImplementation((options, callback) => {
      const stream = new PassThrough(); stream.on('finish', () => callback?.(undefined, { public_id: asset.publicId, resource_type: 'video', type: 'authenticated', format: 'mp3', bytes: 3, audio: { codec: 'mp3' }, duration: 2 } as unknown as UploadApiResponse)); return stream;
    });
    const provider = new CloudinaryClient(config); const result = await provider.upload(Buffer.from('abc'), asset);
    expect(streamUpload).toHaveBeenCalledWith(expect.objectContaining({ resource_type: 'video', type: 'authenticated', public_id: asset.id, folder: 'onebodymusic/audio', overwrite: false, use_filename: false, allowed_formats: ['mp3'], upload_prefix: 'https://api.cloudinary.com' }), expect.any(Function));
    expect(result.duration).toBe(2); expect(provider.imageUrl(asset)).toBeNull();
  });
  it('rejects upstream metadata indicating public delivery or a video track', async () => {
    const asset = audioAsset();
    streamUpload.mockImplementation((_options, callback) => {
      const stream = new PassThrough(); stream.on('finish', () => callback?.(undefined, { public_id: asset.publicId, resource_type: 'video', type: 'upload', format: 'mp3', bytes: 3, audio: { codec: 'mp3' }, video: { codec: 'h264' } } as unknown as UploadApiResponse)); return stream;
    });
    await expect(new CloudinaryClient(config).upload(Buffer.from('abc'), asset)).rejects.toThrow('Unexpected Cloudinary upload metadata');
  });
  it('destroys only the stored authenticated resource and requires confirmation', async () => {
    const asset = audioAsset(); destroy.mockResolvedValueOnce({ result: 'ok' }).mockResolvedValueOnce({ result: 'not found' }).mockResolvedValueOnce({ result: 'error' });
    const provider = new CloudinaryClient(config); await provider.destroy(asset); await provider.destroy(asset);
    expect(destroy).toHaveBeenCalledWith(asset.publicId, expect.objectContaining({ resource_type: 'video', type: 'authenticated', invalidate: true }));
    await expect(provider.destroy(asset)).rejects.toThrow('not confirmed');
  });
  it('refuses storage keys outside the server-owned namespace', async () => {
    const asset = audioAsset(); asset.publicId = 'someone-elses-file';
    await expect(new CloudinaryClient(config).destroy(asset)).rejects.toThrow('Invalid media storage record'); expect(destroy).not.toHaveBeenCalled();
  });
});
