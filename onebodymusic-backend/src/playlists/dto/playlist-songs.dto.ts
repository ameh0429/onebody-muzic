import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const normalize = ({ value }: { value: unknown }) => Array.isArray(value) ? value.map((id: unknown) => typeof id === 'string' ? id.toLowerCase() : id) : value;
export class AddPlaylistSongsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100, description: 'Existing song UUIDs, appended in this order. The whole request fails if any ID is missing or already present.' })
  @Transform(normalize)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  songIds!: string[];
}
export class ReorderPlaylistSongsDto {
  @ApiProperty({ type: [String], maxItems: 1000, description: 'Exact permutation of every current song UUID. Empty is allowed only for an empty playlist.' })
  @Transform(normalize)
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  songIds!: string[];
}
