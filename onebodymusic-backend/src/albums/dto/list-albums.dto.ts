import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { normalizeAlbumTitle } from './create-album.dto';

export class ListAlbumsDto {
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
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  artistId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 9999, example: 2024 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  releaseYear?: number;
  @ApiPropertyOptional({ example: 'praise', description: 'Case-insensitive literal title substring.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? normalizeAlbumTitle(value) : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  search?: string;
}
