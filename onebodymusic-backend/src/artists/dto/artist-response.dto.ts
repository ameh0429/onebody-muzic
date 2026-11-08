import { ApiProperty } from '@nestjs/swagger';

export class ArtistResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Hillsong Worship' })
  name!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Church worship music collective.' })
  biography!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'https://images.example.org/artists/hillsong.jpg' })
  imageUrl!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'onebodymusic/artists/hillsong' })
  imagePublicId!: string | null;
  @ApiProperty({ example: 2 })
  albumCount!: number;
  @ApiProperty({ example: 12 })
  songCount!: number;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ArtistsPageDto {
  @ApiProperty({ type: [ArtistResponseDto] })
  data!: ArtistResponseDto[];
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 25 })
  total!: number;
  @ApiProperty({ example: 2 })
  totalPages!: number;
}
