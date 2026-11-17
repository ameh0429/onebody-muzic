import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';

describe('notification delivery', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup(attempts = 0) {
    const row = { id: 'notice', userId: 'member', kind: 'reminder', adminOnly: false, rehearsalId: 'practice', createdAt: new Date(), pushAttempts: attempts };
    let claimed = false;
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT n.*')) { if (claimed) return []; claimed = true; return [row]; }
      if (sql.startsWith('SELECT s.endpoint')) return [{ endpoint: 'https://fcm.googleapis.com/send/test', p256dh: 'key', auth: 'auth' }];
      return [];
    });
    const db = { query, transaction: async (work: (transaction: object) => Promise<void>) => work({}) };
    const service = { db, options: () => ({ enabled: true }) } as unknown as NotificationsService;
    const worker = new NotificationsWorker(service, new ConfigService({ WEB_PUSH_SUBJECT: 'mailto:ops@example.test', WEB_PUSH_PUBLIC_KEY: 'public', WEB_PUSH_PRIVATE_KEY: 'private' }));
    return { query, worker };
  }
  it('delivers generic content, uses a stable tag, and does not log private details', async () => {
    const send = jest.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const { worker, query } = setup(); await worker.tick();
    const payload = JSON.parse(send.mock.calls[0]![1] as string) as Record<string, string>;
    expect(payload).toEqual({ title: 'OnebodyMusic', body: 'You have a new notification. Open the app to view it.', url: '/notifications', tag: 'notice' });
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toContain('"pushAttempts"+1');
  });
  it('removes expired subscriptions and completes their delivery', async () => {
    jest.spyOn(webpush, 'sendNotification').mockRejectedValue({ statusCode: 410 });
    const { worker, query } = setup(); await worker.tick();
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE FROM "PushSubscription"'))).toBe(true);
  });
  it('retries transient failures with bounded attempts', async () => {
    jest.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('temporary'));
    const { worker, query } = setup(); await worker.tick();
    const last = query.mock.calls.at(-1) as unknown as [string, {replacements:{done:boolean}}];
    expect(last[1].replacements.done).toBe(false);
    const exhausted = setup(2); await exhausted.worker.tick();
    const final = exhausted.query.mock.calls.at(-1) as unknown as [string, {replacements:{done:boolean}}];
    expect(final[1].replacements.done).toBe(true);
  });
});
