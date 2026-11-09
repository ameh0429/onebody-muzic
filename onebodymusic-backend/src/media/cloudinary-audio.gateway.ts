import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvironmentVariables } from '../config/environment';
import { MediaAsset } from '../database/models';
import { CloudinaryClient } from './cloudinary.client';

export interface AudioUpstream {
  stream: Readable;
  status: 200 | 206 | 416;
  contentType: string;
  contentLength?: string;
  contentRange?: string;
  acceptRanges?: 'bytes';
}
@Injectable()
export class CloudinaryAudioGateway {
  constructor(private readonly client: CloudinaryClient, private readonly config: ConfigService<EnvironmentVariables, true>) {}
  open(asset: MediaAsset, range: string | undefined, head: boolean, signal: AbortSignal): Promise<AudioUpstream> {
    const url = this.client.internalAudioUrl(asset);
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    return new Promise((resolve, reject) => {
      const fail = () => reject(new BadGatewayException('Audio provider is unavailable'));
      // No automatic redirects, cookies, access JWTs, or client-supplied hosts reach the provider.
      const upstream = request(url, { method: head ? 'HEAD' : 'GET', headers: { ...(range ? { Range: range } : {}), 'Accept-Encoding': 'identity' }, ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}), signal }, (response) => {
        response.on('error', () => undefined);
        const status = response.statusCode;
        const length = response.headers['content-length']; const contentRange = response.headers['content-range'];
        const validLength = length === undefined || /^\d+$/.test(length) && Number(length) <= asset.bytes;
        const match = typeof contentRange === 'string' ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange) : null;
        const validRange = match && Number(match[1]) <= Number(match[2]) && Number(match[2]) < Number(match[3]) && Number(match[3]) === asset.bytes && (length === undefined || Number(length) === Number(match[2]) - Number(match[1]) + 1);
        if (![200, 206, 416].includes(status ?? 0) || (status !== 416 && !validLength) || (status === 206 && !validRange) || (range && status === 200) || (status === 416 && contentRange !== `bytes */${asset.bytes}`)) { response.destroy(); fail(); return; }
        resolve({ stream: response, status: status as AudioUpstream['status'], contentType: asset.format === 'mp3' ? 'audio/mpeg' : 'audio/mp4', contentLength: length, contentRange, acceptRanges: status === 206 || response.headers['accept-ranges'] === 'bytes' ? 'bytes' : undefined });
      });
      upstream.setTimeout(this.config.get('MEDIA_PLAYBACK_IDLE_TIMEOUT_SECONDS', { infer: true }) * 1000, () => upstream.destroy(new Error('Audio provider timeout')));
      upstream.on('error', fail); upstream.end();
    });
  }
}
