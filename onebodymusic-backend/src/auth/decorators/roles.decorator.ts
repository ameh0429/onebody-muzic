import { SetMetadata } from '@nestjs/common';
import { Role } from '../../database/models';

export const ROLES_KEY = 'auth:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
