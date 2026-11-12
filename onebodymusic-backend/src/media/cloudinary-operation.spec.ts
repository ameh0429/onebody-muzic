import { Agent, RequestOptions } from 'node:https';
import { ClientRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { cloudinaryOperation } from './cloudinary-operation';
import { classifyCloudinaryError } from './errors/media-operation.error';
type TrackedAgent = Agent & { addRequest: (request: ClientRequest, options: RequestOptions) => void };
describe('bounded Cloudinary transport', () => {
  const proxy = process.env.HTTPS_PROXY; const lowerProxy = process.env.https_proxy;
  beforeEach(() => { delete process.env.HTTPS_PROXY; delete process.env.https_proxy; jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); if (proxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = proxy; if (lowerProxy === undefined) delete process.env.https_proxy; else process.env.https_proxy = lowerProxy; });
  it('aborts tracked requests when a DNS/connect/upload callback never finishes', async () => {
    jest.spyOn(Agent.prototype as TrackedAgent, 'addRequest').mockImplementation(() => undefined);
    const request = Object.assign(new EventEmitter(), { destroy: jest.fn() }) as unknown as ClientRequest;
    const destroy = jest.spyOn(Agent.prototype, 'destroy');
    const promise = cloudinaryOperation(1000, (agent) => { (agent as TrackedAgent).addRequest(request, {}); return new Promise<void>(() => undefined); });
    const rejected = expect(promise).rejects.toMatchObject({ failure: 'TIMEOUT' });
    jest.advanceTimersByTime(1000); await rejected; expect(request.destroy).toHaveBeenCalled(); expect(destroy).toHaveBeenCalled();
  });
  it('clears its deadline on success and ignores late completion after timeout', async () => {
    await expect(cloudinaryOperation(1000, async () => 'ok')).resolves.toBe('ok'); expect(jest.getTimerCount()).toBe(0);
    let complete: ((value: string) => void) | undefined;
    const result = cloudinaryOperation(1000, () => new Promise<string>((resolve) => { complete = resolve; }));
    const rejected = expect(result).rejects.toMatchObject({ failure: 'TIMEOUT' }); jest.advanceTimersByTime(1000); await rejected; complete?.('late'); await Promise.resolve(); expect(jest.getTimerCount()).toBe(0);
  });
  it.each([
    [{ http_code: 401, message: 'private API secret' }, 'CREDENTIALS'], [{ error: { http_code: 401, message: 'private nested API secret' }, request_options: { auth: 'private credentials' } }, 'CREDENTIALS'], [{ http_code: 403 }, 'CREDENTIALS'],
    [{ http_code: 400 }, 'REJECTED'], [{ name: 'TimeoutError', http_code: 499 }, 'TIMEOUT'],
    [{ code: 'ENOTFOUND', message: 'private hostname' }, 'CONNECTION'], [{ code: 'CERT_HAS_EXPIRED' }, 'TLS'], [{ http_code: 500 }, 'PROVIDER'],
  ] as const)('classifies provider errors without preserving raw diagnostics', (raw, failure) => {
    const error = classifyCloudinaryError(raw); expect(error.failure).toBe(failure); expect(error.message).not.toMatch(/private/);
  });
});
