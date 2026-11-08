import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom, isObservable } from 'rxjs';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthService } from '../../auth/auth.service';
import { PlaybackTicketsService } from '../playback-tickets.service';
import { UserResponseDto } from '../../auth/dto/user-response.dto';

export type PlaybackRequest = Request & { user?: UserResponseDto; playbackTicket?: boolean };
@Injectable()
export class PlaybackAuthGuard extends JwtAuthGuard {
  constructor(private readonly tickets: PlaybackTicketsService, private readonly auth: AuthService) { super(); }
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlaybackRequest>();
    const ticket: unknown = request.query.ticket;
    if (ticket !== undefined) {
      if (typeof ticket !== 'string' || ticket.length > 2048) throw new UnauthorizedException('Invalid playback ticket');
      const claims = await this.tickets.verify(ticket);
      const songId = request.params.id;
      if (typeof songId !== 'string' || claims.songId.toLowerCase() !== songId.toLowerCase()) throw new ForbiddenException('Playback ticket is scoped to another song');
      request.user = await this.auth.authenticateTokenSubject(claims.sub);
      request.playbackTicket = true;
      return true;
    }
    const result = super.canActivate(context);
    return isObservable(result) ? firstValueFrom(result) : result;
  }
}
