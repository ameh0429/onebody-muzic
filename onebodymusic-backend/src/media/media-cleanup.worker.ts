import { Injectable, Logger, OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';
import { MediaService } from './media.service';

@Injectable()
export class MediaCleanupWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MediaCleanupWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(private readonly media: MediaService, private readonly config: ConfigService<EnvironmentVariables, true>) {}
  onApplicationBootstrap(): void {
    if (this.config.get('MEDIA_ENABLED', { infer: true }) !== 'true') return;
    const run = () => {
      if (this.running) return;
      this.running = this.media.reconcile(this.config.get('MEDIA_STALE_UPLOAD_SECONDS', { infer: true })).catch(() => { this.logger.warn('Media reconciliation will retry'); }).finally(() => { this.running = undefined; });
    };
    run(); this.timer = setInterval(run, this.config.get('MEDIA_CLEANUP_INTERVAL_SECONDS', { infer: true }) * 1000); this.timer.unref();
  }
  async beforeApplicationShutdown(): Promise<void> { if (this.timer) clearInterval(this.timer); await this.running; }
}
