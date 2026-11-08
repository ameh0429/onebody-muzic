import { ApiProperty } from '@nestjs/swagger';
import { MediaKind, MediaStatus } from '../../database/models';

export class MediaResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: MediaKind })
  kind!: MediaKind;
  @ApiProperty({ enum: MediaStatus, example: MediaStatus.READY })
  status!: MediaStatus;
  @ApiProperty({ example: 'onebodymusic/audio' })
  folder!: string;
  @ApiProperty({ description: 'Server-generated Cloudinary public ID, never a filename supplied by the caller.' })
  publicId!: string;
  @ApiProperty({ enum: ['video', 'image'], description: 'Cloudinary uses video resources for audio files.' })
  resourceType!: string;
  @ApiProperty({ enum: ['authenticated', 'upload'] })
  deliveryType!: string;
  @ApiProperty({ example: 'mp3' })
  format!: string;
  @ApiProperty({ example: 'audio/mpeg' })
  mimeType!: string;
  @ApiProperty({ example: 1048576 })
  bytes!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Audio duration in seconds.' })
  duration!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Public image URL only. Audio always returns null; playback authorization is separate.' })
  url!: string | null;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
