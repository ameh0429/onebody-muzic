import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';
import { MediaCleanupWorker } from './media-cleanup.worker';
import { MediaService } from './media.service';

describe('media cleanup scheduling', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  it('does not schedule provider work while media is disabled', async () => {
    const reconcile = jest.fn();
    const worker = new MediaCleanupWorker({ reconcile } as unknown as MediaService, new ConfigService<EnvironmentVariables, true>({ MEDIA_ENABLED: 'false' }));
    worker.onApplicationBootstrap(); jest.advanceTimersByTime(120000); expect(reconcile).not.toHaveBeenCalled(); await worker.beforeApplicationShutdown();
  });
  it('does not overlap cleanup passes and stops before the database shuts down', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const reconcile = jest.fn(() => pending);
    const worker = new MediaCleanupWorker({ reconcile } as unknown as MediaService, new ConfigService<EnvironmentVariables, true>({ MEDIA_ENABLED: 'true', MEDIA_STALE_UPLOAD_SECONDS: 900, MEDIA_CLEANUP_INTERVAL_SECONDS: 60 }));
    worker.onApplicationBootstrap(); jest.advanceTimersByTime(180000); expect(reconcile).toHaveBeenCalledTimes(1);
    release(); await worker.beforeApplicationShutdown(); jest.advanceTimersByTime(180000); expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
