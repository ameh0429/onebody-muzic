import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { UserResponseDto } from '../dto/user-response.dto';

export type AuthenticatedRequest = Request & { user?: UserResponseDto };

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): UserResponseDto => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new UnauthorizedException('Unauthorized');
  return user;
});
