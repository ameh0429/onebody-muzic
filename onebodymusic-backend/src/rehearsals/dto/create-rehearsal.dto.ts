import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRehearsalDto {
  @ApiProperty({ example: 'Sunday choir practice', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value)
  @IsString() @MinLength(1) @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000, example: 'Practice the opening worship songs.' })
  @IsOptional() @IsString() @MaxLength(5000)
  description?: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-11-15T17:00:00+01:00', description: 'Combined date and time with Z or an explicit UTC offset. Returned in UTC as 2026-11-15T16:00:00.000Z.' })
  @IsString() @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u, { message: 'scheduledAt must include date, time, seconds, and Z or a UTC offset' })
  scheduledAt!: string;

  @ApiProperty({ format: 'uuid', description: 'An existing REHEARSAL playlist. Its publication status controls member visibility.' })
  @IsUUID()
  playlistId!: string;
}
