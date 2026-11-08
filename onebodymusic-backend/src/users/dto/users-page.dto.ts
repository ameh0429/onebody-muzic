import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../auth/dto/user-response.dto';

export class UsersPageDto {
  @ApiProperty({ type: [UserResponseDto] })
  data!: UserResponseDto[];
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 45 })
  total!: number;
  @ApiProperty({ example: 3 })
  totalPages!: number;
}
