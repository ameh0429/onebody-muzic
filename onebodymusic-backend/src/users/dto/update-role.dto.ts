import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../database/models';

export class UpdateRoleDto {
  @ApiProperty({ enum: Role, example: Role.MEMBER })
  @IsEnum(Role)
  role!: Role;
}
