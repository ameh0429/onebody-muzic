import { ApiProperty } from '@nestjs/swagger';
import { PlaylistPublicationStatus, PlaylistType } from '../../database/models';

export class PlaylistResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Sunday practice' })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ enum: PlaylistType })
  type!: PlaylistType;
  @ApiProperty({ enum: PlaylistPublicationStatus })
  publicationStatus!: PlaylistPublicationStatus;
  @ApiProperty({ format: 'uuid' })
  createdById!: string;
  @ApiProperty({ example: 5 })
  songCount!: number;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
export class PlaylistSongInfoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Amazing Grace' })
  title!: string;
  @ApiProperty({ format: 'uuid' })
  artistId!: string;
  @ApiProperty({ example: 'Church Choir' })
  artistName!: string;
  @ApiProperty({ type: Number, nullable: true })
  durationSeconds!: number | null;
  @ApiProperty({ type: String, nullable: true })
  category!: string | null;
}
export class PlaylistEntryDto {
  @ApiProperty({ format: 'uuid' })
  songId!: string;
  @ApiProperty({ example: 0, description: 'Zero-based contiguous position.' })
  position!: number;
  @ApiProperty({ type: PlaylistSongInfoDto })
  song!: PlaylistSongInfoDto;
}
export class PlaylistDetailResponseDto extends PlaylistResponseDto {
  @ApiProperty({ type: [PlaylistEntryDto] })
  songs!: PlaylistEntryDto[];
}
export class PlaylistsPageDto {
  @ApiProperty({ type: [PlaylistResponseDto] })
  data!: PlaylistResponseDto[];
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 50 })
  total!: number;
  @ApiProperty({ example: 3 })
  totalPages!: number;
}
