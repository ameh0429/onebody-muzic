import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { cloudinaryOperation } from './cloudinary-operation';
import { classifyCloudinaryError, CloudinaryOperationError } from './errors/media-operation.error';
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
    return {
      cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true }),
      api_key: this.config.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: this.config.get('CLOUDINARY_API_SECRET', { infer: true }),
      upload_prefix: 'https://api.cloudinary.com', secure: true,
      resource_type: asset.resourceType, type: asset.deliveryType,
      timeout: (this.config.get('MEDIA_UPLOAD_TIMEOUT_SECONDS', { infer: true }) ?? 90) * 1000,
    };
  }
  async upload(buffer: Buffer, asset: MediaAsset): Promise<CloudinaryMetadata> {
    const options = this.options(asset);
    return cloudinaryOperation(Number(options.timeout), (agent) => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        ...options, agent, public_id: asset.id, folder: asset.folder,
        overwrite: false, use_filename: false, unique_filename: false,
        allowed_formats: [asset.format],
      }, (error, result) => {
        if (error || !result) { reject(error ? classifyCloudinaryError(error) : new CloudinaryOperationError('INVALID_RESPONSE')); return; }
        const duration: unknown = result.duration;
        const video: unknown = result.video;
        const audio: unknown = result.audio;
        const validAudio = typeof audio === 'object' && audio !== null && 'codec' in audio && typeof audio.codec === 'string';
        // Cloudinary reports embedded JPEG/PNG audio cover art in its video field.
        // FileInspector already validates the MP3 frames / audio-only M4A container.
        const embeddedArtwork = typeof video === 'object' && video !== null && 'codec' in video
          && typeof video.codec === 'string' && ['mjpeg', 'png'].includes(video.codec);
        const unexpectedVideo = video && typeof video === 'object' && Object.keys(video).length > 0 && !embeddedArtwork;
        const validImage = Number.isInteger(result.width) && result.width > 0 && Number.isInteger(result.height) && result.height > 0;
        if (result.public_id !== asset.publicId || result.resource_type !== asset.resourceType || result.type !== asset.deliveryType || result.format !== asset.format || result.bytes !== buffer.length || (asset.kind === MediaKind.AUDIO && (!validAudio || unexpectedVideo)) || (asset.kind === MediaKind.IMAGE && !validImage)) { reject(new CloudinaryOperationError('INVALID_RESPONSE')); return; }
        resolve({ bytes: result.bytes, format: result.format, width: asset.kind === MediaKind.IMAGE ? result.width : null, height: asset.kind === MediaKind.IMAGE ? result.height : null, duration: asset.kind === MediaKind.AUDIO && typeof duration === 'number' && Number.isFinite(duration) ? duration : null });
      });
      stream.on('error', (error: unknown) => reject(classifyCloudinaryError(error)));
      stream.end(buffer);
    }));
  }
  async destroy(asset: MediaAsset): Promise<void> {
    const options = this.options(asset);
    const response: unknown = await cloudinaryOperation(10000, (agent) => { const deletion: UploadApiOptions = { ...options, timeout: 10000, agent, invalidate: true }; return cloudinary.uploader.destroy(asset.publicId, deletion); });
    if (typeof response !== 'object' || response === null || !('result' in response) || !['ok', 'not found'].includes(String(response.result))) throw new Error('Cloudinary removal not confirmed');
  }
  async checkConnection(): Promise<void> {
    if (!this.configured()) throw new ServiceUnavailableException('Cloudinary media is not configured');
    const response: unknown = await cloudinaryOperation(10000, (agent) => cloudinary.api.ping({
      cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true }), api_key: this.config.get('CLOUDINARY_API_KEY', { infer: true }), api_secret: this.config.get('CLOUDINARY_API_SECRET', { infer: true }),
      upload_prefix: 'https://api.cloudinary.com', timeout: 10000, agent,
    }));
    if (typeof response !== 'object' || response === null || !('status' in response) || response.status !== 'ok') throw new CloudinaryOperationError('INVALID_RESPONSE');
  }
  // Non-expiring provider signatures stay inside the server; browser tickets enforce expiry at the gateway.
  internalAudioUrl(asset: MediaAsset): string {
    const options = this.options(asset);
    if (asset.kind !== MediaKind.AUDIO) throw new ServiceUnavailableException('Audio media is required');
    return cloudinary.url(asset.publicId, { cloud_name: options.cloud_name, api_secret: options.api_secret, resource_type: 'video', type: 'authenticated', format: asset.format, secure: true, sign_url: true, long_url_signature: true, auth_token: false });
  }
  imageUrl(asset: MediaAsset): string | null {
    if (asset.kind !== MediaKind.IMAGE) return null;
    return cloudinary.url(asset.publicId, { cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true }), resource_type: 'image', type: 'upload', secure: true, version: undefined, format: asset.format });
  }
}
