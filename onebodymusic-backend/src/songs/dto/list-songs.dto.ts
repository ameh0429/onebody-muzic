import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum SongSortBy { TITLE = 'title', CREATED_AT = 'createdAt' }
export enum SongSortOrder { ASC = 'ASC', DESC = 'DESC' }
export class ListSongsDto {
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
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  albumId?: string;
  @ApiPropertyOptional({ example: 'grace' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  search?: string;
  @ApiPropertyOptional({ example: 'Worship' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string;
  @ApiPropertyOptional({ enum: SongSortBy, default: SongSortBy.CREATED_AT })
  @IsEnum(SongSortBy)
  sortBy: SongSortBy = SongSortBy.CREATED_AT;
  @ApiPropertyOptional({ enum: SongSortOrder, default: SongSortOrder.DESC })
  @IsEnum(SongSortOrder)
  sortOrder: SongSortOrder = SongSortOrder.DESC;
}
