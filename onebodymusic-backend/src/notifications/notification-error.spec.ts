import { notificationFailureReason } from './notification-error';

describe('safe notification failure diagnostics', () => {
  it('identifies missing migrations without exposing SQL, credentials or endpoint details', () => {
    const result = notificationFailureReason({ original: { code: '42P01', message: 'secret database URL' }, sql: 'secret SQL', message: 'secret subscription URL' });
    expect(result).toContain('012-notifications');
    expect(result).not.toContain('secret');
  });
  it('distinguishes permissions from provider signing failures and network outages', () => {
    expect(notificationFailureReason({ parent: { code: '42501' } })).toContain('permission denied');
    expect(notificationFailureReason({ statusCode: 403 })).toContain('VAPID');
    expect(notificationFailureReason({ code: 'ENOTFOUND' })).toContain('DNS');
    expect(notificationFailureReason({ statusCode: 429 })).toContain('HTTP 429');
  });
  it('does not interpolate unknown error values', () => {
    expect(notificationFailureReason(new Error('secret private key'))).not.toContain('secret');
    expect(notificationFailureReason({ code: 'secret-key', statusCode: 'secret-endpoint' })).not.toContain('secret');
    expect(notificationFailureReason(null)).toContain('unclassified');
  });
});
