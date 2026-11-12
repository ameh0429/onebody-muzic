import { ApiProperty } from '@nestjs/swagger';

export class AlbumArtistDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Hillsong Worship' })
  name!: string;
}

export class AlbumSongDto {
  @ApiProperty({ type: String, nullable: true, description: 'Song artwork URL, or null when unset.' })
  coverImageUrl!: string | null;
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Amazing Grace' })
  title!: string;
  @ApiProperty({ format: 'uuid' })
  artistId!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Worship' })
  category!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 240 })
  durationSeconds!: number | null;
}

export class AlbumResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Songs of Praise' })
  title!: string;
  @ApiProperty({ format: 'uuid' })
  artistId!: string;
  @ApiProperty({ type: AlbumArtistDto })
  artist!: AlbumArtistDto;
  @ApiProperty({ type: Number, nullable: true, example: 2024, description: 'May be null on legacy records with an unknown release year.' })
  releaseYear!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'https://images.example.org/albums/praise.jpg' })
  coverImageUrl!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'onebodymusic/albums/praise' })
  coverImagePublicId!: string | null;
  @ApiProperty({ example: 8 })
  songCount!: number;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AlbumDetailResponseDto extends AlbumResponseDto {
  @ApiProperty({ type: [AlbumSongDto] })
  songs!: AlbumSongDto[];
}

export class AlbumsPageDto {
  @ApiProperty({ type: [AlbumResponseDto] })
  data!: AlbumResponseDto[];
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 25 })
  total!: number;
  @ApiProperty({ example: 2 })
  totalPages!: number;
}
