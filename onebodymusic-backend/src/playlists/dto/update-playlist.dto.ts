import { OmitType, PartialType } from '@nestjs/swagger';
import { CreatePlaylistDto } from './create-playlist.dto';

export class UpdatePlaylistDto extends PartialType(OmitType(CreatePlaylistDto, ['type'] as const), { skipNullProperties: false }) {}
