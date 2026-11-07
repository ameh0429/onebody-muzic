import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'onebodymusic-backend' })
  service!: string;

  @ApiProperty({ format: 'date-time', example: '2026-11-07T12:00:00.000Z' })
  timestamp!: string;
}
