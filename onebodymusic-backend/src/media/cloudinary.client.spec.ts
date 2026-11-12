import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary, UploadApiResponse, UploadApiOptions, UploadResponseCallback } from 'cloudinary';
import { CloudinaryClient } from './cloudinary.client';
import { EnvironmentVariables } from '../config/environment';
import { MediaAsset, MediaKind } from '../database/models';

jest.mock('cloudinary', () => ({ v2: { uploader: { upload_stream: jest.fn(), destroy: jest.fn() }, api: { ping: jest.fn() }, url: jest.fn() } }));

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
    await expect(new CloudinaryClient(config).upload(Buffer.from('abc'), asset)).rejects.toThrow('INVALID_RESPONSE');
  });
  it.each(['mjpeg', 'png'])('accepts embedded %s cover artwork without storing it as song artwork', async (codec) => {
    const asset = audioAsset();
    streamUpload.mockImplementation((_options, callback) => {
      const stream = new PassThrough();
      stream.on('finish', () => callback?.(undefined, {
        public_id: asset.publicId, resource_type: 'video', type: 'authenticated', format: 'mp3', bytes: 3,
        audio: { codec: 'mp3' }, video: { codec }, width: 600, height: 600, duration: 120,
      } as unknown as UploadApiResponse));
      return stream;
    });
    await expect(new CloudinaryClient(config).upload(Buffer.from('abc'), asset)).resolves.toEqual({
      bytes: 3, format: 'mp3', duration: 120, width: null, height: null,
    });
  });
  it.each([
    { video: { codec: 'h264' } },
    { video: { codec: 'vp9' } },
    { video: { width: 600 } },
    { video: { codec: 'mjpeg' }, audio: undefined },
    { video: { codec: 'mjpeg' }, type: 'upload' },
    { video: { codec: 'png' }, format: 'mp4' },
    { video: { codec: 'png' }, bytes: 4 },
    { video: { codec: 'png' }, public_id: 'unrelated' },
    { video: { codec: 'png' }, resource_type: 'image' },
  ])('rejects incompatible metadata even with cover art: %j', async (overrides) => {
    const asset = audioAsset();
    streamUpload.mockImplementation((_options, callback) => {
      const stream = new PassThrough();
      stream.on('finish', () => callback?.(undefined, {
        public_id: asset.publicId, resource_type: 'video', type: 'authenticated', format: 'mp3', bytes: 3,
        audio: { codec: 'mp3' }, ...overrides,
      } as unknown as UploadApiResponse));
      return stream;
    });
    await expect(new CloudinaryClient(config).upload(Buffer.from('abc'), asset)).rejects.toThrow('INVALID_RESPONSE');
  });
  it('checks credentials with a bounded read-only ping and classifies rejection safely', async () => {
    jest.mocked(cloudinary.api.ping).mockResolvedValueOnce({ status: 'ok' }).mockRejectedValueOnce({ http_code: 401, message: 'private-key-must-not-leak' });
    const provider = new CloudinaryClient(config); await provider.checkConnection();
    await expect(provider.checkConnection()).rejects.toMatchObject({ failure: 'CREDENTIALS' });
    expect(cloudinary.api.ping).toHaveBeenCalledWith(expect.objectContaining({ cloud_name: 'test-cloud', timeout: 10000 }));
  });
  it('classifies SDK timeout callbacks instead of losing the failure cause', async () => {
    streamUpload.mockImplementation((_options, callback) => { const stream = new PassThrough(); stream.on('finish', () => callback?.({ name: 'TimeoutError', http_code: 499, message: 'Request Timeout' })); return stream; });
    await expect(new CloudinaryClient(config).upload(Buffer.from('abc'), audioAsset())).rejects.toMatchObject({ failure: 'TIMEOUT' });
  });
  it('destroys only the stored authenticated resource and requires confirmation', async () => {
    const asset = audioAsset(); destroy.mockResolvedValueOnce({ result: 'ok' }).mockResolvedValueOnce({ result: 'not found' }).mockResolvedValueOnce({ result: 'error' });
    const provider = new CloudinaryClient(config); await provider.destroy(asset); await provider.destroy(asset);
    expect(destroy).toHaveBeenCalledWith(asset.publicId, expect.objectContaining({ resource_type: 'video', type: 'authenticated', invalidate: true }));
    await expect(provider.destroy(asset)).rejects.toThrow('not confirmed');
  });
  it('signs authenticated provider URLs only for internal gateway use', () => {
    const asset = audioAsset(); jest.mocked(cloudinary.url).mockReturnValue('https://res.cloudinary.com/test/video/authenticated/internal.mp3');
    expect(new CloudinaryClient(config).internalAudioUrl(asset)).toContain('/video/authenticated/');
    expect(cloudinary.url).toHaveBeenCalledWith(asset.publicId, expect.objectContaining({ type: 'authenticated', resource_type: 'video', secure: true, sign_url: true, auth_token: false }));
  });
  it('can compare the standard SDK signature without enabling public or unsigned delivery', () => {
    const asset = audioAsset();
    new CloudinaryClient(config).internalAudioUrl(asset, 'standard');
    expect(cloudinary.url).toHaveBeenCalledWith(asset.publicId, expect.objectContaining({
      type: 'authenticated', resource_type: 'video', sign_url: true, long_url_signature: false,
      signature_algorithm: 'sha1', auth_token: false,
    }));
  });
  it('refuses storage keys outside the server-owned namespace', async () => {
    const asset = audioAsset(); asset.publicId = 'someone-elses-file';
    await expect(new CloudinaryClient(config).destroy(asset)).rejects.toThrow('Invalid media storage record'); expect(destroy).not.toHaveBeenCalled();
  });
});
