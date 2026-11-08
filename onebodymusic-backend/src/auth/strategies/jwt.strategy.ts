import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { isUUID } from 'class-validator';
import { EnvironmentVariables } from '../../config/environment';
import { AuthService } from '../auth.service';
import { UserResponseDto } from '../dto/user-response.dto';
import { JWT_AUDIENCE, JWT_ISSUER } from '../auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<EnvironmentVariables, true>, private readonly auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      ignoreExpiration: false,
      algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
    });
  }

  async validate(payload: unknown): Promise<UserResponseDto> {
    if (typeof payload !== 'object' || payload === null || !('sub' in payload) ||
        typeof payload.sub !== 'string' || !isUUID(payload.sub) ||
        !('exp' in payload) || typeof payload.exp !== 'number' ||
        !('iat' in payload) || typeof payload.iat !== 'number') {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.auth.authenticateTokenSubject(payload.sub);
  }
}
