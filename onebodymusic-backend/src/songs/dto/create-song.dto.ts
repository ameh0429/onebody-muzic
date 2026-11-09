import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSongDto {
  @ApiProperty({ example: 'Amazing Grace', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50000, example: 'Amazing grace, how sweet the sound\nThat saved a wretch like me', description: 'Plain text. Line breaks and whitespace are preserved. Omit or use null for no lyrics.' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  @Matches(/^[^\u0000]*$/u, { message: 'lyrics must not contain null characters' })
  lyrics?: string | null;

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
