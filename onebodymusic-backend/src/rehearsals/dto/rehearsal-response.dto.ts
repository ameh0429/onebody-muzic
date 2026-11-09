import { ApiProperty } from '@nestjs/swagger';
import { PlaylistDetailResponseDto } from '../../playlists/dto/playlist-response.dto';
import { PlaylistPublicationStatus } from '../../database/models';
export class RehearsalPlaylistDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Sunday worship' }) title!: string;
  @ApiProperty({ enum: PlaylistPublicationStatus }) publicationStatus!: PlaylistPublicationStatus;
}
export class RehearsalResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Sunday choir practice' }) title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ format: 'date-time', example: '2026-11-15T16:00:00.000Z' }) scheduledAt!: string;
  @ApiProperty({ format: 'uuid' }) playlistId!: string;
  @ApiProperty({ format: 'uuid' }) createdById!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: RehearsalPlaylistDto }) playlist!: RehearsalPlaylistDto;
}
export class RehearsalDetailResponseDto extends RehearsalResponseDto {
  @ApiProperty({ type: PlaylistDetailResponseDto }) declare playlist: PlaylistDetailResponseDto;
}
export class RehearsalsPageDto {
  @ApiProperty({ type: [RehearsalResponseDto] }) data!: RehearsalResponseDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 1 }) total!: number;
  @ApiProperty({ example: 1 }) totalPages!: number;
}
