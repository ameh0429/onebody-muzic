import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export function normalizeArtistName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export class CreateArtistDto {
  @ApiProperty({ example: 'Hillsong Worship', minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? normalizeArtistName(value) : value)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Church worship music collective.', nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  biography?: string | null;

  @ApiPropertyOptional({ example: 'https://images.example.org/artists/hillsong.jpg', nullable: true, description: 'Existing HTTPS image reference. This endpoint does not upload or fetch files.' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false, disallow_auth: true })
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 'onebodymusic/artists/hillsong', nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  imagePublicId?: string | null;
}
