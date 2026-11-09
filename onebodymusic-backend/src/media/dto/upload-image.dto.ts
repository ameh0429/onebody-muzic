import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ImageFolder { ARTISTS = 'artists', ALBUMS = 'albums', SONGS = 'songs' }
export class UploadImageDto {
  @ApiProperty({ enum: ImageFolder, example: ImageFolder.ARTISTS })
  @IsEnum(ImageFolder)
  folder!: ImageFolder;
}
export class UploadAudioDto {}
