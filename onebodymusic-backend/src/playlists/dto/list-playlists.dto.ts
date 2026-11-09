import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlaylistPublicationStatus, PlaylistType } from '../../database/models';

export class ListPlaylistsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page: number = 1;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
  @ApiPropertyOptional({ enum: PlaylistType })
  @IsOptional()
  @IsEnum(PlaylistType)
  type?: PlaylistType;
  @ApiPropertyOptional({ enum: PlaylistPublicationStatus })
  @IsOptional()
  @IsEnum(PlaylistPublicationStatus)
  publicationStatus?: PlaylistPublicationStatus;
}
