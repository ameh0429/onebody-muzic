import { ConfigService } from '@nestjs/config';
import { BadGatewayException, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { IncomingMessage, ClientRequest } from 'node:http';
import { RequestOptions, request } from 'node:https';
import { Readable } from 'node:stream';
import { EnvironmentVariables } from '../config/environment';
import { MediaAsset } from '../database/models';
import { CloudinaryClient } from './cloudinary.client';
import { CloudinaryAudioGateway } from './cloudinary-audio.gateway';

jest.mock('node:https', () => ({ request: jest.fn() }));
const send = request as unknown as jest.Mock<ClientRequest, [string, RequestOptions, (response: IncomingMessage) => void]>;

describe('authenticated provider range gateway', () => {
  const client = { internalAudioUrl: jest.fn(() => 'https://res.cloudinary.com/test/video/authenticated/internal-signed-path.mp3') };
  const config = new ConfigService<EnvironmentVariables, true>({ MEDIA_PLAYBACK_IDLE_TIMEOUT_SECONDS: 30 });
  const gateway = new CloudinaryAudioGateway(client as unknown as CloudinaryClient, config);
  const asset = { id: 'safe-asset-id', format: 'mp3', bytes: 6 } as MediaAsset;
  const upstream = Object.assign(new EventEmitter(), { setTimeout: jest.fn(), end: jest.fn(), destroy: jest.fn() });
  const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  let response: IncomingMessage;
  beforeEach(() => {
    jest.clearAllMocks(); upstream.removeAllListeners();
    response = Object.assign(Readable.from([Buffer.from('bcd')]), { statusCode: 206, headers: { 'content-length': '3', 'content-range': 'bytes 1-3/6', 'accept-ranges': 'bytes' } }) as IncomingMessage;
    send.mockImplementation((_url, _options, callback) => { upstream.end.mockImplementation(() => callback(response)); return upstream as unknown as ClientRequest; });
  });
  afterAll(() => log.mockRestore());
  it('forwards only safe headers, preserves provider 206 headers, and exposes the stream rather than a buffer', async () => {
    const signal = new AbortController().signal;
    const result = await gateway.open(asset, 'bytes=1-3', false, signal);
    expect(result.stream).toBe(response); expect(result).toMatchObject({ status: 206, contentLength: '3', contentRange: 'bytes 1-3/6', contentType: 'audio/mpeg', acceptRanges: 'bytes' });
    expect(send).toHaveBeenCalledWith(expect.stringContaining('/video/authenticated/'), expect.objectContaining({ method: 'GET', signal, headers: { Range: 'bytes=1-3', 'Accept-Encoding': 'identity' } }), expect.any(Function));
    expect(result).not.toHaveProperty('url'); expect(upstream.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function));
  });
  it('supports HEAD without downloading full audio', async () => {
    response.statusCode = 200; response.headers = { 'content-length': '6', 'accept-ranges': 'bytes' };
    const result = await gateway.open(asset, undefined, true, new AbortController().signal);
    expect(result.contentLength).toBe('6'); expect(send.mock.calls[0]?.[1].method).toBe('HEAD');
  });
  it.each([302, 401, 403, 404, 500])('rejects unsafe redirects and provider failures without exposing internal URLs: %s', async (status) => {
    response.statusCode = status;
    await expect(gateway.open(asset, undefined, false, new AbortController().signal)).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('refuses a provider that ignores Range instead of silently downloading the full file', async () => {
    response.statusCode = 200; response.headers = { 'content-length': '6' };
    await expect(gateway.open(asset, 'bytes=1-3', false, new AbortController().signal)).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('validates provider range/length headers', async () => {
    response.headers['content-range'] = 'bytes 1-3/99';
    await expect(gateway.open(asset, 'bytes=1-3', false, new AbortController().signal)).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('logs provider status without signed paths or provider error details', async () => {
    response.statusCode = 403;
    response.headers['x-cld-error'] = 'private-provider-detail';
    await expect(gateway.open(asset, undefined, false, new AbortController().signal)).rejects.toBeInstanceOf(BadGatewayException);
    expect(log).toHaveBeenCalledWith('Audio delivery failed: asset=safe-asset-id; code=PROVIDER_HTTP; providerStatus=403');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/internal-signed-path|private-provider-detail|https:/);
  });
  it.each([['ENOTFOUND', 'CONNECTION'], ['CERT_HAS_EXPIRED', 'TLS'], ['ETIMEDOUT', 'TIMEOUT']])('classifies %s without exposing raw network errors', async (code, failure) => {
    upstream.end.mockImplementation(() => upstream.emit('error', Object.assign(new Error('private-signed-url'), { code })));
    // Install after open has configured the mocked request callback.
    send.mockImplementation(() => upstream as unknown as ClientRequest);
    await expect(gateway.open(asset, undefined, false, new AbortController().signal)).rejects.toBeInstanceOf(BadGatewayException);
    expect(log).toHaveBeenCalledWith(`Audio delivery failed: asset=safe-asset-id; code=${failure}`);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-signed-url');
  });
  it('preserves an authenticated unsatisfiable-range result', async () => {
    response.statusCode = 416; response.headers = { 'content-range': 'bytes */6', 'content-length': '0' };
    expect(await gateway.open(asset, 'bytes=100-', false, new AbortController().signal)).toMatchObject({ status: 416, contentRange: 'bytes */6' });
  });
});
