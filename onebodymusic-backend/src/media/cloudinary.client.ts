import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvironmentVariables } from '../config/environment';
import { MediaAsset, MediaKind } from '../database/models';

export interface CloudinaryMetadata { bytes: number; format: string; width: number | null; height: number | null; duration: number | null }

@Injectable()
export class CloudinaryClient {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}
  configured(): boolean {
    return this.config.get('MEDIA_ENABLED', { infer: true }) === 'true' && Boolean(this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true }) && this.config.get('CLOUDINARY_API_KEY', { infer: true }) && this.config.get('CLOUDINARY_API_SECRET', { infer: true }));
  }
  private options(asset: MediaAsset): UploadApiOptions {
    if (!this.configured()) throw new ServiceUnavailableException('Cloudinary media is not configured');
    if (!['onebodymusic/audio', 'onebodymusic/artists', 'onebodymusic/albums', 'onebodymusic/songs'].includes(asset.folder) || asset.publicId !== `${asset.folder}/${asset.id}` || (asset.kind === MediaKind.AUDIO ? asset.resourceType !== 'video' || asset.deliveryType !== 'authenticated' : asset.resourceType !== 'image' || asset.deliveryType !== 'upload')) throw new ServiceUnavailableException('Invalid media storage record');
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    return {
      cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true }),
      api_key: this.config.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: this.config.get('CLOUDINARY_API_SECRET', { infer: true }),
      upload_prefix: 'https://api.cloudinary.com', secure: true,
      resource_type: asset.resourceType, type: asset.deliveryType,
      timeout: 120000,
      ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}),
    };
  }
  async upload(buffer: Buffer, asset: MediaAsset): Promise<CloudinaryMetadata> {
    const options = this.options(asset);
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        ...options, public_id: asset.id, folder: asset.folder,
        overwrite: false, use_filename: false, unique_filename: false,
        allowed_formats: [asset.format],
      }, (error, result) => {
        if (error || !result) { reject(new Error('Cloudinary upload failed')); return; }
        const duration: unknown = result.duration;
        const video: unknown = result.video;
        const audio: unknown = result.audio;
        const validAudio = typeof audio === 'object' && audio !== null && 'codec' in audio && typeof audio.codec === 'string';
        const validImage = Number.isInteger(result.width) && result.width > 0 && Number.isInteger(result.height) && result.height > 0;
        if (result.public_id !== asset.publicId || result.resource_type !== asset.resourceType || result.type !== asset.deliveryType || result.format !== asset.format || result.bytes !== buffer.length || (asset.kind === MediaKind.AUDIO && (!validAudio || (video && typeof video === 'object' && Object.keys(video).length > 0))) || (asset.kind === MediaKind.IMAGE && !validImage)) { reject(new Error('Unexpected Cloudinary upload metadata')); return; }
        resolve({ bytes: result.bytes, format: result.format, width: asset.kind === MediaKind.IMAGE ? result.width : null, height: asset.kind === MediaKind.IMAGE ? result.height : null, duration: asset.kind === MediaKind.AUDIO && typeof duration === 'number' && Number.isFinite(duration) ? duration : null });
      });
      stream.on('error', () => reject(new Error('Cloudinary upload stream failed')));
      stream.end(buffer);
    });
  }
  async destroy(asset: MediaAsset): Promise<void> {
    const options = this.options(asset);
    const response: unknown = await cloudinary.uploader.destroy(asset.publicId, { ...options, invalidate: true });
    if (typeof response !== 'object' || response === null || !('result' in response) || !['ok', 'not found'].includes(String(response.result))) throw new Error('Cloudinary removal not confirmed');
  }
  imageUrl(asset: MediaAsset): string | null {
    if (asset.kind !== MediaKind.IMAGE) return null;
    return cloudinary.url(asset.publicId, { cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true }), resource_type: 'image', type: 'upload', secure: true, version: undefined, format: asset.format });
  }
}
