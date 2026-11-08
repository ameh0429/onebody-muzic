import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export function normalizeAlbumTitle(value: string): string { return value.trim().replace(/\s+/gu, ' '); }

export class CreateAlbumDto {
  @ApiProperty({ example: 'Songs of Praise', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? normalizeAlbumTitle(value) : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ format: 'uuid', description: 'UUID of an existing artist.' })
  @IsUUID()
  artistId!: string;

  @ApiProperty({ example: 2024, minimum: 1, maximum: 9999 })
  @IsInt()
  @Min(1)
  @Max(9999)
  releaseYear!: number;

  @ApiPropertyOptional({ example: 'https://images.example.org/albums/praise.jpg', nullable: true })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false, disallow_auth: true })
  @MaxLength(2048)
  coverImageUrl?: string | null;

  @ApiPropertyOptional({ example: 'onebodymusic/albums/praise', nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  coverImagePublicId?: string | null;
}
