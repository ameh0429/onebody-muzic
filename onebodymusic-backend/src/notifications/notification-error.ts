/** Fixed diagnostic text only: provider errors may contain subscription URLs, keys or SQL. */
export function notificationFailureReason(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const cause = record.original ?? record.parent;
  const nested = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
  const code = nested.code ?? record.code;
  switch (code) {
    case '42P01': return 'database table missing (42P01); apply migrations 012-notifications and 013-email-notifications to the runtime database';
    case '42703': return 'database column missing (42703); check that all migrations are applied';
    case '42501': return 'database permission denied (42501); check the runtime account permissions for notification tables';
    case '53300': return 'database connection capacity exhausted (53300); check the database connection limit';
    case 'ECONNREFUSED': return 'connection refused (ECONNREFUSED); check database or push-provider connectivity';
    case 'ENOTFOUND': return 'hostname lookup failed (ENOTFOUND); check DNS and outbound connectivity';
    case 'ETIMEDOUT': case 'ESOCKETTIMEDOUT': return 'connection timed out; check database or push-provider connectivity';
    case 'CERT_HAS_EXPIRED': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return 'TLS verification failed; check the trusted certificate configuration';
  }
  switch (record.statusCode) {
    case 400: return 'push provider returned HTTP 400; re-enable notifications on the affected device';
    case 401: case 403: return 'push provider returned HTTP 401/403; check VAPID configuration and re-enable device subscriptions if signing keys changed';
    case 404: case 410: return 'push subscription expired; removing the device subscription';
    case 429: return 'push provider returned HTTP 429; delivery will retry';
    case 500: case 502: case 503: case 504: return 'push provider unavailable; delivery will retry';
  }
  if (record.name === 'SequelizeConnectionAcquireTimeoutError') return 'database connection pool timed out; check database capacity';
  return 'unclassified worker failure; check database migrations, runtime permissions and connectivity';
}
