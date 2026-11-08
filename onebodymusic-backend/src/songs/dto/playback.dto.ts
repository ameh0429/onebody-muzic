import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlaybackQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'true', description: 'With an access JWT: true redirects to a short-lived ticket URL; false returns JSON for browser audio.src. A ticket request always streams and cannot mint another ticket.' })
  @IsIn(['true', 'false'])
  redirect: string = 'true';
  @ApiPropertyOptional({ description: 'Short-lived song-scoped playback ticket. Never put your access JWT here.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  ticket?: string;
}
export class PlaybackResponseDto {
  @ApiProperty({ example: '/api/v1/songs/6838918a-2b67-49ed-a90d-14b86ca955c7/stream?ticket=<short-lived-ticket>', description: 'Relative API URL, not a Cloudinary URL. Resolve against the API origin.' })
  url!: string;
  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
  @ApiProperty({ example: 60 })
  expiresIn!: number;
}
