import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Not Found' })
  error!: string;

  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], example: 'Cannot GET /api/v1/missing' })
  message!: string | string[];

  @ApiProperty({ example: '/api/v1/missing' })
  path!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}
