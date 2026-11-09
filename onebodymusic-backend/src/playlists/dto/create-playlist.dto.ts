import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlaylistPublicationStatus, PlaylistType } from '../../database/models';

export class CreatePlaylistDto {
  @ApiProperty({ example: 'Sunday practice', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;
  @ApiPropertyOptional({ enum: PlaylistType, default: PlaylistType.PERSONAL })
  @IsEnum(PlaylistType)
  type: PlaylistType = PlaylistType.PERSONAL;
  @ApiPropertyOptional({ enum: PlaylistPublicationStatus, description: 'REHEARSAL only, ADMIN only; defaults to DRAFT.' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(PlaylistPublicationStatus)
  publicationStatus?: PlaylistPublicationStatus;
}
