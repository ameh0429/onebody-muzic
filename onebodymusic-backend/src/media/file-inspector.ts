import { BadRequestException, Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { filetypeinfo } from 'magic-bytes.js';
import { extname } from 'node:path';
import { EnvironmentVariables } from '../config/environment';
import { MediaKind } from '../database/models';

export interface InspectedFile { format: 'mp3' | 'm4a' | 'jpg' | 'png' | 'webp'; mimeType: string }
export const AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a'];
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class FileInspector {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  async inspect(file: Express.Multer.File | undefined, kind: MediaKind): Promise<InspectedFile> {
    if (!file || !file.buffer || file.size === 0) throw new BadRequestException('A non-empty file field is required');
    const limit = this.config.get(kind === MediaKind.AUDIO ? 'MEDIA_AUDIO_MAX_BYTES' : 'MEDIA_IMAGE_MAX_BYTES', { infer: true });
    if (file.size > limit || file.buffer.length > limit) throw new PayloadTooLargeException('File exceeds the configured size limit');
    if (file.size !== file.buffer.length) throw new BadRequestException('Invalid file size');
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,179}$/u.test(file.originalname) || file.originalname.includes('..')) throw new BadRequestException('Unsafe filename');
    const signatures = filetypeinfo(file.buffer.subarray(0, 4096));
    const detected = (extension: string) => signatures.some((type) => type.extension === extension);
    const extension = extname(file.originalname).toLowerCase();
    let format: InspectedFile['format'] | undefined;
    if (kind === MediaKind.AUDIO) {
      if (detected('mp3') && AUDIO_MIMES.slice(0, 2).includes(file.mimetype) && extension === '.mp3' && this.validMp3(file.buffer)) format = 'mp3';
      if (detected('mp4') && AUDIO_MIMES.slice(2).includes(file.mimetype) && extension === '.m4a' && this.audioOnlyMp4(file.buffer)) format = 'm4a';
    } else {
      if ((detected('jpeg') || detected('jpg')) && file.mimetype === 'image/jpeg' && ['.jpg', '.jpeg'].includes(extension)) format = 'jpg';
      if (detected('png') && file.mimetype === 'image/png' && extension === '.png') format = 'png';
      if (detected('webp') && file.mimetype === 'image/webp' && extension === '.webp') format = 'webp';
    }
    if (!format) throw new UnsupportedMediaTypeException('File contents, MIME type and extension must match an allowed format');
    const mimeTypes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    return { format, mimeType: mimeTypes[format] };
  }

  private validMp3(buffer: Buffer): boolean {
    let offset = 0;
    if (buffer.subarray(0, 3).toString('ascii') === 'ID3') {
      if (buffer.length < 10 || ![2, 3, 4].includes(buffer[3] ?? 0)) return false;
      const bytes = [...buffer.subarray(6, 10)]; if (bytes.some((byte) => byte > 127)) return false;
      offset = 10 + bytes.reduce((value, byte) => value * 128 + byte, 0) + (buffer[3] === 4 && ((buffer[5] ?? 0) & 16) ? 10 : 0);
    }
    const frameLength = (at: number): number => {
      if (at + 4 > buffer.length || buffer[at] !== 255) return 0;
      const b = buffer[at + 1] ?? 0; const c = buffer[at + 2] ?? 0;
      const version = (b >> 3) & 3; const bitrate = c >> 4; const sample = (c >> 2) & 3;
      if ((b & 224) !== 224 || version === 1 || ((b >> 1) & 3) !== 1 || bitrate === 0 || bitrate === 15 || sample === 3) return 0;
      const rates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const hz = ([44100, 48000, 32000][sample] ?? 0) / (version === 3 ? 1 : version === 2 ? 2 : 4);
      return Math.floor((version === 3 ? 144000 : 72000) * (rates[bitrate] ?? 0) / hz) + ((c >> 1) & 1);
    };
    const end = Math.min(offset + 4096, buffer.length);
    for (; offset < end; offset++) { const first = frameLength(offset); if (first && offset + first <= buffer.length) { const second = frameLength(offset + first); if (second && offset + first + second <= buffer.length) return true; } }
    return false;
  }

  private audioOnlyMp4(buffer: Buffer): boolean {
    let tracks = 0; let boxes = 0;
    const walk = (start: number, end: number, depth: number): boolean => {
      if (depth > 8) return false;
      for (let at = start; at < end;) {
        if (++boxes > 10000 || at + 8 > end) return false;
        let size = buffer.readUInt32BE(at); let header = 8;
        if (size === 1) { if (at + 16 > end) return false; const big = buffer.readBigUInt64BE(at + 8); if (big > BigInt(buffer.length)) return false; size = Number(big); header = 16; }
        if (size === 0) size = end - at;
        if (size < header || at + size > end) return false;
        const type = buffer.toString('ascii', at + 4, at + 8);
        if (['moov', 'trak', 'mdia'].includes(type) && !walk(at + header, at + size, depth + 1)) return false;
        if (type === 'hdlr') { if (size < header + 12 || buffer.toString('ascii', at + header + 8, at + header + 12) !== 'soun') return false; tracks++; }
        at += size;
      }
      return true;
    };
    return walk(0, buffer.length, 0) && tracks > 0;
  }
}
