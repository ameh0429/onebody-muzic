import { applyDecorators, CanActivate, ExecutionContext, HttpException, Injectable, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiResponse } from '@nestjs/swagger';
import { createHmac } from 'node:crypto';
import { Request, Response } from 'express';
import { EnvironmentVariables } from '../../config/environment';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { AuthRateLimitStore, RateLimitResult } from './auth-rate-limit.store';
type Scope = 'login' | 'register';
const KEY = 'onebodymusic:auth-rate-limit';
export const AuthRateLimit = (scope: Scope) => applyDecorators(SetMetadata(KEY, scope), UseGuards(AuthRateLimitGuard),
  ApiResponse({ status: 429, description: 'Too many attempts from this network address. Wait Retry-After seconds.', type: ApiErrorDto, headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } } }),
  ApiResponse({ status: 503, description: 'Authentication rate-limit storage unavailable; retry later.', type: ApiErrorDto }));
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly store: AuthRateLimitStore, private readonly config: ConfigService<EnvironmentVariables, true>, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.get<Scope>(KEY, context.getHandler());
    if (!scope) throw new ServiceUnavailableException('Authentication temporarily unavailable');
    const request = context.switchToHttp().getRequest<Request>(); const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    // Deliberately use the socket peer: untrusted X-Forwarded-For must not bypass the limiter.
    const peer = request.socket.remoteAddress ?? 'unknown';
    const key = createHmac('sha256', this.config.get('JWT_SECRET', { infer: true })).update(`${scope}:${peer}`).digest('hex');
    const limit = this.config.get(scope === 'login' ? 'AUTH_LOGIN_MAX_ATTEMPTS' : 'AUTH_REGISTER_MAX_ATTEMPTS', { infer: true });
    const seconds = this.config.get('AUTH_RATE_LIMIT_WINDOW_SECONDS', { infer: true });
    let result: RateLimitResult;
    try { result = await this.store.consume(key, seconds, limit); } catch { throw new ServiceUnavailableException('Authentication temporarily unavailable'); }
    if (result.hits > limit) { response.setHeader('Retry-After', result.retryAfter); throw new HttpException('Too many authentication attempts; retry later', 429); }
    return true;
  }
}
