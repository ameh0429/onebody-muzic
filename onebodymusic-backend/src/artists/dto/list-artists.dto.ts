import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { normalizeArtistName } from './create-artist.dto';

export class ListArtistsDto {
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

  @ApiPropertyOptional({ example: 'hillsong', description: 'Case-insensitive literal substring of the artist name.', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? normalizeArtistName(value) : value)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  search?: string;
}
