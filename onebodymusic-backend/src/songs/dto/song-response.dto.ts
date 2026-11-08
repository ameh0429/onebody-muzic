import { ApiProperty } from '@nestjs/swagger';

export class SongArtistDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Church Choir' })
  name!: string;
}
export class SongAlbumDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Songs of Praise' })
  title!: string;
  @ApiProperty({ type: Number, nullable: true, example: 2024 })
  releaseYear!: number | null;
}
export class SongResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Amazing Grace' })
  title!: string;
  @ApiProperty({ format: 'uuid' })
  artistId!: string;
  @ApiProperty({ type: SongArtistDto })
  artist!: SongArtistDto;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  albumId!: string | null;
  @ApiProperty({ type: SongAlbumDto, nullable: true })
  album!: SongAlbumDto | null;
  @ApiProperty({ type: String, nullable: true, example: 'Worship' })
  category!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 240 })
  durationSeconds!: number | null;
  @ApiProperty({ type: String, nullable: true })
  coverImageUrl!: string | null;
  @ApiProperty({ description: 'False for legacy songs that must be assigned a tracked audio asset before playback.' })
  hasAudioAsset!: boolean;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
export class SongsPageDto {
  @ApiProperty({ type: [SongResponseDto] })
  data!: SongResponseDto[];
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 45 })
  total!: number;
  @ApiProperty({ example: 3 })
  totalPages!: number;
}
