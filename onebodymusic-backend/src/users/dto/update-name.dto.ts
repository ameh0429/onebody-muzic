import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateNameDto {
  @ApiProperty({ example: 'Grace James', minLength: 2, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;
}
