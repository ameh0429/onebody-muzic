import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSongDto {
  @ApiProperty({ example: 'Amazing Grace', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  artistId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  albumId?: string | null;
  @ApiPropertyOptional({ example: 'Worship', nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string | null;
  @ApiProperty({ format: 'uuid', description: 'READY authenticated audio MediaAsset uploaded by the acting administrator. A file can belong to only one song.' })
  @IsUUID()
  audioAssetId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Optional READY image MediaAsset in onebodymusic/songs.' })
  @IsOptional()
  @IsUUID()
  coverAssetId?: string | null;
}
