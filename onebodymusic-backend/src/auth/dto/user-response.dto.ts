import { ApiProperty } from '@nestjs/swagger';
import { Role, UserStatus } from '../../database/models';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid', example: '6838918a-2b67-49ed-a90d-14b86ca955c7' })
  id!: string;

  @ApiProperty({ example: 'Grace James' })
  name!: string;

  @ApiProperty({ example: 'grace@example.org', format: 'email' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.MEMBER })
  role!: Role;

  @ApiProperty({ enum: UserStatus, example: UserStatus.PENDING })
  status!: UserStatus;

  @ApiProperty({ format: 'date-time', example: '2026-11-08T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-08T12:00:00.000Z' })
  updatedAt!: string;
}
