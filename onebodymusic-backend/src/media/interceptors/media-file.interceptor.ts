import { CallHandler, ExecutionContext, Injectable, mixin, NestInterceptor, Type, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { EnvironmentVariables } from '../../config/environment';
import { MediaKind } from '../../database/models';
import { AUDIO_MIMES, IMAGE_MIMES } from '../file-inspector';

export function MediaFileInterceptor(kind: MediaKind): Type<NestInterceptor> {
  @Injectable()
  class ConfiguredFileInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;
    constructor(config: ConfigService<EnvironmentVariables, true>) {
      const Interceptor = FileInterceptor('file', {
        storage: memoryStorage(), preservePath: true,
        limits: { fileSize: config.get(kind === MediaKind.AUDIO ? 'MEDIA_AUDIO_MAX_BYTES' : 'MEDIA_IMAGE_MAX_BYTES', { infer: true }), files: 1, fields: kind === MediaKind.AUDIO ? 0 : 1, parts: kind === MediaKind.AUDIO ? 1 : 2, fieldSize: 128 },
        fileFilter: (_request, file, callback) => {
          if (!(kind === MediaKind.AUDIO ? AUDIO_MIMES : IMAGE_MIMES).includes(file.mimetype)) callback(new UnsupportedMediaTypeException('Unsupported media MIME type'), false);
          else callback(null, true);
        },
      });
      this.delegate = new Interceptor();
    }
    intercept(context: ExecutionContext, next: CallHandler) { return this.delegate.intercept(context, next); }
  }
  return mixin(ConfiguredFileInterceptor);
}
