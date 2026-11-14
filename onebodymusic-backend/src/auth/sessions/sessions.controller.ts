import { Body, Controller, ForbiddenException, Header, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CookieOptions, Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { LoginDto } from '../dto/login.dto';
import { LoginResponseDto } from '../dto/login-response.dto';
import { AuthRateLimit } from '../rate-limit/auth-rate-limit.guard';
import { EnvironmentVariables } from '../../config/environment';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { RefreshSessionsService } from './refresh-sessions.service';
const COOKIE = 'onebodymusic_session';
class EmptySessionDto {}
@ApiTags('Authentication')
@ApiResponse({ status: 403, description: 'Unapproved Origin or missing X-Session-Request: 1 header.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Invalid credentials, inactive account or invalid/expired/replayed session.', type: ApiErrorDto })
@ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
@Controller({ path: 'auth', version: '1' })
export class SessionsController {
  constructor(private readonly auth: AuthService, private readonly sessions: RefreshSessionsService, private readonly config: ConfigService<EnvironmentVariables, true>) {}
  private protect(request: Request) {
    const origin = request.get('origin');
    if (request.get('X-Session-Request') !== '1' || (origin && !this.config.get('CORS_ALLOWED_ORIGINS', { infer: true }).includes(origin))) throw new ForbiddenException('Session request origin or header is not allowed');
  }
  private options(): CookieOptions {
    return { httpOnly: true, secure: this.config.get('NODE_ENV', { infer: true }) === 'production', sameSite: this.config.get('AUTH_COOKIE_SAME_SITE', { infer: true }), path: '/api/v1/auth' };
  }
  private token(request: Request): string | undefined {
    const value = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return value && /^[A-Za-z0-9_-]{64}$/.test(value) ? value : undefined;
  }
  @Header('Cache-Control', 'no-store')
  @Post('session')
  @HttpCode(200)
  @AuthRateLimit('login')
  @ApiOperation({ summary: 'Sign in and create a persistent browser session', description: 'Requires X-Session-Request: 1 and an allowed Origin. Sets a rotating HttpOnly refresh cookie; access JWT stays in memory.' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<LoginResponseDto> {
    this.protect(request);
    const login = await this.auth.login(dto);
    // Replacing a browser session revokes its previous family.
    const previous = this.token(request); if (previous) await this.sessions.revoke(previous);
    const session = await this.sessions.create(login.user.id);
    response.cookie(COOKIE, session.token, { ...this.options(), expires: session.expiresAt });
    return login;
  }
  @Header('Cache-Control', 'no-store')
  @Post('refresh')
  @HttpCode(200)
  @AuthRateLimit('login')
  @ApiOperation({ summary: 'Rotate the browser refresh cookie and issue a fresh access token' })
  @ApiBody({ type: EmptySessionDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async refresh(@Body() _body: EmptySessionDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<LoginResponseDto> {
    this.protect(request);
    const token = this.token(request);
    if (!token) { response.clearCookie(COOKIE, this.options()); throw new UnauthorizedException('Please sign in.'); }
    try {
      const next = await this.sessions.rotate(token);
      response.cookie(COOKIE, next.token, { ...this.options(), expires: next.expiresAt }); return next.login;
    } catch (error) { if (error instanceof UnauthorizedException) response.clearCookie(COOKIE, this.options()); throw error; }
  }
  @Header('Cache-Control', 'no-store')
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current browser session and clear its cookie' })
  @ApiBody({ type: EmptySessionDto })
  @ApiResponse({ status: 204, description: 'Session revoked and cookie cleared.' })
  async logout(@Body() _body: EmptySessionDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.protect(request);
    const token = this.token(request); if (token) await this.sessions.revoke(token);
    response.clearCookie(COOKIE, this.options());
  }
}
