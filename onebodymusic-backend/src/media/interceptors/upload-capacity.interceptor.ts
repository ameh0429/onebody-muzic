import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { finalize } from 'rxjs';
import { EnvironmentVariables } from '../../config/environment';

@Injectable()
export class UploadCapacityInterceptor implements NestInterceptor {
  private active = 0;
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}
  intercept(_context: ExecutionContext, next: CallHandler) {
    if (this.config.get('MEDIA_ENABLED', { infer: true }) !== 'true') throw new ServiceUnavailableException('Media uploads are disabled');
    if (this.active >= this.config.get('MEDIA_MAX_CONCURRENT_UPLOADS', { infer: true })) throw new HttpException('Upload capacity reached; retry later', HttpStatus.TOO_MANY_REQUESTS);
    this.active++;
    return next.handle().pipe(finalize(() => { this.active--; }));
  }
}
