import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import { isUUID } from 'class-validator';
import { EnvironmentVariables } from '../config/environment';
import { PlaybackResponseDto } from './dto/playback.dto';

interface PlaybackClaims { sub: string; songId: string; kind: 'song-playback'; exp: number; iat: number }
@Injectable()
export class PlaybackTicketsService {
  private readonly jwt: JwtService;
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    // Cryptographic key separation: playback tickets cannot authenticate to ordinary API endpoints.
    const secret = createHmac('sha256', config.get('JWT_SECRET', { infer: true })).update('onebodymusic:playback:v1').digest();
    this.jwt = new JwtService({ secret, signOptions: { algorithm: 'HS256', issuer: 'onebodymusic-playback', audience: 'onebodymusic-stream' } });
  }
  async issue(userId: string, songId: string): Promise<PlaybackResponseDto> {
    const expiresIn = this.config.get('MEDIA_PLAYBACK_TTL_SECONDS', { infer: true });
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const ticket = await this.jwt.signAsync({ sub: userId, songId, kind: 'song-playback', exp });
    return { url: `/api/v1/songs/${songId}/stream?ticket=${encodeURIComponent(ticket)}`, expiresAt: new Date(exp * 1000).toISOString(), expiresIn };
  }
  async verify(ticket: string): Promise<PlaybackClaims> {
    try {
      const claims = await this.jwt.verifyAsync<Partial<PlaybackClaims>>(ticket, { algorithms: ['HS256'], issuer: 'onebodymusic-playback', audience: 'onebodymusic-stream' });
      if (claims.kind !== 'song-playback' || typeof claims.sub !== 'string' || !isUUID(claims.sub) || typeof claims.songId !== 'string' || !isUUID(claims.songId) || typeof claims.exp !== 'number' || typeof claims.iat !== 'number' || claims.exp <= claims.iat || claims.exp - claims.iat > 300) throw new Error('Invalid claims');
      return claims as PlaybackClaims;
    } catch { throw new UnauthorizedException('Invalid or expired playback ticket'); }
  }
}
