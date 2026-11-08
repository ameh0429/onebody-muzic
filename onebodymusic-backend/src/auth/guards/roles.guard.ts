import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../database/models';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    return user !== undefined && roles.includes(user.role);
  }
}
