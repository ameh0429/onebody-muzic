import { Agent, RequestOptions } from 'node:https';
import { ClientRequest } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { classifyCloudinaryError, CloudinaryOperationError } from './errors/media-operation.error';

// The SDK's socket idle timeout does not bound DNS/connect/TLS waits. Track requests
// through a per-operation agent so the overall deadline can abort their sockets too.
export function cloudinaryOperation<T>(timeoutMs: number, work: (agent: Agent) => Promise<T>): Promise<T> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const agent = (proxy ? new HttpsProxyAgent(proxy) : new Agent()) as Agent & { addRequest: (request: ClientRequest, options: RequestOptions) => void };
  const requests = new Set<ClientRequest>();
  const addRequest = agent.addRequest.bind(agent);
  agent.addRequest = (request: ClientRequest, options: RequestOptions) => {
    requests.add(request); request.once('close', () => requests.delete(request)); addRequest(request, options);
  };
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, result?: T) => {
      if (settled) return; settled = true; clearTimeout(timer);
      for (const request of requests) request.destroy(); agent.destroy();
      if (error !== undefined) reject(classifyCloudinaryError(error)); else resolve(result as T);
    };
    const timer = setTimeout(() => finish(new CloudinaryOperationError('TIMEOUT')), timeoutMs);
    try { void work(agent).then((result) => finish(undefined, result), (error: unknown) => finish(error)); } catch (error: unknown) { finish(error); }
  });
}
