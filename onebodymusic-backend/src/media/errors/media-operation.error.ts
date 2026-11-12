import { HttpException } from '@nestjs/common';
export type MediaFailure = 'TIMEOUT' | 'CONNECTION' | 'TLS' | 'CREDENTIALS' | 'REJECTED' | 'INVALID_RESPONSE' | 'PROVIDER' | 'SAVE';
const MESSAGES: Record<MediaFailure, string> = {
  TIMEOUT: 'Cloudinary did not respond before the media timeout. Check backend network access to Cloudinary and try a smaller file. Cleanup is tracked automatically.',
  CONNECTION: 'The backend could not connect to Cloudinary. Check its internet connection, DNS, firewall and HTTPS proxy settings. Cleanup is tracked automatically.',
  TLS: 'The backend could not verify Cloudinary’s TLS certificate. Check the system clock and trusted certificates or your HTTPS proxy. Do not disable TLS verification.',
  CREDENTIALS: 'Cloudinary rejected the server credentials or permissions. Check the backend Cloudinary cloud name, API key, API secret and account permissions.',
  REJECTED: 'Cloudinary rejected this media request. Check the file format and your Cloudinary account upload limits and permissions.',
  INVALID_RESPONSE: 'Cloudinary returned incompatible media metadata. The upload was not attached; cleanup is tracked automatically.',
  PROVIDER: 'Cloudinary could not complete the media request. Please try again later; cleanup remains tracked.',
  SAVE: 'The uploaded media could not be saved to the database. No song was published; cleanup has been scheduled.',
};
// Only fixed, application-owned messages may be exposed for server errors.
export class MediaOperationException extends HttpException {
  constructor(readonly failure: MediaFailure) { super(MESSAGES[failure], failure === 'TIMEOUT' ? 504 : failure === 'SAVE' || failure === 'CREDENTIALS' ? 503 : 502); }
}
export class CloudinaryOperationError extends Error {
  constructor(readonly failure: MediaFailure) { super(`Cloudinary operation failed (${failure})`); }
}
export function classifyCloudinaryError(error: unknown): CloudinaryOperationError {
  if (error instanceof CloudinaryOperationError) return error;
  const outer = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const value = typeof outer.error === 'object' && outer.error !== null ? outer.error as Record<string, unknown> : outer;
  const code = typeof value.code === 'string' ? value.code : '';
  const status = typeof value.http_code === 'number' ? value.http_code : undefined;
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED'].includes(code) || value.name === 'TimeoutError' || status === 499 || status === 408 || status === 504) return new CloudinaryOperationError('TIMEOUT');
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) return new CloudinaryOperationError('TLS');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'].includes(code)) return new CloudinaryOperationError('CONNECTION');
  if (status === 401 || status === 403) return new CloudinaryOperationError('CREDENTIALS');
  if (status !== undefined && status >= 400 && status < 500) return new CloudinaryOperationError('REJECTED');
  return new CloudinaryOperationError('PROVIDER');
}
